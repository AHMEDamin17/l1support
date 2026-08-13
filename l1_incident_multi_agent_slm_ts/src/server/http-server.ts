import http from "node:http";
import { MultiAgentOrchestrator } from "../core/orchestrator.js";
import { JsonlIncidentStore } from "../storage/jsonl-store.js";
import { TeamsNotifier } from "../integrations/teams-notifier.js";
import type { EmailMessage } from "../core/types.js";
import { env, loadDotEnv } from "../utils/env.js";

loadDotEnv();
const orchestrator = new MultiAgentOrchestrator();
const store = new JsonlIncidentStore();
const notifier = new TeamsNotifier();
const port = Number(env("PORT", "8080"));

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    if (req.method === "GET" && req.url === "/health") {
      res.end(JSON.stringify({ status: "ok", service: "l1-incident-multi-agent-slm-ts" }));
      return;
    }
    if (req.method === "POST" && req.url === "/detect") {
      const email = await readJson<EmailMessage>(req);
      const result = await orchestrator.detect(email);
      store.save(email, result);
      await notifier.sendFocusAlert(email, result);
      res.end(JSON.stringify(result, null, 2));
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/incidents")) {
      res.end(JSON.stringify(store.list(100), null, 2));
      return;
    }
    if (req.method === "GET" && req.url === "/summary") {
      res.end(JSON.stringify(store.summary(), null, 2));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }));
  }
});

server.listen(port, () => console.log(`L1 multi-agent SLM API listening on ${port}`));
