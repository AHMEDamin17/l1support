import fs from "node:fs";
import { MultiAgentOrchestrator } from "../src/core/orchestrator.js";
import { JsonlIncidentStore } from "../src/storage/jsonl-store.js";
import type { EmailMessage } from "../src/core/types.js";
import { loadDotEnv } from "../src/utils/env.js";

loadDotEnv();
const emails = JSON.parse(fs.readFileSync("samples/sample-emails.json", "utf8")) as EmailMessage[];
const orchestrator = new MultiAgentOrchestrator();
const store = new JsonlIncidentStore("data/sample-incidents.jsonl");
for (const email of emails) {
  const result = await orchestrator.detect(email);
  store.save(email, result);
  console.log(JSON.stringify(result, null, 2));
}
console.log("Summary:", JSON.stringify(store.summary(), null, 2));
