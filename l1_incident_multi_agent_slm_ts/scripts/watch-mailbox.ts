import { loadDotEnv, env } from "../src/utils/env.js";
import { GraphMailClient } from "../src/clients/graph-mail-client.js";
import { ImapMailClient } from "../src/clients/imap-mail-client.js";
import { GmailApiClient } from "../src/clients/gmail-api-client.js";
import { MultiAgentOrchestrator } from "../src/core/orchestrator.js";
import { JsonlIncidentStore } from "../src/storage/jsonl-store.js";
import { TeamsNotifier } from "../src/integrations/teams-notifier.js";

loadDotEnv();
const provider = env("MAIL_PROVIDER", "graph");
const mailClient = provider === "gmail" ? new GmailApiClient() : (provider === "imap" ? new ImapMailClient() : new GraphMailClient());
const orchestrator = new MultiAgentOrchestrator();
const store = new JsonlIncidentStore();
const notifier = new TeamsNotifier();
const seen = new Set<string>();
const pollMs = Number(env("MAIL_POLL_SECONDS", "60")) * 1000;

console.log("Starting Outlook L1 multi-agent watcher. Press Ctrl+C to stop.");
setInterval(async () => {
  try {
    const messages = await mailClient.fetchRecentMessages();
    for (const email of messages) {
      if (seen.has(email.messageId)) continue;
      seen.add(email.messageId);
      const result = await orchestrator.detect(email);
      store.save(email, result);
      await notifier.sendFocusAlert(email, result);
      if (result.isIncident) console.log(`${result.state} | ${result.severity} | ${result.owner} | ${result.summary}`);
    }
  } catch (err) {
    console.error("Error fetching or processing emails:", err instanceof Error ? err.message : err);
  }
}, pollMs);
