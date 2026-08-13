import assert from "node:assert/strict";
import { MultiAgentOrchestrator } from "../src/core/orchestrator.js";
import type { EmailMessage } from "../src/core/types.js";

const orchestrator = new MultiAgentOrchestrator();

const p1: EmailMessage = {
  messageId: "test-001",
  subject: "P1 INC99999 Production SQL Database Down",
  body: "Users unable to login. Production unavailable.",
  sender: "monitoring@company.com",
  senderType: "monitoring"
};
const p1Result = await orchestrator.detect(p1);
assert.equal(p1Result.isIncident, true);
assert.equal(p1Result.severity, "P1");
assert.equal(p1Result.state, "FOCUS_REQUIRED");
assert.equal(p1Result.owner, "DBA Team");

const nonIncident: EmailMessage = {
  messageId: "test-002",
  subject: "Newsletter release notes",
  body: "Enhancement ideas and information request.",
  sender: "news@company.com",
  senderType: "unknown"
};
const nonResult = await orchestrator.detect(nonIncident);
assert.equal(nonResult.isIncident, false);
assert.equal(nonResult.severity, "NON_INCIDENT");

console.log("All tests passed.");
