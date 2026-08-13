# explanation.md — L1 Incident Multi-Agent System: Complete Code Walkthrough

> This document explains **the entire application** following its real runtime flow, from the moment an email arrives to the final outputs (JSONL record, Teams alert, ServiceNow ticket).
>
> Each flow step shows the exact code that performs it, and **every line of that code** is explained with four attributes:
>
> | Attribute | Meaning |
> |---|---|
> | **Type** | What kind of code construct it is (import, interface, class, loop, conditional, I/O call, config data, …) |
> | **Role** | What the line does |
> | **Outcome** | What happens / what state changes as a result |
> | **Why** | Why the line exists — its intention in the flow |

---

## 1. What the application is

A TypeScript **multi-agent L1 incident email watcher**. It watches incoming emails, decides whether each one is an IT incident, and if so classifies it:

- **Severity** (P1/P2/P3/P4)
- **Category** (database, api, infrastructure, authentication, analytics, application, …)
- **Owner** (which support team gets it)
- **State** (focus required, addressed, awaiting customer, …)
- **Business impact**
- **Summary** and **recommended next L1 action**

It is built as a **linear pipeline of 8 small "agents"**. Each agent reads and enriches a shared context object, then hands it to the next agent. Classification is **deterministic rule-based** by default (cheap and repeatable), and an optional **Small Language Model (SLM)** — any OpenAI-compatible `/chat/completions` endpoint — is used only as an enrichment layer. If the SLM is off or unreachable, the pipeline still works.

Outputs are persisted to a JSONL file, can post a Teams alert for focus-required incidents, and can optionally create a ServiceNow incident ticket.

## 2. The system flow at a glance

```text
Email arrives
   │
   ▼
┌─ ENTRY POINTS (3 ways in) ─────────────────────────────────────────┐
│ 1. HTTP API      src/server/http-server.ts        POST /detect      │
│ 2. Sample runner scripts/run-sample.ts            reads sample JSON │
│ 3. Mailbox watch scripts/watch-mailbox.ts         polls Outlook     │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
   MultiAgentOrchestrator.detect(email)      (src/core/orchestrator.ts)
   creates an AgentContext and pushes it through a FIXED pipeline
                           │
                           ▼
   AGENT PIPELINE (src/agents/, order matters):
     1. EmailScreeningAgent     → signals: ticket id, severity words, keywords, sender trust
     2. SlmIncidentAgent        → optional SLM enrichment (severity, category, impact, summary)
     3. SeverityClassifierAgent → P1/P2/P3/P4/NON_INCIDENT + confidence
     4. OwnershipResolverAgent  → category → support owner
     5. BusinessImpactAgent     → business impact statement
     6. StatusTrackerAgent      → FOCUS_REQUIRED / ADDRESSED / AWAITING_CUSTOMER / …
     7. ActionAgent             → recommended next L1 action
     8. SummaryAgent            → final concise summary
                           │
                           ▼
   OUTPUTS (DetectionResult JSON)
     ├─ saved to JSONL file            src/storage/jsonl-store.ts
     ├─ optional Teams focus alert     src/integrations/teams-notifier.ts
     └─ optional ServiceNow ticket     src/integrations/servicenow-client.ts
```

## 3. Where every file sits in the flow

| Flow step | File(s) | What it does |
|---|---|---|
| 0. Foundation: config | `src/utils/env.ts`, `src/config/rules.ts` | loads `.env`; holds every rule table used by agents |
| 1. Foundation: data model | `src/core/types.ts` | shared types all agents exchange |
| 2. Entry points | `src/server/http-server.ts`, `scripts/run-sample.ts`, `scripts/watch-mailbox.ts`, `src/clients/graph-mail-client.ts` | the 3 ways an email enters the system |
| 3. Orchestrator | `src/core/orchestrator.ts` | runs the 8 agents in order, assembles the result |
| 4. Agent pipeline | `src/agents/*.ts`, `src/clients/slm-client.ts` | the 8 agents + the SLM HTTP client |
| 5. Persistence | `src/storage/jsonl-store.ts` | stores incidents as JSON Lines |
| 6. Notifications | `src/integrations/teams-notifier.ts` | posts Teams alert for focus-required incidents |
| 7. Ticket integration | `src/integrations/servicenow-client.ts` | creates ServiceNow incident (optional) |
| 8. Public API surface | `src/index.ts` | re-exports the library for other code |
| 9. Verification | `tests/classifier.test.ts` | regression test for the pipeline |
| 10. Data & deployment | `samples/`, `data/`, `package.json`, `tsconfig.json`, `Dockerfile`, `docker-compose.yml`, `Modelfile`, `.env.example` | sample input, stored output, build & run config |

---

## 4. Step-by-step code explanation

## Step 0 — Foundation: configuration

The whole pipeline is rule-driven. Before any email is processed, two config pieces must exist: environment variables (`.env` + loader) and the rule tables. Both are explained here.

### Step 0.1 — `src/utils/env.ts` — Minimal `.env` loader and typed env access

**Type of file:** utility (configuration helper), plain Node.js + TypeScript.

```ts
 1: import fs from "node:fs";
 // Type: import | Role: Loads Node's file-system module | Outcome: `fs` is available | Why: Needed to read the `.env` file from disk | Description: In simple terms, This loads node's file-system module because it is needed to read the `.env` file from disk.
 2: import path from "node:path";
 // Type: import | Role: Loads Node's path module | Outcome: `path` is available | Why: Needed to resolve the `.env` file path against the working directory | Description: In simple terms, This loads node's path module because it is needed to resolve the `.env` file path against the working directory.
 3:
 4: export function loadDotEnv(file = ".env"): void {
 // Type: function declaration | Role: Defines `loadDotEnv`, the manual `.env` parser | Outcome: The function can be called from any entry point | Why: The project intentionally has **no external dotenv dependency**; a small hand-rolled loader is enough | Description: In simple terms, This code defines `loaddotenv`, the manual `.env` parser because the project intentionally has **no external dotenv dependency**; a small hand-rolled loader is enough.
 5:   const p = path.resolve(process.cwd(), file);
 // Type: expression | Role: Builds the absolute path to `.env` (e.g. `/app/.env`) | Outcome: `p` holds the full path | Why: Env file location is always relative to where the process starts | Description: In simple terms, This builds the absolute path to `.env` (e.g. `/app/.env`) because env file location is always relative to where the process starts.
 6:   if (!fs.existsSync(p)) return;
 // Type: conditional | Role: If the file does not exist, stop silently | Outcome: Function returns; no error | Why: A missing `.env` is OK — defaults are used elsewhere | Description: In simple terms, This if the file does not exist, stop silently because a missing `.env` is OK — defaults are used elsewhere.
 7:   const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
 // Type: expression | Role: Reads the whole file and splits it into lines (handles Windows `\r\n`) | Outcome: `lines` is an array of strings | Why: The file is small; reading it fully is fine | Description: In simple terms, This reads the whole file and splits it into lines (handles windows `\r\n`) because the file is small; reading it fully is fine.
 8:   for (const line of lines) {
 // Type: loop | Role: Iterates over every line | Outcome: Each line is examined | Why: Every `KEY=VALUE` pair must be parsed | Description: In simple terms, This iterates over every line because every `KEY=VALUE` pair must be parsed.
 9:     const clean = line.trim();
 // Type: expression | Role: Strips surrounding whitespace | Outcome: `clean` holds the trimmed line | Why: Ignores accidental spaces around keys/values | Description: In simple terms, This strips surrounding whitespace because ignores accidental spaces around keys/values.
10:     if (!clean || clean.startsWith("#")) continue;
// Type: conditional | Role: Skips empty lines and comments (`# ...`) | Outcome: Those lines are ignored | Why: Comments/blank lines are common in `.env` files and carry no config | Description: In simple terms, This skips empty lines and comments (`# ...`) because comments/blank lines are common in `.env` files and carry no config.
11:     const idx = clean.indexOf("=");
// Type: expression | Role: Finds the position of the first `=` | Outcome: `idx` is the split point | Why: The format is always `KEY=VALUE` | Description: In simple terms, This finds the position of the first `=` because the format is always `KEY=VALUE`.
12:     if (idx < 0) continue;
// Type: conditional | Role: Skips lines without an `=` | Outcome: Those lines are ignored | Why: A line without `=` is malformed and useless | Description: In simple terms, This skips lines without an `=` because a line without `=` is malformed and useless.
13:     const key = clean.slice(0, idx).trim();
// Type: expression | Role: Takes the text before `=` as the key | Outcome: `key` holds e.g. `PORT` | Why: Keys identify the variable | Description: In simple terms, This takes the text before `=` as the key because keys identify the variable.
14:     const value = clean.slice(idx + 1).trim();
// Type: expression | Role: Takes the text after `=` as the value | Outcome: `value` holds e.g. `8080` | Why: Values feed the process | Description: In simple terms, This takes the text after `=` as the value because values feed the process.
15:     if (!process.env[key]) process.env[key] = value;
// Type: conditional/assignment | Role: Sets `process.env[key]` **only if not already set** | Outcome: Environment is populated | Why: Real environment variables always win over `.env` (standard dotenv behaviour) | Description: In simple terms, This code sets `process.env[key]` **only if not already set** because real environment variables always win over `.env` (standard dotenv behaviour).
16:   }
// Type: loop terminator | Role: Closes the per-line loop | Outcome: Parsing ends | Why: — | Description: In simple terms, This closes the per-line loop because —.
17: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
18:
19: export function env(name: string, fallback = ""): string {
// Type: function declaration | Role: Defines `env()`: read a string env var with a fallback | Outcome: Callers get a string value that never throws | Why: Central, typed access to config used by clients/integrations | Description: In simple terms, This code defines `env()`: read a string env var with a fallback because central, typed access to config used by clients/integrations.
20:   return process.env[name] ?? fallback;
// Type: expression | Role: Returns `process.env[name]` or the fallback if undefined | Outcome: A concrete string is returned | Why: Missing config should not crash the app at startup | Description: In simple terms, This returns `process.env[name]` or the fallback if undefined because missing config should not crash the app at startup.
21: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
22:
23: export function envBool(name: string, fallback = false): boolean {
// Type: function declaration | Role: Defines `envBool()`: read a boolean env var | Outcome: Callers get a real boolean | Why: Many flags (`SLM_ENABLED`) are toggles | Description: In simple terms, This code defines `envbool()`: read a boolean env var because many flags (`SLM_ENABLED`) are toggles.
24:   const v = process.env[name];
// Type: expression | Role: Reads the raw env value | Outcome: `v` is the string or `undefined` | Why: Needed to distinguish "unset" from "set to false" | Description: In simple terms, This reads the raw env value because it is needed to distinguish "unset" from "set to false".
25:   if (v === undefined) return fallback;
// Type: conditional | Role: If unset, return the fallback | Outcome: `false` is returned by default | Why: Sensible default when the flag is absent | Description: In simple terms, This if unset, return the fallback because sensible default when the flag is absent.
26:   return ["true", "1", "yes", "y"].includes(v.toLowerCase());
// Type: expression | Role: Accepts `true/1/yes/y` (case-insensitive) as true | Outcome: Returns `true` for those values, `false` otherwise | Why: Users write boolean flags in several common formats | Description: In simple terms, This accepts `true/1/yes/y` (case-insensitive) as true because users write boolean flags in several common formats.
27: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

### Step 0.2 — `src/config/rules.ts` — The deterministic rule tables

**Type of file:** configuration data (constants). This is the "brain" of the deterministic agents — all thresholds, regexes, keywords, scores, and routing tables live here. **Type of code:** data declarations + a few `satisfies` type checks.

```ts
 1: import type { SenderType, Severity } from "../core/types.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 2:
 3: export const rules = {
 // Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
 4:   incidentScoreThreshold: 40,
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 5:   slmConfidenceFloor: 65,
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 6:   ticketPatterns: [/\\bINC[0-9]{4,}\\b/i, /\\bSR[0-9]{4,}\\b/i, /\\bCASE[0-9]{4,}\\b/i, /\\bTICKET[0-9]{4,}\\b/i],
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 7:   severityPatterns: {
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 8:     P1: [/\\bP1\\b/i, /\\bSEV[- ]?1\\b/i, /\\bCRITICAL\\b/i, /\\bPROD(UCTION)? DOWN\\b/i],
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 9:     P2: [/\\bP2\\b/i, /\\bSEV[- ]?2\\b/i, /\\bURGENT\\b/i, /\\bESCALATION\\b/i],
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
10:     P3: [/\\bP3\\b/i, /\\bSEV[- ]?3\\b/i, /\\bWARNING\\b/i]
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
11:   } satisfies Record<Exclude<Severity, "P4" | "NON_INCIDENT">, RegExp[]>,
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
12:   keywords: {
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
13:     critical: ["outage", "production down", "unavailable", "application down", "database down", "service down", "data loss", "unable to login", "payment failure"],
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
14:     high: ["incident", "failed", "error", "degraded", "escalation", "business impact", "blocked", "customer impacted"],
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
15:     medium: ["warning", "delay", "slow", "performance", "timeout", "intermittent"],
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
16:     nonIncident: ["enhancement", "change request", "access request", "information request", "newsletter", "release notes"]
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
17:   },
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
18:   senderScore: {
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
19:     vip: 100, customer: 90, operations: 80, monitoring: 75, ticketing: 70, internal: 60, unknown: 30
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
20:   } satisfies Record<SenderType, number>,
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
21:   routing: [
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
22:     { category: "database", owner: "DBA Team", aliases: ["database", "sql", "db", "oracle", "postgres", "mysql", "deadlock"] },
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
23:     { category: "api", owner: "Middleware/API Team", aliases: ["api", "gateway", "apim", "rest", "endpoint"] },
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
24:     { category: "infrastructure", owner: "Infra/Cloud Operations", aliases: ["server", "vm", "cpu", "memory", "disk", "azure", "network", "load balancer"] },
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
25:     { category: "authentication", owner: "IAM Team", aliases: ["login", "auth", "sso", "entra", "aad", "token", "permission"] },
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
26:     { category: "analytics", owner: "Data Platform Support", aliases: ["power bi", "report", "dashboard", "databricks", "data pipeline", "adf", "fabric"] },
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
27:     { category: "application", owner: "Application Support", aliases: ["application", "app", "portal", "ui", "page", "module"] }
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
28:   ],
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
29:   statusPhrases: {
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
30:     ADDRESSED: ["resolved", "fixed", "service restored", "patch applied", "monitoring", "customer informed", "workaround applied"],
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
31:     AWAITING_CUSTOMER: ["awaiting customer", "pending confirmation", "waiting for validation", "customer action required", "please confirm"],
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
32:     FOCUS_REQUIRED: ["no owner", "still down", "not resolved", "urgent attention", "sla breach", "escalated"]
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
33:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
34: };
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

| Config key | Type | Role | Outcome | Why |
|---|---|---|---|---|
| 1 | import (type-only) | Brings in `SenderType` and `Severity` types | Compile-time checking of tables | Guarantees the tables can only hold valid values |
| 3 | declaration | Exports the single `rules` object | Every agent imports one shared config | One source of truth — changing rules here changes behaviour everywhere |
| 4 | data | `incidentScoreThreshold = 40` | Minimum weighted score for something to be an incident | Low-signal emails (score < 40) are classified NON_INCIDENT unless a ticket id exists |
| 5 | data | `slmConfidenceFloor = 65` | Reserved threshold for SLM-based confidence decisions | Kept here so it can be tuned centrally (currently a design placeholder) |
| 6 | data | Regex list that finds ticket references | Matches `INC12345`, `SR12345`, `CASE12345`, `TICKET12345` (case-insensitive) | A real incident usually carries a ticket/system id — the strongest incident signal |
| 7–11 | data | Severity word/pattern regexes per level | Detects "P1", "SEV-1", "CRITICAL", "PROD DOWN" → P1; "URGENT" → P2; "WARNING" → P3 | Emails often state urgency in words; these map words → severity directly |
| 11 | `satisfies` type guard | Ensures only P1/P2/P3 keys exist | Compile error if a wrong key is added | Prevents typos in the table |
| 12–17 | data | Keyword buckets by impact level | critical words weigh +30, high +20, medium +10; non-incident words −25 | Keyword presence is the main scoring engine for the classifier |
| 16 | data | Phrases that mark a NON-incident | "newsletter", "change request", … | Lets the system reject routine mail that looks like an incident |
| 18–20 | data | Sender-trust scores (VIP 100 → unknown 30) | Trusted senders add more weight | Alerts from monitoring/ops are more credible than random senders |
| 20 | `satisfies` type guard | Ensures every `SenderType` has a score | Compile error if a sender type is missing | Keeps the score table complete |
| 21–28 | data | Routing table: category → owner team + keyword aliases | Maps an email's topic to a support owner | This is the deterministic replacement for a human triaging who "owns" the ticket |
| 29–33 | data | Status phrases per lifecycle state | "resolved/fixed" → ADDRESSED; "awaiting customer" → AWAITING_CUSTOMER; "no owner/still down" → FOCUS_REQUIRED | Turns free-text email language into a machine-readable incident state |

---

## Step 1 — Foundation: the data model (`src/core/types.ts`)

**Type of file:** type declarations only (no runtime logic). Every agent reads/writes this shared shape, so it must be defined **before** the agents. This file answers: *what does an email look like, what does a signal look like, what does the context between agents look like, and what is the final result?*

```ts
 1: export type SenderType = "vip" | "customer" | "operations" | "monitoring" | "ticketing" | "internal" | "unknown";
 // Type: type alias (union) | Role: Defines the possible sender types | Outcome: A sender is exactly one of these 7 values | Why: Lets the screening agent score trust by who sent the mail | Description: In simple terms, This code defines the possible sender types because lets the screening agent score trust by who sent the mail.
 2: export type Severity = "P1" | "P2" | "P3" | "P4" | "NON_INCIDENT";
 // Type: type alias (union) | Role: Defines severities | Outcome: Severity is P1…P4 or NON_INCIDENT | Why: The severity ladder is a fixed business vocabulary | Description: In simple terms, This code defines severities because the severity ladder is a fixed business vocabulary.
 3: export type IncidentState = "FOCUS_REQUIRED" | "ADDRESSED" | "AWAITING_CUSTOMER" | "ESCALATE_L2" | "WATCH" | "NON_INCIDENT";
 // Type: type alias (union) | Role: Defines incident lifecycle states | Outcome: State is one of the 6 values | Why: States drive the next action and the Teams alert | Description: In simple terms, This code defines incident lifecycle states because states drive the next action and the Teams alert.
 4:
 5: export interface EmailMessage {
 // Type: interface | Role: Shapes an incoming email | Outcome: Any email in the system has at least id/subject/body/sender | Why: This is the input contract for all 3 entry points | Description: In simple terms, This shapes an incoming email because this is the input contract for all 3 entry points.
 6:   messageId: string;
 // Type: fields | Role: Core email fields | Outcome: messageId, subject, body, sender always exist | Why: Required for matching, display, and screening | Description: In simple terms, This core email fields because it is required for matching, display, and screening.
 7:   subject: string;
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 8:   body: string;
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 9:   sender: string;
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
10:   senderType?: SenderType;
// Type: optional fields | Role: Extra context when available | Outcome: senderType, timestamps, conversation id, importance, categories, metadata | Why: Outlook/Graph can supply these; sample input often cannot | Description: In simple terms, This extra context when available because outlook/Graph can supply these; sample input often cannot.
11:   receivedAt?: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
12:   conversationId?: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
13:   importance?: "low" | "normal" | "high" | string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
14:   categories?: string[];
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
15:   metadata?: Record<string, unknown>;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
16: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
17:
18: export interface IncidentSignal {
// Type: interface | Role: Shapes one screening signal | Outcome: Each signal has source, name, weight, evidence | Why: Signals are the currency the classifier sums up | Description: In simple terms, This shapes one screening signal because signals are the currency the classifier sums up.
19:   source: string;
// Type: fields | Role: Signal parts | Outcome: Who found it, what it is, how much it weighs, what text triggered it | Why: Weight drives scoring; evidence enables auditing/explainability | Description: In simple terms, This signal parts because weight drives scoring; evidence enables auditing/explainability.
20:   name: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
21:   weight: number;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
22:   evidence: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
23: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
24:
25: export interface AgentContext {
// Type: interface | Role: The **shared context** passed from agent to agent | Outcome: One object holding everything known so far | Why: This is the backbone of the multi-agent design — each agent mutates it in place | Description: In simple terms, This the **shared context** passed from agent to agent because this is the backbone of the multi-agent design — each agent mutates it in place.
26:   email: EmailMessage;
// Type: fields | Role: The email plus all collected signals | Outcome: Present from the very start | Why: Later agents only read what earlier agents put in | Description: In simple terms, This the email plus all collected signals because later agents only read what earlier agents put in.
27:   signals: IncidentSignal[];
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
28:   isIncident?: boolean;
// Type: optional fields | Role: Progressive enrichment | Outcome: severity, category, owner, state, etc. get filled by their agents | Why: Optional allows "not yet known" while the pipeline runs | Description: In simple terms, This progressive enrichment because optional allows "not yet known" while the pipeline runs.
29:   incidentId?: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
30:   severity?: Severity;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
31:   category?: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
32:   owner?: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
33:   businessImpact?: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
34:   state?: IncidentState;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
35:   confidence?: number;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
36:   summary?: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
37:   nextAction?: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
38:   audit: string[];
// Type: field | Role: Audit trail (array of log strings) | Outcome: Every agent appends what it did | Why: Provides full explainability of each classification | Description: In simple terms, This audit trail (array of log strings) because provides full explainability of each classification.
39: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
40:
41: export interface Agent<I = AgentContext, O = AgentContext> {
// Type: interface | Role: The **contract every agent implements** | Outcome: Any object with `name` + `run()` is an agent | Why: The orchestrator can treat all 8 agents identically (polymorphism) | Description: In simple terms, This the **contract every agent implements** because the orchestrator can treat all 8 agents identically (polymorphism).
42:   name: string;
// Type: field | Role: Agent's human-readable name | Outcome: Used in signals and audit messages | Why: Traceability of which agent produced what | Description: In simple terms, This agent's human-readable name because traceability of which agent produced what.
43:   run(input: I): Promise<O>;
// Type: method signature | Role: `run(input): Promise<O>` | Outcome: Each agent returns the (possibly enriched) context | Why: All agents are async so the SLM call can await network I/O | Description: In simple terms, This `run(input): promise<o>` because all agents are async so the SLM call can await network I/O.
44: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
45:
46: export interface DetectionResult {
// Type: interface | Role: The **final output** returned to callers | Outcome: Complete, non-optional result | Why: The HTTP API, store, Teams, and ServiceNow all consume this shape | Description: In simple terms, This the **final output** returned to callers because the HTTP API, store, Teams, and ServiceNow all consume this shape.
47:   isIncident: boolean;
// Type: fields | Role: Every result field with a guaranteed value | Outcome: isIncident, severity, category, owner, state, confidence, impact, summary, next action | Why: The orchestrator fills gaps with defaults so callers never see `undefined` | Description: In simple terms, This every result field with a guaranteed value because the orchestrator fills gaps with defaults so callers never see `undefined`.
48:   incidentId?: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
49:   severity: Severity;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
50:   category: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
51:   owner: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
52:   state: IncidentState;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
53:   confidence: number;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
54:   businessImpact: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
55:   summary: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
56:   nextAction: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
57:   signals: IncidentSignal[];
// Type: fields | Role: Signals + audit trail in the result | Outcome: Same arrays collected during the run | Why: Keeps the result fully explainable end-to-end | Description: In simple terms, This signals + audit trail in the result because keeps the result fully explainable end-to-end.
58:   audit: string[];
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
59: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

## Step 2 — Entry points: where emails enter the system

There are **3 entry points**. All of them eventually call the same `orchestrator.detect(email)` — the difference is only *how the email arrives*.

### Step 2.1 — `src/server/http-server.ts` — The HTTP API (main production entry point)

**Type of file:** server / request handling (Node built-in `http` module, no framework). Started with `npm run api` (or in Docker). It exposes 4 endpoints: `GET /health`, `POST /detect`, `GET /incidents`, `GET /summary`.

```ts
 1: import http from "node:http";
 // Type: import | Role: Loads Node's built-in HTTP module | Outcome: `http` available | Why: The server uses zero frameworks — Node's http module is enough for 4 endpoints | Description: In simple terms, This loads node's built-in http module because the server uses zero frameworks — Node's http module is enough for 4 endpoints.
 2: import { MultiAgentOrchestrator } from "../core/orchestrator.js";
 // Type: imports | Role: Loads the orchestrator, store, and Teams notifier | Outcome: All main components are instantiable here | Why: The API is the place where the pipeline, storage, and notifications meet | Description: In simple terms, This loads the orchestrator, store, and teams notifier because the API is the place where the pipeline, storage, and notifications meet.
 3: import { JsonlIncidentStore } from "../storage/jsonl-store.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 4: import { TeamsNotifier } from "../integrations/teams-notifier.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 5: import type { EmailMessage } from "../core/types.js";
 // Type: imports | Role: Loads `EmailMessage` type + env helpers | Outcome: Types and config access ready | Why: `readJson` casts the body to `EmailMessage`; `PORT` comes from env | Description: In simple terms, This loads `emailmessage` type + env helpers because `readJson` casts the body to `EmailMessage`; `PORT` comes from env.
 6: import { env, loadDotEnv } from "../utils/env.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 7:
 8: loadDotEnv();
 // Type: call | Role: Loads `.env` into `process.env` before anything else | Outcome: All env vars are available from here on | Why: Config must exist before the app reads `PORT` etc. | Description: In simple terms, This loads `.env` into `process.env` before anything else because config must exist before the app reads `PORT` etc..
 9: const orchestrator = new MultiAgentOrchestrator();
 // Type: expression | Role: Creates the agent pipeline once | Outcome: One shared orchestrator for all requests | Why: Agents are stateless between runs, so a single instance is safe and cheap | Description: In simple terms, This code creates the agent pipeline once because agents are stateless between runs, so a single instance is safe and cheap.
10: const store = new JsonlIncidentStore();
// Type: expression | Role: Creates the JSONL store | Outcome: Store is ready to save/list incidents | Why: Incident records persist between requests | Description: In simple terms, This code creates the jsonl store because incident records persist between requests.
11: const notifier = new TeamsNotifier();
// Type: expression | Role: Creates the Teams notifier | Outcome: Notifier ready (webhook read from env) | Why: Focus-required incidents can alert Teams automatically | Description: In simple terms, This code creates the teams notifier because focus-required incidents can alert Teams automatically.
12: const port = Number(env("PORT", "8080"));
// Type: expression | Role: Reads `PORT` env var, defaults to 8080 | Outcome: `port` is a number | Why: Lets ops choose the port without code changes | Description: In simple terms, This reads `port` env var, defaults to 8080 because lets ops choose the port without code changes.
13:
14: async function readJson<T>(req: http.IncomingMessage): Promise<T> {
// Type: function declaration | Role: Helper that reads the whole request body and parses JSON | Outcome: Returns the typed body object | Why: `/detect` receives an `EmailMessage` as JSON in the POST body | Description: In simple terms, This helper that reads the whole request body and parses json because `/detect` receives an `EmailMessage` as JSON in the POST body.
15:   const chunks: Buffer[] = [];
// Type: expression | Role: Buffer array to collect stream chunks | Outcome: `chunks` is empty, ready to fill | Why: Incoming request is a stream; must be drained before parsing | Description: In simple terms, This buffer array to collect stream chunks because incoming request is a stream; must be drained before parsing.
16:   for await (const chunk of req) chunks.push(Buffer.from(chunk));
// Type: loop | Role: Asynchronously drains every chunk | Outcome: All bytes collected into `chunks` | Why: `for await` handles arbitrary body sizes without blocking the server | Description: In simple terms, This asynchronously drains every chunk because `for await` handles arbitrary body sizes without blocking the server.
17:   return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
// Type: expression | Role: Concatenates the chunks and parses JSON | Outcome: A typed object (e.g. the email) | Why: The parsed body is what the pipeline will analyse | Description: In simple terms, This concatenates the chunks and parses json because the parsed body is what the pipeline will analyse.
18: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
19:
20: const server = http.createServer(async (req, res) => {
// Type: expression | Role: Creates the HTTP server; every request runs the handler | Outcome: Server object created | Why: Node http server handles each request via this callback | Description: In simple terms, This code creates the http server; every request runs the handler because node http server handles each request via this callback.
21:   res.setHeader("Content-Type", "application/json");
// Type: expression | Role: Sets `Content-Type: application/json` on every response | Outcome: Clients always get JSON | Why: Every endpoint returns JSON, so it is set once for all | Description: In simple terms, This code sets `content-type: application/json` on every response because every endpoint returns JSON, so it is set once for all.
22:   try {
// Type: try block | Role: Wraps the request handling | Outcome: Errors are caught below | Why: One central error handler keeps responses well-formed | Description: In simple terms, This wraps the request handling because one central error handler keeps responses well-formed.
23:     if (req.method === "GET" && req.url === "/health") {
// Type: conditional | Role: Matches `GET /health` | Outcome: Health route selected | Why: Liveness probe for Docker/load balancers | Description: In simple terms, This matches `get /health` because liveness probe for Docker/load balancers.
24:       res.end(JSON.stringify({ status: "ok", service: "l1-incident-multi-agent-slm-ts" }));
// Type: expression | Role: Responds with `{status:"ok", service:...}` | Outcome: Client receives a 200 JSON health payload | Why: Confirms the service is running | Description: In simple terms, This responds with `{status:"ok", service:...}` because confirms the service is running.
25:       return;
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
26:     }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
27:     if (req.method === "POST" && req.url === "/detect") {
// Type: conditional | Role: Matches `POST /detect` — the **core endpoint** | Outcome: Detection route selected | Why: This is where an external system submits an email for triage | Description: In simple terms, This matches `post /detect` — the **core endpoint** because this is where an external system submits an email for triage.
28:       const email = await readJson<EmailMessage>(req);
// Type: expression | Role: Parses the request body as an `EmailMessage` | Outcome: `email` holds the submitted message | Why: The pipeline needs a typed email to start | Description: In simple terms, This parses the request body as an `emailmessage` because the pipeline needs a typed email to start.
29:       const result = await orchestrator.detect(email);
// Type: expression | Role: **Runs the whole agent pipeline** | Outcome: `result` is the full `DetectionResult` | Why: This single call is the heart of the application (see Step 3) | Description: In simple terms, This **runs the whole agent pipeline** because this single call is the heart of the application (see Step 3).
30:       store.save(email, result);
// Type: call | Role: Persists the incident to JSONL | Outcome: Record appended to `data/incidents.jsonl` | Why: Incidents must survive restarts and be queryable later | Description: In simple terms, This persists the incident to jsonl because incidents must survive restarts and be queryable later.
31:       await notifier.sendFocusAlert(email, result);
// Type: call | Role: Sends a Teams alert if the state requires focus | Outcome: Optional HTTP POST to Teams webhook | Why: Alerting is fire-and-forget — non-focus incidents are skipped inside | Description: In simple terms, This sends a teams alert if the state requires focus because alerting is fire-and-forget — non-focus incidents are skipped inside.
32:       res.end(JSON.stringify(result, null, 2));
// Type: expression | Role: Responds with the pretty-printed result | Outcome: Caller receives the full classification JSON | Why: The result is the value delivered back to the requester | Description: In simple terms, This responds with the pretty-printed result because the result is the value delivered back to the requester.
33:       return;
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
34:     }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
35:     if (req.method === "GET" && req.url?.startsWith("/incidents")) {
// Type: conditional | Role: Matches `GET /incidents` | Outcome: Listing route selected | Why: Lets dashboards/CLI read back stored incidents | Description: In simple terms, This matches `get /incidents` because lets dashboards/CLI read back stored incidents.
36:       res.end(JSON.stringify(store.list(100), null, 2));
// Type: expression | Role: Returns the 100 most recent incidents | Outcome: JSON array of stored incidents | Why: Simple read API over the JSONL store | Description: In simple terms, This returns the 100 most recent incidents because simple read API over the JSONL store.
37:       return;
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
38:     }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
39:     if (req.method === "GET" && req.url === "/summary") {
// Type: conditional | Role: Matches `GET /summary` | Outcome: Summary route selected | Why: Aggregated view for dashboards | Description: In simple terms, This matches `get /summary` because aggregated view for dashboards.
40:       res.end(JSON.stringify(store.summary(), null, 2));
// Type: expression | Role: Returns counts by severity/state + top focus incidents | Outcome: JSON summary object | Why: Gives an at-a-glance incident health view | Description: In simple terms, This returns counts by severity/state + top focus incidents because gives an at-a-glance incident health view.
41:       return;
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
42:     }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
43:     res.statusCode = 404;
// Type: statement | Role: Unknown route → 404 status | Outcome: Response status set to 404 | Why: Invalid URLs must not silently succeed | Description: In simple terms, This unknown route → 404 status because invalid URLs must not silently succeed.
44:     res.end(JSON.stringify({ error: "Not found" }));
// Type: expression | Role: Responds with a JSON error body | Outcome: Client sees `{"error":"Not found"}` | Why: Consistent JSON error format | Description: In simple terms, This responds with a json error body because consistent JSON error format.
45:   } catch (error) {
// Type: catch | Role: Catches any exception in the handler | Outcome: 500 response with the error message | Why: Prevents the server from crashing on bad input or downstream failures | Description: In simple terms, This catches any exception in the handler because prevents the server from crashing on bad input or downstream failures.
46:     res.statusCode = 500;
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
47:     res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }));
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
48:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
49: });
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
50:
51: server.listen(port, () => console.log(`L1 multi-agent SLM API listening on ${port}`));
// Type: call | Role: Starts listening on `port` | Outcome: Server accepts connections; logs the port | Why: Without this the process would start and exit immediately | Description: In simple terms, This starts listening on `port` because without this the process would start and exit immediately.
```

### Step 2.2 — `scripts/run-sample.ts` — Offline demo entry point

**Type of file:** script (run with `npm run sample`). Loads sample emails from `samples/sample-emails.json`, pushes each through the pipeline, saves incidents, prints results. Great for trying the system without a mailbox or API.

```ts
 1: import fs from "node:fs";
 // Type: imports | Role: Brings in fs, orchestrator, store, types, env loader | Outcome: Everything needed for a batch run | Why: The script is a small composition of the same core pieces the API uses | Description: In simple terms, This brings in fs, orchestrator, store, types, env loader because the script is a small composition of the same core pieces the API uses.
 2: import { MultiAgentOrchestrator } from "../src/core/orchestrator.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 3: import { JsonlIncidentStore } from "../src/storage/jsonl-store.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 4: import type { EmailMessage } from "../src/core/types.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 5: import { loadDotEnv } from "../src/utils/env.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 6:
 7: loadDotEnv();
 // Type: call | Role: Loads `.env` (e.g. so the SLM can be enabled) | Outcome: Env config available | Why: The sample run can exercise the SLM if it is configured | Description: In simple terms, This loads `.env` (e.g. so the slm can be enabled) because the sample run can exercise the SLM if it is configured.
 8: const emails = JSON.parse(fs.readFileSync("samples/sample-emails.json", "utf8")) as EmailMessage[];
 // Type: expression | Role: Reads and parses the sample emails file | Outcome: `emails` is an array of `EmailMessage` | Why: Provides realistic input without a live mailbox | Description: In simple terms, This reads and parses the sample emails file because provides realistic input without a live mailbox.
 9: const orchestrator = new MultiAgentOrchestrator();
 // Type: expression | Role: Creates the pipeline once | Outcome: Orchestrator ready | Why: Same single-instance pattern as the server | Description: In simple terms, This code creates the pipeline once because same single-instance pattern as the server.
10: const store = new JsonlIncidentStore("data/sample-incidents.jsonl");
// Type: expression | Role: Creates the store writing to the sample file | Outcome: `data/sample-incidents.jsonl` will hold results | Why: Keeps demo output separate from real production data | Description: In simple terms, This code creates the store writing to the sample file because keeps demo output separate from real production data.
11: for (const email of emails) {
// Type: loop | Role: Iterates over every sample email | Outcome: Each email is processed once | Why: The script processes a batch of inputs | Description: In simple terms, This iterates over every sample email because the script processes a batch of inputs.
12:   const result = await orchestrator.detect(email);
// Type: expression | Role: Runs the full agent pipeline for one email | Outcome: `result` holds the classification | Why: Same call the API uses — identical behaviour | Description: In simple terms, This runs the full agent pipeline for one email because same call the API uses — identical behaviour.
13:   store.save(email, result);
// Type: call | Role: Saves the incident (skipped for non-incidents) | Outcome: Sample incidents accumulate in the JSONL file | Why: Demonstrates persistence | Description: In simple terms, This saves the incident (skipped for non-incidents) because demonstrates persistence.
14:   console.log(JSON.stringify(result, null, 2));
// Type: call | Role: Prints the pretty-printed result | Outcome: Full JSON visible in the terminal | Why: Lets you eyeball each classification | Description: In simple terms, This prints the pretty-printed result because lets you eyeball each classification.
15: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
16: console.log("Summary:", JSON.stringify(store.summary(), null, 2));
// Type: call | Role: Prints the aggregate summary | Outcome: Severity/state counts + top focus list | Why: Shows the store's summary capability end-to-end | Description: In simple terms, This prints the aggregate summary because shows the store's summary capability end-to-end.
```

### Step 2.3 — `scripts/watch-mailbox.ts` — Live Outlook watcher

**Type of file:** script (long-running; Ctrl+C to stop). Polls a shared mailbox via Microsoft Graph every N seconds, feeds new emails into the pipeline, saves results, and alerts Teams. This is the "watcher" mode the package is named for.

```ts
 1: import { loadDotEnv, env } from "../src/utils/env.js";
 // Type: imports | Role: Loads env utils, Graph client, orchestrator, store, notifier | Outcome: All components available | Why: The watcher composes the same core as the API | Description: In simple terms, This loads env utils, graph client, orchestrator, store, notifier because the watcher composes the same core as the API.
 2: import { GraphMailClient } from "../src/clients/graph-mail-client.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 3: import { MultiAgentOrchestrator } from "../src/core/orchestrator.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 4: import { JsonlIncidentStore } from "../src/storage/jsonl-store.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 5: import { TeamsNotifier } from "../src/integrations/teams-notifier.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 6:
 7: loadDotEnv();
 // Type: call | Role: Loads `.env` (Graph credentials live there) | Outcome: Env config ready | Why: Without the env, `GraphMailClient` throws at construction | Description: In simple terms, This loads `.env` (graph credentials live there) because without the env, `GraphMailClient` throws at construction.
 8: const graph = new GraphMailClient();
 // Type: expression | Role: Creates the Microsoft Graph client | Outcome: `graph` ready to fetch mail | Why: Graph needs tenant/client/secret from env | Description: In simple terms, This code creates the microsoft graph client because graph needs tenant/client/secret from env.
 9: const orchestrator = new MultiAgentOrchestrator();
 // Type: expressions | Role: Creates pipeline, store, notifier | Outcome: All services instantiated | Why: Same pattern as other entry points | Description: In simple terms, This code creates pipeline, store, notifier because same pattern as other entry points.
10: const store = new JsonlIncidentStore();
// Type: variable | Role: Declares a variable | Outcome: Variable initialized | Why: Stores data for later use | Description: In simple terms, This declares a variable because stores data for later use.
11: const notifier = new TeamsNotifier();
// Type: variable | Role: Declares a variable | Outcome: Variable initialized | Why: Stores data for later use | Description: In simple terms, This declares a variable because stores data for later use.
12: const seen = new Set<string>();
// Type: expression | Role: Empty `Set` of seen message ids | Outcome: `seen` tracks processed emails | Why: Prevents re-processing the same email every poll cycle | Description: In simple terms, This empty `set` of seen message ids because prevents re-processing the same email every poll cycle.
13: const pollMs = Number(env("MAIL_POLL_SECONDS", "60")) * 1000;
// Type: expression | Role: Reads poll interval in seconds, converts to ms | Outcome: `pollMs` (default 60 000 ms) | Why: Configurable watch frequency via env | Description: In simple terms, This reads poll interval in seconds, converts to ms because configurable watch frequency via env.
14:
15: console.log("Starting Outlook L1 multi-agent watcher. Press Ctrl+C to stop.");
// Type: call | Role: Prints a startup message | Outcome: User knows the watcher is running | Why: Friendly UX for a long-running script | Description: In simple terms, This prints a startup message because friendly UX for a long-running script.
16: setInterval(async () => {
// Type: expression | Role: Schedules the poll callback every `pollMs` | Outcome: Watcher loops forever until killed | Why: Polling is the chosen mechanism (no push subscriptions needed) | Description: In simple terms, This schedules the poll callback every `pollms` because polling is the chosen mechanism (no push subscriptions needed).
17:   const messages = await graph.fetchRecentMessages();
// Type: expression | Role: Fetches recent inbox messages from Graph | Outcome: `messages` is an array of `EmailMessage` | Why: This is the ingestion step of the live flow | Description: In simple terms, This fetches recent inbox messages from graph because this is the ingestion step of the live flow.
18:   for (const email of messages) {
// Type: loop | Role: Iterates the fetched messages | Outcome: Each message considered | Why: Every new mail must be triaged | Description: In simple terms, This iterates the fetched messages because every new mail must be triaged.
19:     if (seen.has(email.messageId)) continue;
// Type: conditional | Role: Skips emails already seen | Outcome: Duplicates ignored | Why: Idempotency — the same email is never classified twice | Description: In simple terms, This skips emails already seen because idempotency — the same email is never classified twice.
20:     seen.add(email.messageId);
// Type: call | Role: Marks the email as seen | Outcome: `seen` now contains it | Why: Order matters: mark before processing so overlapping runs don't double-fire | Description: In simple terms, This marks the email as seen because order matters: mark before processing so overlapping runs don't double-fire.
21:     const result = await orchestrator.detect(email);
// Type: expression | Role: Runs the agent pipeline | Outcome: `result` = classification | Why: The actual triage (identical for all entry points) | Description: In simple terms, This runs the agent pipeline because the actual triage (identical for all entry points).
22:     store.save(email, result);
// Type: call | Role: Saves incident to JSONL | Outcome: Record persisted | Why: Same store as the API — a shared incident history | Description: In simple terms, This saves incident to jsonl because same store as the API — a shared incident history.
23:     await notifier.sendFocusAlert(email, result);
// Type: call | Role: Alerts Teams for focus-required states | Outcome: Teams webhook POST when applicable | Why: L1 team gets notified of actionable incidents in near-real time | Description: In simple terms, This alerts teams for focus-required states because l1 team gets notified of actionable incidents in near-real time.
24:     if (result.isIncident) console.log(`${result.state} | ${result.severity} | ${result.owner} | ${result.summary}`);
// Type: conditional/call | Role: Logs a one-line summary for incidents only | Outcome: Concise console line per incident | Why: Keeps the terminal readable (non-incidents are silent) | Description: In simple terms, This logs a one-line summary for incidents only because keeps the terminal readable (non-incidents are silent).
25:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
26: }, pollMs);
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
```

### Step 2.4 — `src/clients/graph-mail-client.ts` — Microsoft Graph ingestion client

**Type of file:** integration client. Used by the watcher (Step 2.3) to pull emails from a shared Outlook mailbox using Microsoft's Graph API with client-credential (app-only) auth.

```ts
 1: import { ConfidentialClientApplication } from "@azure/msal-node";
 // Type: import | Role: Loads MSAL (Microsoft Authentication Library) | Outcome: Can authenticate as a confidential client | Why: Client-credential flow is the standard app-only way to access Graph | Description: In simple terms, This loads msal (microsoft authentication library) because client-credential flow is the standard app-only way to access Graph.
 2: import type { EmailMessage, SenderType } from "../core/types.js";
 // Type: imports | Role: Loads types + env helper | Outcome: Types/config ready | Why: Graph responses are mapped onto the app's `EmailMessage` shape | Description: In simple terms, This loads types + env helper because graph responses are mapped onto the app's `EmailMessage` shape.
 3: import { env } from "../utils/env.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 4:
 5: interface GraphMessage {
 // Type: interface | Role: Local shape of a raw Graph message | Outcome: Describes Graph's JSON response | Why: Only the fields we need are modelled — the rest is ignored | Description: In simple terms, This local shape of a raw graph message because only the fields we need are modelled — the rest is ignored.
 6:   id: string;
 // Type: fields | Role: Raw Graph fields | Outcome: id, subject, bodyPreview, from, receivedDateTime, conversationId, importance, categories | Why: These map 1:1 to the app's email model | Description: In simple terms, This raw graph fields because these map 1:1 to the app's email model.
 7:   subject?: string;
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 8:   bodyPreview?: string;
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 9:   from?: { emailAddress?: { address?: string } };
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
10:   receivedDateTime?: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
11:   conversationId?: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
12:   importance?: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
13:   categories?: string[];
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
14: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
15:
16: export class GraphMailClient {
// Type: class | Role: `GraphMailClient` with Graph credentials from env | Outcome: Client configured at construction | Why: Encapsulates all Graph specifics in one place | Description: In simple terms, This `graphmailclient` with graph credentials from env because encapsulates all Graph specifics in one place.
17:   private readonly tenantId = env("TENANT_ID");
// Type: fields | Role: Reads credentials from env | Outcome: tenantId, clientId, clientSecret, mailboxUserId | Why: Graph needs an Azure AD app registration + a mailbox to read | Description: In simple terms, This reads credentials from env because graph needs an Azure AD app registration + a mailbox to read.
18:   private readonly clientId = env("CLIENT_ID");
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
19:   private readonly clientSecret = env("CLIENT_SECRET");
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
20:   private readonly mailboxUserId = env("MAILBOX_USER_ID");
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
21:   private readonly scope = "https://graph.microsoft.com/.default";
// Type: field | Role: The fixed OAuth scope | Outcome: `.default` scope string | Why: `.default` requests all permissions the app registration was granted | Description: In simple terms, This the fixed oauth scope because `.default` requests all permissions the app registration was granted.
22:   private readonly app: ConfidentialClientApplication;
// Type: field | Role: Holds the MSAL app instance | Outcome: Declared for later use | Why: Built in the constructor once credentials are validated | Description: In simple terms, This holds the msal app instance because built in the constructor once credentials are validated.
23:
24:   constructor() {
// Type: constructor | Role: Validates config and builds the MSAL client | Outcome: Either throws or produces `this.app` | Why: Fail fast: no point starting a watcher with bad credentials | Description: In simple terms, This validates config and builds the msal client because fail fast: no point starting a watcher with bad credentials.
25:     if (!this.tenantId || !this.clientId || !this.clientSecret || !this.mailboxUserId) {
// Type: conditional/throw | Role: If any credential is missing, crash with a clear message | Outcome: Process exits with an explanatory error | Why: Misconfiguration should be loud, not silent | Description: In simple terms, This if any credential is missing, crash with a clear message because misconfiguration should be loud, not silent.
26:       throw new Error("Missing Graph env values: TENANT_ID, CLIENT_ID, CLIENT_SECRET, MAILBOX_USER_ID.");
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
27:     }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
28:     this.app = new ConfidentialClientApplication({
// Type: expression | Role: Instantiates `ConfidentialClientApplication` with auth config | Outcome: MSAL client ready to get tokens | Why: It needs clientId, authority (tenant), and clientSecret | Description: In simple terms, This instantiates `confidentialclientapplication` with auth config because it needs clientId, authority (tenant), and clientSecret.
29:       auth: {
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
30:         clientId: this.clientId,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
31:         authority: `https://login.microsoftonline.com/${this.tenantId}`,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
32:         clientSecret: this.clientSecret
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
33:       }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
34:     });
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
35:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
36:
37:   async fetchRecentMessages(lookbackMinutes = Number(env("MAIL_LOOKBACK_MINUTES", "30")), top = 25): Promise<EmailMessage[]> {
// Type: method declaration | Role: Fetches recent inbox messages | Outcome: Returns `EmailMessage[]` | Why: This is the ingestion contract for the watcher | Description: In simple terms, This fetches recent inbox messages because this is the ingestion contract for the watcher.
38:     const token = await this.token();
// Type: expression | Role: Acquires an access token first | Outcome: `token` is a bearer string | Why: Every Graph request must be authorized | Description: In simple terms, This acquires an access token first because every Graph request must be authorized.
39:     const since = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();
// Type: expression | Role: Computes the lookback timestamp (ISO) | Outcome: `since` e.g. 30 min ago | Why: `$filter` only returns messages newer than this | Description: In simple terms, This computes the lookback timestamp (iso) because `$filter` only returns messages newer than this.
40:     const url = new URL(`https://graph.microsoft.com/v1.0/users/${this.mailboxUserId}/mailFolders/inbox/messages`);
// Type: expression | Role: Builds the Graph URL for the mailbox inbox | Outcome: URL points at the shared mailbox's inbox | Why: Graph REST path for listing messages | Description: In simple terms, This builds the graph url for the mailbox inbox because graph REST path for listing messages.
41:     url.searchParams.set("$top", String(top));
// Type: expressions | Role: Sets OData query params: top 25, selected fields, newest first, filtered by time | Outcome: The request fetches exactly what's needed | Why: Minimizes payload; avoids fetching attachments/bodies in full | Description: In simple terms, This code sets odata query params: top 25, selected fields, newest first, filtered by time because minimizes payload; avoids fetching attachments/bodies in full.
42:     url.searchParams.set("$select", "id,subject,bodyPreview,from,receivedDateTime,conversationId,importance,categories");
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
43:     url.searchParams.set("$orderby", "receivedDateTime desc");
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
44:     url.searchParams.set("$filter", `receivedDateTime ge ${since}`);
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
45:     const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
// Type: expression | Role: Performs the authenticated GET request | Outcome: Raw JSON response | Why: Native `fetch` — no extra HTTP library dependency | Description: In simple terms, This performs the authenticated get request because native `fetch` — no extra HTTP library dependency.
46:     if (!response.ok) throw new Error(`Graph fetch failed: ${response.status} ${await response.text()}`);
// Type: conditional/throw | Role: Non-2xx → throw with status + body | Outcome: Caller sees the failure | Why: Surfacing Graph errors aids debugging | Description: In simple terms, This non-2xx → throw with status + body because surfacing Graph errors aids debugging.
47:     const data = await response.json() as { value?: GraphMessage[] };
// Type: expression | Role: Parses the response | Outcome: `data.value` is the message array | Why: Graph wraps results in `{ "value": [...] }` | Description: In simple terms, This parses the response because graph wraps results in `{ "value": [...] }`.
48:     return (data.value ?? []).map(m => {
// Type: expression | Role: Maps each Graph message → app `EmailMessage` | Outcome: A clean array of typed emails | Why: The pipeline only understands the app's email shape | Description: In simple terms, This maps each graph message → app `emailmessage` because the pipeline only understands the app's email shape.
49:       const sender = m.from?.emailAddress?.address ?? "";
// Type: expressions | Role: Copies id → messageId, subject, bodyPreview → body, sender address | Outcome: Email core fields populated | Why: Same names as the `EmailMessage` interface | Description: In simple terms, This copies id → messageid, subject, bodypreview → body, sender address because same names as the `EmailMessage` interface.
50:       return {
// Type: return | Role: Returns a value | Outcome: Function exits with value | Why: Passes result to caller | Description: In simple terms, This returns a value because passes result to caller.
51:         messageId: m.id,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
52:         subject: m.subject ?? "",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
53:         body: m.bodyPreview ?? "",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
54:         sender,
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
55:         senderType: this.senderType(sender, m.categories ?? []),
// Type: call | Role: Runs the same sender-trust heuristic | Outcome: `senderType` guessed for each email | Why: Lets the classifier weight sender trust even without an explicit type | Description: In simple terms, This runs the same sender-trust heuristic because lets the classifier weight sender trust even without an explicit type.
56:         receivedAt: m.receivedDateTime,
// Type: expressions | Role: Copies receivedAt, conversationId, importance, categories | Outcome: Optional metadata preserved | Why: Useful for dedupe (conversationId) and display | Description: In simple terms, This copies receivedat, conversationid, importance, categories because useful for dedupe (conversationId) and display.
57:         conversationId: m.conversationId,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
58:         importance: m.importance,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
59:         categories: m.categories ?? []
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
60:       };
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
61:     });
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
62:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
63:
64:   private async token(): Promise<string> {
// Type: method declaration | Role: Acquires a client-credential token | Outcome: Returns the access token | Why: App-only auth — no user login needed for a service mailbox | Description: In simple terms, This acquires a client-credential token because app-only auth — no user login needed for a service mailbox.
65:     const result = await this.app.acquireTokenByClientCredential({ scopes: [this.scope] });
// Type: expressions | Role: MSAL call + guard | Outcome: Throws if no token | Why: A missing token means Graph calls would 401 | Description: In simple terms, This msal call + guard because a missing token means Graph calls would 401.
66:     if (!result?.accessToken) throw new Error("Unable to acquire Microsoft Graph token.");
// Type: conditional | Role: Evaluates condition | Outcome: Branch executed if true | Why: Control flow logic | Description: In simple terms, This evaluates condition because control flow logic.
67:     return result.accessToken;
// Type: return | Role: Returns a value | Outcome: Function exits with value | Why: Passes result to caller | Description: In simple terms, This returns a value because passes result to caller.
68:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
69:
70:   private senderType(sender: string, categories: string[]): SenderType {
// Type: method | Role: Heuristic: sender address → SenderType | Outcome: monitoring / ticketing / customer / internal / unknown | Why: Same logic the screening agent uses for explicit senders | Description: In simple terms, This heuristic: sender address → sendertype because same logic the screening agent uses for explicit senders.
71:     const lower = sender.toLowerCase();
// Type: variable | Role: Declares a variable | Outcome: Variable initialized | Why: Stores data for later use | Description: In simple terms, This declares a variable because stores data for later use.
72:     const cat = categories.join(" ").toLowerCase();
// Type: variable | Role: Declares a variable | Outcome: Variable initialized | Why: Stores data for later use | Description: In simple terms, This declares a variable because stores data for later use.
73:     if (lower.includes("monitor") || lower.includes("alert") || cat.includes("monitoring")) return "monitoring";
// Type: conditional | Role: Evaluates condition | Outcome: Branch executed if true | Why: Control flow logic | Description: In simple terms, This evaluates condition because control flow logic.
74:     if (lower.includes("servicenow") || lower.includes("jira") || lower.includes("ticket")) return "ticketing";
// Type: conditional | Role: Evaluates condition | Outcome: Branch executed if true | Why: Control flow logic | Description: In simple terms, This evaluates condition because control flow logic.
75:     if (lower.includes("customer") || lower.includes("client")) return "customer";
// Type: conditional | Role: Evaluates condition | Outcome: Branch executed if true | Why: Control flow logic | Description: In simple terms, This evaluates condition because control flow logic.
76:     return sender ? "internal" : "unknown";
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
77:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
78: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

## Step 3 — The orchestrator (`src/core/orchestrator.ts`)

**Type of file:** core orchestration logic. Once an email has entered (Step 2), every entry point calls `orchestrator.detect(email)`. The orchestrator creates the shared context and pushes it through the 8 agents **in order**. This is the glue of the whole multi-agent design.

```ts
 1: import type { Agent, AgentContext, DetectionResult, EmailMessage } from "./types.js";
 // Type: import (type-only) | Role: Loads the shared types | Outcome: Types available | Why: The orchestrator orchestrates objects of these types | Description: In simple terms, This loads the shared types because the orchestrator orchestrates objects of these types.
 2: import { EmailScreeningAgent } from "../agents/email-screening-agent.js";
 // Type: imports | Role: Loads all 8 agent classes | Outcome: Each agent is instantiable | Why: The orchestrator must know every step of the pipeline | Description: In simple terms, This loads all 8 agent classes because the orchestrator must know every step of the pipeline.
 3: import { SlmIncidentAgent } from "../agents/slm-incident-agent.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 4: import { SeverityClassifierAgent } from "../agents/severity-classifier-agent.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 5: import { OwnershipResolverAgent } from "../agents/ownership-resolver-agent.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 6: import { BusinessImpactAgent } from "../agents/business-impact-agent.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 7: import { StatusTrackerAgent } from "../agents/status-tracker-agent.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 8: import { ActionAgent } from "../agents/action-agent.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 9: import { SummaryAgent } from "../agents/summary-agent.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
10:
11: export class MultiAgentOrchestrator {
// Type: class | Role: Defines the orchestrator | Outcome: One object that runs the whole pipeline | Why: Centralizes the "run everything" responsibility | Description: In simple terms, This code defines the orchestrator because centralizes the "run everything" responsibility.
12:   constructor(private readonly agents: Agent[] = defaultAgents()) {}
// Type: constructor | Role: Accepts an optional agent list; defaults to `defaultAgents()` | Outcome: The 8 default agents are used unless overridden | Why: Testability — tests can inject a smaller/custom pipeline | Description: In simple terms, This accepts an optional agent list; defaults to `defaultagents()` because testability — tests can inject a smaller/custom pipeline.
13:
14:   async detect(email: EmailMessage): Promise<DetectionResult> {
// Type: method declaration | Role: `detect(email)` — the main public API of the app | Outcome: Returns the complete `DetectionResult` | Why: Every entry point converges on this single method | Description: In simple terms, This `detect(email)` — the main public api of the app because every entry point converges on this single method.
15:     let ctx: AgentContext = { email, signals: [], audit: [] };
// Type: expression | Role: Builds the initial context: the email, empty signals, empty audit | Outcome: A fresh, empty context | Why: Context starts minimal and each agent adds to it | Description: In simple terms, This builds the initial context: the email, empty signals, empty audit because context starts minimal and each agent adds to it.
16:     for (const agent of this.agents) {
// Type: loop | Role: Iterates over every agent in order | Outcome: Each agent runs exactly once, in sequence | Why: The pipeline order **matters** (screening → enrichment → classification → …) | Description: In simple terms, This iterates over every agent in order because the pipeline order **matters** (screening → enrichment → classification → …).
17:       ctx = await agent.run(ctx);
// Type: expression | Role: Runs the current agent and replaces the context | Outcome: Context flows to the next agent | Why: Each agent receives the enriched output of the previous one | Description: In simple terms, This runs the current agent and replaces the context because each agent receives the enriched output of the previous one.
18:     }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
19:     return {
// Type: expression | Role: Builds the final result object | Outcome: A `DetectionResult` with all fields | Why: Converts the loose context into the strict output contract | Description: In simple terms, This builds the final result object because converts the loose context into the strict output contract.
20:       isIncident: ctx.isIncident ?? false,
// Type: expressions | Role: Fills each field with the context value or a safe default (`??`) | Outcome: No field is ever `undefined` in the result | Why: Callers, storage, and integrations can rely on complete data | Description: In simple terms, This fills each field with the context value or a safe default (`??`) because callers, storage, and integrations can rely on complete data.
21:       incidentId: ctx.incidentId,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
22:       severity: ctx.severity ?? "NON_INCIDENT",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
23:       category: ctx.category ?? "unknown",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
24:       owner: ctx.owner ?? "Unassigned",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
25:       state: ctx.state ?? "NON_INCIDENT",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
26:       confidence: ctx.confidence ?? 0,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
27:       businessImpact: ctx.businessImpact ?? "Impact not clearly stated",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
28:       summary: ctx.summary ?? "No summary generated.",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
29:       nextAction: ctx.nextAction ?? "No action.",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
30:       signals: ctx.signals,
// Type: expressions | Role: Passes signals and audit through as-is | Outcome: Full explainability preserved | Why: The result tells you *why* the system decided what it decided | Description: In simple terms, This passes signals and audit through as-is because the result tells you *why* the system decided what it decided.
31:       audit: ctx.audit
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
32:     };
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
33:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
34: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
35:
36: export function defaultAgents(): Agent[] {
// Type: function declaration | Role: Factory that builds the default pipeline | Outcome: Returns the 8-agent array | Why: A named factory keeps the constructor clean and lets tests reuse it | Description: In simple terms, This factory that builds the default pipeline because a named factory keeps the constructor clean and lets tests reuse it.
37:   return [
// Type: return | Role: Returns a value | Outcome: Function exits with value | Why: Passes result to caller | Description: In simple terms, This returns a value because passes result to caller.
38:     new EmailScreeningAgent(),
// Type: expressions | Role: Instantiates the agents in pipeline order | Outcome: Order: Screening, SLM, Severity, Ownership, Impact, Status, Action, Summary | Why: This exact order guarantees each agent's inputs are ready | Description: In simple terms, This instantiates the agents in pipeline order because this exact order guarantees each agent's inputs are ready.
39:     new SlmIncidentAgent(),
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
40:     new SeverityClassifierAgent(),
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
41:     new OwnershipResolverAgent(),
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
42:     new BusinessImpactAgent(),
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
43:     new StatusTrackerAgent(),
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
44:     new ActionAgent(),
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
45:     new SummaryAgent()
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
46:   ];
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
47: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

## Step 4 — The agent pipeline (8 agents)

Each agent implements the same tiny contract — `name` + `run(ctx)`. The pipeline is **deterministic by default**: rules from `src/config/rules.ts` drive everything, so the same email always yields the same result. The SLM agent is the only nondeterministic step, and it is optional.

### Step 4.1 — `src/agents/email-screening-agent.ts` — Turn raw email text into signals

**Type of file:** agent implementation. **Flow position:** first agent — nothing else can score until raw signals exist. It scans subject + body for ticket ids, severity words, keywords, and sender trust, and appends every hit as an `IncidentSignal` to the context.

```ts
 1: import type { Agent, AgentContext, IncidentSignal, SenderType } from "../core/types.js";
 // Type: imports | Role: Loads types + rule tables | Outcome: Types and rules available | Why: Signals use the shared type; patterns come from config | Description: In simple terms, This loads types + rule tables because signals use the shared type; patterns come from config.
 2: import { rules } from "../config/rules.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 3:
 4: export class EmailScreeningAgent implements Agent {
 // Type: class | Role: Defines the screening agent | Outcome: Implements the `Agent` contract | Why: First stage of the pipeline | Description: In simple terms, This code defines the screening agent because first stage of the pipeline.
 5:   name = "EmailScreeningAgent";
 // Type: field | Role: Agent display name | Outcome: Used in signal `source` and audit | Why: Traceability of every signal's origin | Description: In simple terms, This agent display name because traceability of every signal's origin.
 6:
 7:   async run(ctx: AgentContext): Promise<AgentContext> {
 // Type: method | Role: `run` — called by the orchestrator | Outcome: Returns the enriched context | Why: All agents share this signature | Description: In simple terms, This `run` — called by the orchestrator because all agents share this signature.
 8:     const text = `${ctx.email.subject}\n${ctx.email.body}`;
 // Type: expression | Role: Combines subject and body into one searchable text | Outcome: `text` holds the full content | Why: Ticket ids and keywords can appear in either place | Description: In simple terms, This combines subject and body into one searchable text because ticket ids and keywords can appear in either place.
 9:     const signals: IncidentSignal[] = [];
 // Type: expression | Role: Local array collecting new signals | Outcome: Empty list ready to fill | Why: Signals are batched locally, then merged into the context at the end | Description: In simple terms, This local array collecting new signals because signals are batched locally, then merged into the context at the end.
10:
11:     for (const expr of rules.ticketPatterns) {
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
// loop | Tries each ticket-id regex | First match found wins
12:       const hit = text.match(expr)?.[0];
// Type: expression | Role: Extracts the matched text (e.g. `INC54322`) | Outcome: `hit` or undefined | Why: The raw ticket reference becomes the incident id | Description: In simple terms, This extracts the matched text (e.g. `inc54322`) because the raw ticket reference becomes the incident id.
13:       if (hit) {
// Type: conditional | Role: Only act when a ticket id was found | Outcome: Next lines run only on a match | Why: Avoids pushing empty evidence | Description: In simple terms, This only act when a ticket id was found because avoids pushing empty evidence.
14:         ctx.incidentId = hit.toUpperCase();
// Type: assignment | Role: Stores the uppercased ticket id in the context | Outcome: `ctx.incidentId` set (e.g. `INC54322`) | Why: Normalizes ids; used later for confidence and dedupe | Description: In simple terms, This stores the uppercased ticket id in the context because normalizes ids; used later for confidence and dedupe.
15:         signals.push({ source: this.name, name: "ticket-id", weight: 20, evidence: hit });
// Type: call | Role: Records a +20 ticket-id signal with the evidence | Outcome: Signal list grows | Why: A ticket id is a strong sign of a real incident | Description: In simple terms, This records a +20 ticket-id signal with the evidence because a ticket id is a strong sign of a real incident.
16:         break;
// Type: statement | Role: Stops after the first ticket match | Outcome: Only one ticket-id signal per email | Why: Prevents double counting one id | Description: In simple terms, This stops after the first ticket match because prevents double counting one id.
17:       }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
18:     }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
19:
20:     for (const [severity, patterns] of Object.entries(rules.severityPatterns)) {
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
// loop | Iterates severity levels (P1, P2, P3) | Each level's patterns checked
21:       for (const pattern of patterns) {
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
// loop | Iterates the regexes of the current level | All patterns examined
22:         if (pattern.test(text)) {
// Type: conditional | Role: Evaluates condition | Outcome: Branch executed if true | Why: Control flow logic | Description: In simple terms, This evaluates condition because control flow logic.
// conditional | Checks if the text matches this pattern | Match or no match
23:           signals.push({ source: this.name, name: `severity-pattern-${severity}`, weight: severity === "P1" ? 45 : severity === "P2" ? 30 : 20, evidence: pattern.source });
// Type: call | Role: Adds a severity signal weighted by level (P1=45, P2=30, P3=20) | Outcome: Signal records the exact severity word found | Why: Direct word-to-severity evidence for the classifier | Description: In simple terms, This adds a severity signal weighted by level (p1=45, p2=30, p3=20) because direct word-to-severity evidence for the classifier.
24:         }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
25:       }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
26:     }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
27:
28:     for (const [level, words] of Object.entries(rules.keywords)) {
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
// loop | Iterates keyword levels (critical, high, medium, nonIncident) | Each level's words checked
29:       for (const word of words) {
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
// loop | Iterates each keyword | Every word tested
30:         if (text.toLowerCase().includes(word.toLowerCase())) {
// Type: conditional | Role: Case-insensitive substring check | Outcome: Keyword found or not | Why: Email wording varies in case | Description: In simple terms, This case-insensitive substring check because email wording varies in case.
31:           const weight = level === "critical" ? 30 : level === "high" ? 20 : level === "medium" ? 10 : -25;
// Type: expression | Role: Weights by level: critical +30, high +20, medium +10, non-incident **−25** | Outcome: Numeric weight computed | Why: Negative weight actively pushes the score away from "incident" | Description: In simple terms, This weights by level: critical +30, high +20, medium +10, non-incident **−25** because negative weight actively pushes the score away from "incident".
32:           signals.push({ source: this.name, name: `keyword-${level}`, weight, evidence: word });
// Type: call | Role: Adds the keyword signal | Outcome: Signal list grows | Why: Keywords are the bulk of the scoring evidence | Description: In simple terms, This adds the keyword signal because keywords are the bulk of the scoring evidence.
33:         }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
34:       }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
35:     }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
36:
37:     const senderType = this.senderType(ctx.email.sender, ctx.email.senderType, ctx.email.categories ?? []);
// Type: call | Role: Determines the sender type (explicit or guessed) | Outcome: `senderType` known | Why: Sender trust is a classification input | Description: In simple terms, This determines the sender type (explicit or guessed) because sender trust is a classification input.
38:     ctx.email.senderType = senderType;
// Type: assignment | Role: Stores the resolved sender type back on the email | Outcome: `ctx.email.senderType` set | Why: Later agents (and storage) see the resolved type | Description: In simple terms, This stores the resolved sender type back on the email because later agents (and storage) see the resolved type.
39:     signals.push({ source: this.name, name: `sender-${senderType}`, weight: Math.floor(rules.senderScore[senderType] / 5), evidence: ctx.email.sender || "unknown" });
// Type: call | Role: Adds a sender signal weighted by trust score / 5 | Outcome: E.g. monitoring = 15, unknown = 6 | Why: Trusted senders tilt the score toward incident | Description: In simple terms, This adds a sender signal weighted by trust score / 5 because trusted senders tilt the score toward incident.
40:     ctx.signals.push(...signals);
// Type: expression | Role: Merges all local signals into the context | Outcome: `ctx.signals` now holds everything | Why: The classifier (next agent) consumes `ctx.signals` | Description: In simple terms, This merges all local signals into the context because the classifier (next agent) consumes `ctx.signals`.
41:     ctx.audit.push(`${this.name}: collected ${signals.length} screening signals.`);
// Type: call | Role: Appends an audit line | Outcome: Audit records how many signals were collected | Why: Explainability of step 1 | Description: In simple terms, This appends an audit line because explainability of step 1.
42:     return ctx;
// Type: expression | Role: Hands the enriched context forward | Outcome: Pipeline continues to the SLM agent | Why: Each agent returns context for the next | Description: In simple terms, This hands the enriched context forward because each agent returns context for the next.
43:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
44:
45:   private senderType(sender: string, explicit?: SenderType, categories: string[] = []): SenderType {
// Type: method | Role: Private helper: resolve sender type | Outcome: Returns a `SenderType` | Why: Encapsulates the heuristic | Description: In simple terms, This private helper: resolve sender type because encapsulates the heuristic.
46:     if (explicit) return explicit;
// Type: conditional | Role: If the caller already provided a type, trust it | Outcome: Explicit type wins | Why: API/Graph callers know their senders better | Description: In simple terms, This if the caller already provided a type, trust it because aPI/Graph callers know their senders better.
47:     const lower = sender.toLowerCase();
// Type: expressions | Role: Lowercases sender and categories | Outcome: Normalized strings | Why: Case-insensitive matching | Description: In simple terms, This lowercases sender and categories because case-insensitive matching.
48:     const cat = categories.join(" ").toLowerCase();
// Type: variable | Role: Declares a variable | Outcome: Variable initialized | Why: Stores data for later use | Description: In simple terms, This declares a variable because stores data for later use.
49:     if (lower.includes("monitor") || lower.includes("alert") || cat.includes("monitoring")) return "monitoring";
// Type: conditional | Role: Monitor/alert addresses → `monitoring` | Outcome: Monitoring sender detected | Why: Monitoring alerts are high-trust incident sources | Description: In simple terms, This monitor/alert addresses → `monitoring` because monitoring alerts are high-trust incident sources.
50:     if (lower.includes("servicenow") || lower.includes("jira") || lower.includes("ticket")) return "ticketing";
// Type: conditional | Role: ServiceNow/Jira/ticket addresses → `ticketing` | Outcome: Ticketing sender detected | Why: Ticket-system emails are credible | Description: In simple terms, This servicenow/jira/ticket addresses → `ticketing` because ticket-system emails are credible.
51:     if (lower.includes("customer") || lower.includes("client")) return "customer";
// Type: conditional | Role: customer/client addresses → `customer` | Outcome: Customer sender detected | Why: Customer reports carry weight | Description: In simple terms, This customer/client addresses → `customer` because customer reports carry weight.
52:     return sender ? "internal" : "unknown";
// Type: expression | Role: Otherwise internal if an address exists, else unknown | Outcome: Fallback classification | Why: Blank/unknown senders are least trusted | Description: In simple terms, This otherwise internal if an address exists, else unknown because blank/unknown senders are least trusted.
53:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
54: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

### Step 4.2 — `src/agents/slm-incident-agent.ts` — Optional SLM enrichment

**Type of file:** agent implementation. **Flow position:** second agent. This is the only agent that calls an external model. If the SLM is enabled, it asks the model to classify severity/category/state/impact/summary and stores the model's answers into the context. If the SLM is disabled, unreachable, or returns invalid data, the agent simply does nothing and the deterministic agents carry on — the pipeline **never depends** on the SLM.

```ts
 1: import type { Agent, AgentContext, IncidentState, Severity } from "../core/types.js";
 // Type: imports | Role: Loads types + the SLM client | Outcome: Types/client available | Why: The agent is a thin wrapper around `SlmClient` | Description: In simple terms, This loads types + the slm client because the agent is a thin wrapper around `SlmClient`.
 2: import { SlmClient } from "../clients/slm-client.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 3:
 4: interface SlmIncidentJson {
 // Type: interface | Role: Local shape of what the model should return | Outcome: Typed view of the JSON answer | Why: All fields optional — the model may omit things | Description: In simple terms, This local shape of what the model should return because all fields optional — the model may omit things.
 5:   isIncident?: boolean;
 // Type: fields | Role: Expected model outputs | Outcome: isIncident, severity, category, impact, state, confidence, summary | Why: Mirrors the context fields the agent can enrich | Description: In simple terms, This expected model outputs because mirrors the context fields the agent can enrich.
 6:   severity?: Severity;
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 7:   category?: string;
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 8:   businessImpact?: string;
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 9:   state?: IncidentState;
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
10:   confidence?: number;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
11:   summary?: string;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
12: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
13:
14: export class SlmIncidentAgent implements Agent {
// Type: class | Role: Defines the SLM enrichment agent | Outcome: Implements `Agent` | Why: Optional but valuable semantic step | Description: In simple terms, This code defines the slm enrichment agent because optional but valuable semantic step.
15:   name = "SlmIncidentAgent";
// Type: field | Role: Agent display name | Outcome: Used in audit | Why: Traceability | Description: In simple terms, This agent display name because traceability.
16:   constructor(private readonly slm = new SlmClient()) {}
// Type: constructor | Role: Injects the SLM client (defaults to a real one) | Outcome: Client ready | Why: Dependency injection makes it testable with a fake client | Description: In simple terms, This injects the slm client (defaults to a real one) because dependency injection makes it testable with a fake client.
17:
18:   async run(ctx: AgentContext): Promise<AgentContext> {
// Type: method | Role: `run` — called by the orchestrator | Outcome: Returns context (possibly enriched) | Why: Standard agent contract | Description: In simple terms, This `run` — called by the orchestrator because standard agent contract.
19:     const prompt = [
// Type: expression | Role: Builds the user prompt from the email | Outcome: A readable prompt string | Why: The model needs subject, sender, and body to triage | Description: In simple terms, This builds the user prompt from the email because the model needs subject, sender, and body to triage.
20:       "Analyze the following email for L1 incident management.",
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
21:       `Subject: ${ctx.email.subject}`,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
22:       `Sender: ${ctx.email.sender}`,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
23:       `Body: ${ctx.email.body}`,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
24:       "Classify whether this is an IT incident, severity, category, state, impact, and a concise summary."
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
25:     ].join("\n");
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
26:
27:     const result = await this.slm.completeJson<SlmIncidentJson>({
// Type: expression | Role: Calls `completeJson` with system prompt + schema hint | Outcome: `result` is parsed JSON or `null` | Why: The model is told to return JSON following the schema | Description: In simple terms, This calls `completejson` with system prompt + schema hint because the model is told to return JSON following the schema.
28:       system: "You are an L1 incident triage agent. Be strict. Prefer valid JSON. Do not invent fields.",
// Type: data | Role: System prompt | Outcome: Tells the model how to behave | Why: "Be strict, prefer valid JSON, do not invent fields" | Description: In simple terms, This system prompt because "Be strict, prefer valid JSON, do not invent fields".
29:       prompt,
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
30:       schemaHint: `{"isIncident":true,"severity":"P1|P2|P3|P4|NON_INCIDENT","category":"database|api|infrastructure|authentication|analytics|application|unknown","businessImpact":"short text","state":"FOCUS_REQUIRED|ADDRESSED|AWAITING_CUSTOMER|ESCALATE_L2|WATCH|NON_INCIDENT","confidence":0,"summary":"short text"}`
// Type: data | Role: Schema hint | Outcome: Shows the exact allowed values | Why: Keeps the model's output within the app's vocabulary | Description: In simple terms, This schema hint because keeps the model's output within the app's vocabulary.
31:     });
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
32:
33:     if (!result) {
// Type: conditional | Role: If `null` (disabled/unavailable/parse failure) | Outcome: Skip enrichment | Why: Graceful degradation is by design | Description: In simple terms, This if `null` (disabled/unavailable/parse failure) because graceful degradation is by design.
34:       ctx.audit.push(`${this.name}: SLM disabled or unavailable; deterministic agents will continue.`);
// Type: call | Role: Records the skip in the audit | Outcome: Audit line added | Why: Operators can see the SLM was skipped | Description: In simple terms, This records the skip in the audit because operators can see the SLM was skipped.
35:       return ctx;
// Type: expression | Role: Returns context untouched | Outcome: Deterministic agents continue | Why: The pipeline must work without the SLM | Description: In simple terms, This returns context untouched because the pipeline must work without the SLM.
36:     }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
37:
38:     if (typeof result.isIncident === "boolean") ctx.isIncident = result.isIncident;
// Type: conditionals | Role: Copy each model field into the context (guarded by `if`) | Outcome: Context enriched only with valid values | Why: Guards prevent garbage/undefined from polluting the context | Description: In simple terms, This copy each model field into the context (guarded by `if`) because guards prevent garbage/undefined from polluting the context.
39:     if (result.severity) ctx.severity = result.severity;
// Type: conditional | Role: Evaluates condition | Outcome: Branch executed if true | Why: Control flow logic | Description: In simple terms, This evaluates condition because control flow logic.
40:     if (result.category) ctx.category = result.category;
// Type: conditional | Role: Evaluates condition | Outcome: Branch executed if true | Why: Control flow logic | Description: In simple terms, This evaluates condition because control flow logic.
41:     if (result.businessImpact) ctx.businessImpact = result.businessImpact;
// Type: conditional | Role: Evaluates condition | Outcome: Branch executed if true | Why: Control flow logic | Description: In simple terms, This evaluates condition because control flow logic.
42:     if (result.state) ctx.state = result.state;
// Type: conditional | Role: Evaluates condition | Outcome: Branch executed if true | Why: Control flow logic | Description: In simple terms, This evaluates condition because control flow logic.
43:     if (typeof result.confidence === "number") ctx.confidence = Math.max(0, Math.min(99, Math.round(result.confidence)));
// Type: expression | Role: Clamps confidence to 0–99 and rounds | Outcome: A sane confidence number | Why: Model confidence can be any float; clamp to a percentage | Description: In simple terms, This clamps confidence to 0–99 and rounds because model confidence can be any float; clamp to a percentage.
44:     if (result.summary) ctx.summary = result.summary;
// Type: conditional | Role: Evaluates condition | Outcome: Branch executed if true | Why: Control flow logic | Description: In simple terms, This evaluates condition because control flow logic.
45:     ctx.audit.push(`${this.name}: SLM enrichment applied.`);
// Type: call | Role: Audit: enrichment applied | Outcome: Audit line added | Why: Explainability of step 2 | Description: In simple terms, This audit: enrichment applied because explainability of step 2.
46:     return ctx;
// expression | Returns enriched context | Pipeline moves to the severity classifier | Description: In simple terms, This line: Returns enriched context, Pipeline moves to the severity classifier
47:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
48: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

### Step 4.2b — `src/clients/slm-client.ts` — The small-language-model HTTP client

**Type of file:** integration client. Talks to any **OpenAI-compatible** `/chat/completions` endpoint (Ollama, vLLM, LM Studio, Azure AI Foundry, internal gateways). Config comes entirely from env vars.

```ts
 1: import { env, envBool } from "../utils/env.js";
 // Type: import | Role: Loads env helpers | Outcome: Config access ready | Why: All client settings come from env | Description: In simple terms, This loads env helpers because all client settings come from env.
 2:
 3: export interface SlmJsonOptions {
 // Type: interface | Role: Options for a completion call | Outcome: system prompt, user prompt, schema hint | Why: Bundles what the agent must provide | Description: In simple terms, This options for a completion call because bundles what the agent must provide.
 4:   system: string;
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 5:   prompt: string;
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 6:   schemaHint: string;
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 7: }
 // Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
 8:
 9: export class SlmClient {
 // Type: class | Role: The SLM HTTP client | Outcome: One reusable client | Why: Encapsulates endpoint specifics | Description: In simple terms, This the slm http client because encapsulates endpoint specifics.
10:   readonly enabled = envBool("SLM_ENABLED", false);
// Type: field | Role: `SLM_ENABLED` flag (default `false`) | Outcome: Client knows if the SLM is on | Why: Off by default — SLM is purely optional | Description: In simple terms, This `slm_enabled` flag (default `false`) because off by default — SLM is purely optional.
11:   readonly baseUrl = env("SLM_BASE_URL", "http://localhost:11434/v1").replace(/\/$/, "");
// Type: field | Role: Base URL, default Ollama, trailing slash removed | Outcome: `http://localhost:11434/v1` | Why: `/chat/completions` is appended; a trailing slash would double it | Description: In simple terms, This base url, default ollama, trailing slash removed because `/chat/completions` is appended; a trailing slash would double it.
12:   readonly apiKey = env("SLM_API_KEY", "ollama");
// Type: field | Role: API key, default `ollama` | Outcome: Auth header value | Why: Ollama accepts any key; hosted endpoints need a real one | Description: In simple terms, This api key, default `ollama` because ollama accepts any key; hosted endpoints need a real one.
13:   readonly model = env("SLM_MODEL", "phi3:mini");
// Type: field | Role: Model name, default `phi3:mini` | Outcome: Which model is called | Why: Small model fits the L1 use case and cost budget | Description: In simple terms, This model name, default `phi3:mini` because small model fits the L1 use case and cost budget.
14:   readonly timeoutMs = Number(env("SLM_TIMEOUT_MS", "15000"));
// Type: field | Role: Timeout in ms, default 15000 | Outcome: Bound on request time | Why: The SLM must never hang the pipeline forever | Description: In simple terms, This timeout in ms, default 15000 because the SLM must never hang the pipeline forever.
15:
16:   async completeJson<T>(options: SlmJsonOptions): Promise<T | null> {
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
// method | Performs the chat completion and returns parsed JSON | `T | null` | Null means "nothing useful came back"
17:     if (!this.enabled) return null;
// Type: conditional | Role: Early return if disabled | Outcome: `null` immediately | Why: Avoids any network call when the SLM is off | Description: In simple terms, This early return if disabled because avoids any network call when the SLM is off.
18:     const controller = new AbortController();
// Type: expression | Role: Creates an `AbortController` | Outcome: Can cancel the fetch | Why: Required to enforce the timeout | Description: In simple terms, This code creates an `abortcontroller` because it is required to enforce the timeout.
19:     const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
// Type: expression | Role: Schedules an abort after `timeoutMs` | Outcome: Request will be cancelled on timeout | Why: Prevents hangs on unresponsive endpoints | Description: In simple terms, This schedules an abort after `timeoutms` because prevents hangs on unresponsive endpoints.
20:     try {
// Type: try | Role: Wraps the network call | Outcome: Errors handled below | Why: Any failure must degrade to `null`, never throw | Description: In simple terms, This wraps the network call because any failure must degrade to `null`, never throw.
21:       const response = await fetch(`${this.baseUrl}/chat/completions`, {
// Type: expression | Role: POST to `/chat/completions` with model, temperature, JSON format, messages | Outcome: Raw API response | Why: Standard OpenAI-compatible contract | Description: In simple terms, This post to `/chat/completions` with model, temperature, json format, messages because standard OpenAI-compatible contract.
22:         method: "POST",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
23:         headers: {
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
24:           "Content-Type": "application/json",
// Type: headers | Role: Content type + bearer auth | Outcome: Server accepts the call | Why: OpenAI-compatible endpoints expect these headers | Description: In simple terms, This content type + bearer auth because openAI-compatible endpoints expect these headers.
25:           "Authorization": `Bearer ${this.apiKey}`
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
26:         },
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
27:         signal: controller.signal,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
28:         body: JSON.stringify({
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
29:           model: this.model,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
30:           temperature: 0.1,
// Type: data | Role: Temperature 0.1 | Outcome: Low randomness | Why: Deterministic-ish output is preferred for triage | Description: In simple terms, This temperature 0.1 because deterministic-ish output is preferred for triage.
31:           response_format: { type: "json_object" },
// Type: data | Role: `response_format: json_object` | Outcome: Server returns JSON | Why: Supported by OpenAI-compatible servers; schema hint reinforces it | Description: In simple terms, This `response_format: json_object` because supported by OpenAI-compatible servers; schema hint reinforces it.
32:           messages: [
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
33:             { role: "system", content: options.system },
// Type: messages | Role: System + user messages | Outcome: The model sees instructions and the email | Why: Standard chat structure | Description: In simple terms, This system + user messages because standard chat structure.
34:             { role: "user", content: `${options.prompt}\n\nReturn JSON only. Schema hint:\n${options.schemaHint}` }
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
35:           ]
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
36:         })
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
37:       });
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
38:       if (!response.ok) return null;
// Type: conditional | Role: Non-2xx response → null | Outcome: Call treated as unavailable | Why: The pipeline falls back to deterministic logic | Description: In simple terms, This non-2xx response → null because the pipeline falls back to deterministic logic.
39:       const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
// Type: expression | Role: Parses the response body | Outcome: `data` with choices/message/content | Why: OpenAI shape: `choices[0].message.content` | Description: In simple terms, This parses the response body because openAI shape: `choices[0].message.content`.
40:       const content = data.choices?.[0]?.message?.content;
// Type: expression/conditional | Role: Pulls the text content; bail if missing | Outcome: `content` string or null | Why: Empty responses are useless | Description: In simple terms, This pulls the text content; bail if missing because empty responses are useless.
41:       if (!content) return null;
// Type: conditional | Role: Evaluates condition | Outcome: Branch executed if true | Why: Control flow logic | Description: In simple terms, This evaluates condition because control flow logic.
42:       return JSON.parse(content) as T;
// Type: expression | Role: Parses the model's text as JSON | Outcome: Typed object returned | Why: The agent consumes structured JSON, not prose | Description: In simple terms, This parses the model's text as json because the agent consumes structured JSON, not prose.
43:     } catch {
// Type: catch | Role: Any network/parse error → null | Outcome: Failure swallowed | Why: SLM failure must never crash the pipeline | Description: In simple terms, This any network/parse error → null because sLM failure must never crash the pipeline.
44:       return null;
// Type: return | Role: Returns a value | Outcome: Function exits with value | Why: Passes result to caller | Description: In simple terms, This returns a value because passes result to caller.
45:     } finally {
// Type: finally | Role: Clears the abort timer | Outcome: No leaked timers | Why: Cleanup even on success/failure paths | Description: In simple terms, This clears the abort timer because cleanup even on success/failure paths.
46:       clearTimeout(timeout);
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
47:     }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
48:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
49: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

### Step 4.3 — `src/agents/severity-classifier-agent.ts` — Compute P1–P4 / NON_INCIDENT

**Type of file:** agent implementation. **Flow position:** third agent. It sums the weights of all signals collected so far, clamps the score to 0–100, and derives severity, isIncident, and confidence. This is the heart of the deterministic scoring.

```ts
 1: import type { Agent, AgentContext, Severity } from "../core/types.js";
 // Type: imports | Role: Loads types + rules | Outcome: Types/rules available | Why: Needs `Severity` and the threshold constant | Description: In simple terms, This loads types + rules because needs `Severity` and the threshold constant.
 2: import { rules } from "../config/rules.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 3:
 4: export class SeverityClassifierAgent implements Agent {
 // Type: class | Role: Defines the classifier agent | Outcome: Implements `Agent` | Why: Third pipeline stage | Description: In simple terms, This code defines the classifier agent because third pipeline stage.
 5:   name = "SeverityClassifierAgent";
 // Type: field | Role: Agent display name | Outcome: Used in audit | Why: Traceability | Description: In simple terms, This agent display name because traceability.
 6:
 7:   async run(ctx: AgentContext): Promise<AgentContext> {
 // Type: method | Role: `run` — called by orchestrator | Outcome: Returns classified context | Why: Standard contract | Description: In simple terms, This `run` — called by orchestrator because standard contract.
 8:     const score = ctx.signals.reduce((sum, s) => sum + s.weight, 0);
 // Type: expression | Role: Sums every signal weight | Outcome: `score` = total weighted evidence | Why: This is the core scoring model | Description: In simple terms, This sums every signal weight because this is the core scoring model.
 9:     const bounded = Math.max(0, Math.min(100, score));
 // Type: expression | Role: Clamps score to 0–100 | Outcome: `bounded` is a clean percentage-like number | Why: Prevents extreme scores from dominating | Description: In simple terms, This clamps score to 0–100 because prevents extreme scores from dominating.
10:     const hasP1 = ctx.signals.some(s => s.name.includes("severity-pattern-P1"));
// Type: expressions | Role: Check whether explicit severity-pattern signals exist | Outcome: Flags for P1/P2/P3 | Why: Explicit words ("CRITICAL") outweigh pure scoring | Description: In simple terms, This check whether explicit severity-pattern signals exist because explicit words ("CRITICAL") outweigh pure scoring.
11:     const hasP2 = ctx.signals.some(s => s.name.includes("severity-pattern-P2"));
// Type: variable | Role: Declares a variable | Outcome: Variable initialized | Why: Stores data for later use | Description: In simple terms, This declares a variable because stores data for later use.
12:     const hasP3 = ctx.signals.some(s => s.name.includes("severity-pattern-P3"));
// Type: variable | Role: Declares a variable | Outcome: Variable initialized | Why: Stores data for later use | Description: In simple terms, This declares a variable because stores data for later use.
13:     const nonIncident = ctx.signals.some(s => s.name === "keyword-nonIncident") && bounded < 70;
// Type: expression | Role: True if a non-incident keyword exists AND score is under 70 | Outcome: `nonIncident` flag | Why: "Newsletter + low score" is clearly not an incident | Description: In simple terms, This true if a non-incident keyword exists and score is under 70 because "Newsletter + low score" is clearly not an incident.
14:
15:     let severity: Severity = "P4";
// Type: expression | Role: Default severity is P4 | Outcome: Falls back to lowest severity | Why: An incident that exists but isn't urgent starts at P4 | Description: In simple terms, This default severity is p4 because an incident that exists but isn't urgent starts at P4.
16:     if (hasP1 || bounded >= 85) severity = "P1";
// Type: conditional | Role: Explicit P1 word or score ≥ 85 → P1 | Outcome: Severity P1 | Why: P1 is reserved for the most severe signals | Description: In simple terms, This explicit p1 word or score ≥ 85 → p1 because p1 is reserved for the most severe signals.
17:     else if (hasP2 || bounded >= 65) severity = "P2";
// Type: conditional | Role: Explicit P2 word or score ≥ 65 → P2 | Outcome: Severity P2 | Why: Score bands define the ladder | Description: In simple terms, This explicit p2 word or score ≥ 65 → p2 because score bands define the ladder.
18:     else if (hasP3 || bounded >= 45) severity = "P3";
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
// conditional | Explicit P3 word or score ≥ 45 → P3 | Severity P3
19:     const hasTicket = ctx.signals.some(s => s.name === "ticket-id");
// Type: expression | Role: Check for a ticket-id signal | Outcome: `hasTicket` flag | Why: A ticket id alone can keep an email as an incident | Description: In simple terms, This check for a ticket-id signal because a ticket id alone can keep an email as an incident.
20:     if (nonIncident || (bounded < rules.incidentScoreThreshold && !hasTicket)) severity = "NON_INCIDENT";
// Type: conditional | Role: NON_INCIDENT if nonIncident flag, OR score < 40 with no ticket | Outcome: Severity NON_INCIDENT | Why: Low-evidence, ticket-less mail is rejected | Description: In simple terms, This non_incident if nonincident flag, or score < 40 with no ticket because low-evidence, ticket-less mail is rejected.
21:
22:     ctx.severity = ctx.severity && ctx.severity !== "NON_INCIDENT" ? ctx.severity : severity;
// Type: expression | Role: Keeps an SLM-provided severity if present and meaningful | Outcome: SLM answer wins when available | Why: The model's judgment is trusted over raw scores | Description: In simple terms, This keeps an slm-provided severity if present and meaningful because the model's judgment is trusted over raw scores.
23:     ctx.isIncident = ctx.isIncident ?? (ctx.severity !== "NON_INCIDENT" || (hasTicket && !nonIncident));
// Type: expression | Role: Sets isIncident (SLM value wins; else derived from severity/ticket) | Outcome: `ctx.isIncident` known | Why: Every later agent depends on this flag | Description: In simple terms, This code sets isincident (slm value wins; else derived from severity/ticket) because every later agent depends on this flag.
24:     ctx.confidence = Math.max(ctx.confidence ?? 0, Math.min(99, bounded + (ctx.incidentId ? 10 : 0)));
// Type: expression | Role: Confidence = max(existing, bounded + 10 if a ticket id exists), capped at 99 | Outcome: Numeric confidence | Why: Ticket presence makes a classification more certain | Description: In simple terms, This confidence = max(existing, bounded + 10 if a ticket id exists), capped at 99 because ticket presence makes a classification more certain.
25:     ctx.audit.push(`${this.name}: severity=${ctx.severity}; score=${bounded}; confidence=${ctx.confidence}.`);
// Type: call | Role: Audit line with severity/score/confidence | Outcome: Explainability | Why: Operators see exactly how the severity was derived | Description: In simple terms, This audit line with severity/score/confidence because operators see exactly how the severity was derived.
26:     return ctx;
// expression | Returns context | Pipeline moves to ownership | Description: In simple terms, This line: Returns context, Pipeline moves to ownership
27:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
28: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

### Step 4.4 — `src/agents/ownership-resolver-agent.ts` — Map category to owner

**Type of file:** agent implementation. **Flow position:** fourth agent. Matches the email text against the routing aliases table and assigns a category and a support owner. If the SLM already supplied a category, that wins.

```ts
 1: import type { Agent, AgentContext } from "../core/types.js";
 // Type: imports | Role: Loads types + routing rules | Outcome: Ready to route | Why: Routing lives in config | Description: In simple terms, This loads types + routing rules because routing lives in config.
 2: import { rules } from "../config/rules.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 3:
 4: export class OwnershipResolverAgent implements Agent {
 // Type: class | Role: Defines the resolver agent | Outcome: Implements `Agent` | Why: Fourth stage | Description: In simple terms, This code defines the resolver agent because fourth stage.
 5:   name = "OwnershipResolverAgent";
 // Type: field | Role: Agent display name | Outcome: Used in audit | Why: Traceability | Description: In simple terms, This agent display name because traceability.
 6:
 7:   async run(ctx: AgentContext): Promise<AgentContext> {
 // Type: method | Role: `run` | Outcome: Returns context with owner | Why: Standard contract | Description: In simple terms, This `run` because standard contract.
 8:     const text = `${ctx.email.subject}\n${ctx.email.body}`.toLowerCase();
 // Type: expression | Role: Lowercased subject + body | Outcome: Normalized search text | Why: Alias matching must be case-insensitive | Description: In simple terms, This lowercased subject + body because alias matching must be case-insensitive.
 9:     const route = rules.routing.find(r => r.aliases.some(alias => text.includes(alias.toLowerCase()))) ?? rules.routing[rules.routing.length - 1];
 // Type: expression | Role: Finds the **first** routing row whose alias appears in the text; falls back to the last row (`application`) | Outcome: `route` with category + owner | Why: Deterministic topic → team mapping | Description: In simple terms, This finds the **first** routing row whose alias appears in the text; falls back to the last row (`application`) because deterministic topic → team mapping.
10:     ctx.category = ctx.category && ctx.category !== "unknown" ? ctx.category : route.category;
// Type: expression | Role: Keeps an SLM category if present and not "unknown"; else uses the route's category | Outcome: `ctx.category` decided | Why: The model's semantic guess outranks keyword routing | Description: In simple terms, This keeps an slm category if present and not "unknown"; else uses the route's category because the model's semantic guess outranks keyword routing.
11:     ctx.owner = route.owner;
// Type: assignment | Role: Sets the owner from the route | Outcome: `ctx.owner` = support team | Why: The owner is what the Action agent and Teams alert use | Description: In simple terms, This code sets the owner from the route because the owner is what the Action agent and Teams alert use.
12:     ctx.audit.push(`${this.name}: category=${ctx.category}; owner=${ctx.owner}.`);
// Type: call | Role: Audit line | Outcome: Explainability | Why: See category + owner per email | Description: In simple terms, This audit line because see category + owner per email.
13:     return ctx;
// expression | Returns context | Pipeline moves to impact | Description: In simple terms, This line: Returns context, Pipeline moves to impact
14:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
15: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

### Step 4.5 — `src/agents/business-impact-agent.ts` — Identify business impact

**Type of file:** agent implementation. **Flow position:** fifth agent. Reads the email text and picks the best-known impact statement; falls back to "Impact not clearly stated".

```ts
 1: import type { Agent, AgentContext } from "../core/types.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 // import | Loads the context type | Typed context
 2:
 3: export class BusinessImpactAgent implements Agent {
 // Type: class | Role: Defines the impact agent | Outcome: Implements `Agent` | Why: Fifth stage | Description: In simple terms, This code defines the impact agent because fifth stage.
 4:   name = "BusinessImpactAgent";
 // Type: field | Role: Agent display name | Outcome: Used in audit | Why: Traceability | Description: In simple terms, This agent display name because traceability.
 5:
 6:   async run(ctx: AgentContext): Promise<AgentContext> {
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 7:     const text = `${ctx.email.subject}\n${ctx.email.body}`.toLowerCase();
 // Type: expression | Role: Lowercased subject + body | Outcome: Normalized text | Why: Case-insensitive matching | Description: In simple terms, This lowercased subject + body because case-insensitive matching.
 8:     let impact = "Impact not clearly stated";
 // Type: expression | Role: Default impact | Outcome: "Impact not clearly stated" | Why: Honest default when no impact phrase matches | Description: In simple terms, This default impact because honest default when no impact phrase matches.
 9:     if (["production down", "application down", "service down", "unavailable"].some(x => text.includes(x))) impact = "Production availability impact";
 // Type: conditional | Role: Availability phrases → production impact | Outcome: Impact = "Production availability impact" | Why: Down systems = availability impact | Description: In simple terms, This availability phrases → production impact because down systems = availability impact.
10:     else if (["data loss", "corrupt", "integrity"].some(x => text.includes(x))) impact = "Data integrity risk";
// Type: conditional | Role: Data phrases → integrity risk | Outcome: Impact = "Data integrity risk" | Why: Corruption/loss = integrity issue | Description: In simple terms, This data phrases → integrity risk because corruption/loss = integrity issue.
11:     else if (["payment", "revenue", "billing", "order"].some(x => text.includes(x))) impact = "Revenue transaction impact";
// Type: conditional | Role: Money phrases → revenue impact | Outcome: Impact = "Revenue transaction impact" | Why: Payment/order failures hit revenue | Description: In simple terms, This money phrases → revenue impact because payment/order failures hit revenue.
12:     else if (["login", "sso", "auth", "unable to login"].some(x => text.includes(x))) impact = "User access impact";
// Type: conditional | Role: Auth phrases → access impact | Outcome: Impact = "User access impact" | Why: Login/SSO problems block users | Description: In simple terms, This auth phrases → access impact because login/SSO problems block users.
13:     else if (["slow", "performance", "latency", "timeout"].some(x => text.includes(x))) impact = "Performance degradation";
// Type: conditional | Role: Performance phrases → degradation | Outcome: Impact = "Performance degradation" | Why: Slow/latency = degraded experience | Description: In simple terms, This performance phrases → degradation because slow/latency = degraded experience.
14:     ctx.businessImpact = ctx.businessImpact ?? impact;
// Type: expression | Role: Keeps the SLM impact if the model provided one | Outcome: Model answer wins | Why: The model can phrase impact better than keyword rules | Description: In simple terms, This keeps the slm impact if the model provided one because the model can phrase impact better than keyword rules.
15:     ctx.audit.push(`${this.name}: impact=${ctx.businessImpact}.`);
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
// call | Audit line | Explainability | Description: In simple terms, This line: Audit line, Explainability
16:     return ctx;
// expression | Returns context | Pipeline moves to status | Description: In simple terms, This line: Returns context, Pipeline moves to status
17:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
18: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

### Step 4.6 — `src/agents/status-tracker-agent.ts` — Determine the incident state

**Type of file:** agent implementation. **Flow position:** sixth agent. Reads the email for lifecycle phrases (resolved, awaiting customer, still down, …), then applies severity-based rules so that P1/P2 incidents default to FOCUS_REQUIRED. Non-incidents become NON_INCIDENT.

```ts
 1: import type { Agent, AgentContext, IncidentState } from "../core/types.js";
 // Type: imports | Role: Loads types + status phrases | Outcome: Ready to classify state | Why: Phrase lists live in config | Description: In simple terms, This loads types + status phrases because phrase lists live in config.
 2: import { rules } from "../config/rules.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 3:
 4: export class StatusTrackerAgent implements Agent {
 // Type: class | Role: Defines the status agent | Outcome: Implements `Agent` | Why: Sixth stage | Description: In simple terms, This code defines the status agent because sixth stage.
 5:   name = "StatusTrackerAgent";
 // Type: field | Role: Agent display name | Outcome: Used in audit | Why: Traceability | Description: In simple terms, This agent display name because traceability.
 6:
 7:   async run(ctx: AgentContext): Promise<AgentContext> {
 // Type: method | Role: `run` | Outcome: Returns context with state | Why: Standard contract | Description: In simple terms, This `run` because standard contract.
 8:     const text = `${ctx.email.subject}\n${ctx.email.body}`.toLowerCase();
 // Type: expression | Role: Lowercased subject + body | Outcome: Normalized text | Why: Case-insensitive phrase matching | Description: In simple terms, This lowercased subject + body because case-insensitive phrase matching.
 9:     let state: IncidentState = "WATCH";
 // Type: expression | Role: Default state WATCH | Outcome: Not yet determined | Why: Watch is the neutral "keep an eye on it" state | Description: In simple terms, This default state watch because watch is the neutral "keep an eye on it" state.
10:
11:     for (const phrase of rules.statusPhrases.ADDRESSED) {
// Type: loop/conditional | Role: Any "resolved/fixed/…" phrase → ADDRESSED | Outcome: State ADDRESSED | Why: Resolution phrases mark closed incidents | Description: In simple terms, This any "resolved/fixed/…" phrase → addressed because resolution phrases mark closed incidents.
12:       if (text.includes(phrase)) state = "ADDRESSED";
// Type: conditional | Role: Evaluates condition | Outcome: Branch executed if true | Why: Control flow logic | Description: In simple terms, This evaluates condition because control flow logic.
13:     }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
14:     for (const phrase of rules.statusPhrases.AWAITING_CUSTOMER) {
// Type: loop/conditional | Role: Any "awaiting customer/…" phrase → AWAITING_CUSTOMER | Outcome: State AWAITING_CUSTOMER | Why: Waits on the customer's side | Description: In simple terms, This any "awaiting customer/…" phrase → awaiting_customer because waits on the customer's side.
15:       if (text.includes(phrase)) state = "AWAITING_CUSTOMER";
// Type: conditional | Role: Evaluates condition | Outcome: Branch executed if true | Why: Control flow logic | Description: In simple terms, This evaluates condition because control flow logic.
16:     }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
17:     for (const phrase of rules.statusPhrases.FOCUS_REQUIRED) {
// Type: loop/conditional | Role: Any "no owner/still down/…" phrase → FOCUS_REQUIRED | Outcome: State FOCUS_REQUIRED | Why: Urgency phrases demand focus | Description: In simple terms, This any "no owner/still down/…" phrase → focus_required because urgency phrases demand focus.
18:       if (text.includes(phrase)) state = "FOCUS_REQUIRED";
// Type: conditional | Role: Evaluates condition | Outcome: Branch executed if true | Why: Control flow logic | Description: In simple terms, This evaluates condition because control flow logic.
19:     }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
20:
21:     if (ctx.severity === "P1" && state !== "ADDRESSED" && state !== "AWAITING_CUSTOMER") state = "FOCUS_REQUIRED";
// Type: conditional | Role: P1 that is not resolved/awaiting → FOCUS_REQUIRED | Outcome: P1 always demands focus | Why: A P1 can't be left in WATCH | Description: In simple terms, This p1 that is not resolved/awaiting → focus_required because a P1 can't be left in WATCH.
22:     if (ctx.severity === "P2" && state === "WATCH") state = "FOCUS_REQUIRED";
// Type: conditional | Role: P2 in WATCH → FOCUS_REQUIRED | Outcome: P2 raised to focus | Why: P2s also need active attention | Description: In simple terms, This p2 in watch → focus_required because p2s also need active attention.
23:     if (!ctx.isIncident || ctx.severity === "NON_INCIDENT") state = "NON_INCIDENT";
// Type: conditional | Role: Not an incident → NON_INCIDENT | Outcome: State NON_INCIDENT | Why: Routine mail is not a tracked incident | Description: In simple terms, This not an incident → non_incident because routine mail is not a tracked incident.
24:
25:     ctx.state = ctx.state && ctx.state !== "WATCH" ? ctx.state : state;
// Type: expression | Role: SLM state wins unless it is WATCH | Outcome: Model answer used when meaningful | Why: Prefer the model's reading, but don't downgrade real states to WATCH | Description: In simple terms, This slm state wins unless it is watch because prefer the model's reading, but don't downgrade real states to WATCH.
26:     ctx.audit.push(`${this.name}: state=${ctx.state}.`);
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
// call | Audit line | Explainability | Description: In simple terms, This line: Audit line, Explainability
27:     return ctx;
// expression | Returns context | Pipeline moves to the action agent | Description: In simple terms, This line: Returns context, Pipeline moves to the action agent
28:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
29: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

### Step 4.7 — `src/agents/action-agent.ts` — Recommend the next L1 action

**Type of file:** agent implementation. **Flow position:** seventh agent. Pure decision table: given incident/severity/state/owner, produce the recommended next action text.

```ts
 1: import type { Agent, AgentContext } from "../core/types.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 // import | Loads the context type | Typed context
 2:
 3: export class ActionAgent implements Agent {
 // Type: class | Role: Defines the action agent | Outcome: Implements `Agent` | Why: Seventh stage | Description: In simple terms, This code defines the action agent because seventh stage.
 4:   name = "ActionAgent";
 // Type: field | Role: Agent display name | Outcome: Used in audit | Why: Traceability | Description: In simple terms, This agent display name because traceability.
 5:
 6:   async run(ctx: AgentContext): Promise<AgentContext> {
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 7:     if (!ctx.isIncident || ctx.severity === "NON_INCIDENT") ctx.nextAction = "No incident action required.";
 // Type: conditional | Role: Not an incident → no action | Outcome: Clear "do nothing" guidance | Why: Avoids spurious actions on routine mail | Description: In simple terms, This not an incident → no action because avoids spurious actions on routine mail.
 8:     else if (ctx.state === "ADDRESSED") ctx.nextAction = "Monitor and wait for validation if required.";
 // Type: conditional | Role: ADDRESSED → monitor/validate | Outcome: Calm follow-up guidance | Why: Resolved incidents only need validation | Description: In simple terms, This addressed → monitor/validate because resolved incidents only need validation.
 9:     else if (ctx.state === "AWAITING_CUSTOMER") ctx.nextAction = "Follow up with customer for confirmation.";
 // Type: conditional | Role: AWAITING_CUSTOMER → follow up | Outcome: Action targets the customer | Why: Ball is in the customer's court | Description: In simple terms, This awaiting_customer → follow up because ball is in the customer's court.
10:     else if (ctx.state === "ESCALATE_L2") ctx.nextAction = `Escalate to L2 / SME group: ${ctx.owner}.`;
// Type: conditional | Role: ESCALATE_L2 → escalate to owner team | Outcome: Escalation guidance | Why: L2/SME handoff is explicit | Description: In simple terms, This escalate_l2 → escalate to owner team because l2/SME handoff is explicit.
11:     else if (ctx.state === "FOCUS_REQUIRED") ctx.nextAction = `Assign immediately to ${ctx.owner}; escalate if no update.`;
// Type: conditional | Role: FOCUS_REQUIRED → assign immediately to owner | Outcome: Urgent assignment guidance | Why: The most common actionable case | Description: In simple terms, This focus_required → assign immediately to owner because the most common actionable case.
12:     else ctx.nextAction = `Track in L1 queue and assign to ${ctx.owner}.`;
// Type: conditional | Role: Fallback → track and assign | Outcome: Neutral queue guidance | Why: WATCH/P4 incidents still get an owner | Description: In simple terms, This fallback → track and assign because wATCH/P4 incidents still get an owner.
13:
14:     ctx.audit.push(`${this.name}: nextAction=${ctx.nextAction}`);
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
// call | Audit line | Explainability | Description: In simple terms, This line: Audit line, Explainability
15:     return ctx;
// expression | Returns context | Pipeline moves to summary | Description: In simple terms, This line: Returns context, Pipeline moves to summary
16:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
17: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

### Step 4.8 — `src/agents/summary-agent.ts` — Generate the final summary

**Type of file:** agent implementation. **Flow position:** eighth and last agent. If the SLM already produced a summary, it is kept; otherwise a summary is assembled deterministically from the classified fields.

```ts
 1: import type { Agent, AgentContext } from "../core/types.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 // import | Loads the context type | Typed context
 2:
 3: export class SummaryAgent implements Agent {
 // Type: class | Role: Defines the summary agent | Outcome: Implements `Agent` | Why: Final stage — produces the human-readable output | Description: In simple terms, This code defines the summary agent because final stage — produces the human-readable output.
 4:   name = "SummaryAgent";
 // Type: field | Role: Agent display name | Outcome: Used in audit | Why: Traceability | Description: In simple terms, This agent display name because traceability.
 5:
 6:   async run(ctx: AgentContext): Promise<AgentContext> {
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 7:     if (!ctx.summary) {
 // Type: conditional | Role: Only generate if no summary exists yet | Outcome: SLM summary preserved | Why: Don't overwrite a good model summary with a template | Description: In simple terms, This only generate if no summary exists yet because don't overwrite a good model summary with a template.
 8:       const subject = ctx.email.subject || "No subject";
 // Type: expression | Role: Subject or "No subject" fallback | Outcome: Safe string for the summary | Why: Subjects can be empty | Description: In simple terms, This subject or "no subject" fallback because subjects can be empty.
 9:       if (!ctx.isIncident || ctx.severity === "NON_INCIDENT") {
 // Type: conditional | Role: Non-incident branch | Outcome: `Non-incident email: <subject>.` | Why: Routine mail gets a clearly labelled summary | Description: In simple terms, This non-incident branch because routine mail gets a clearly labelled summary.
10:         ctx.summary = `Non-incident email: ${subject}.`;
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
11:       } else {
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
12:         ctx.summary = `${ctx.severity} ${ctx.category} incident detected from email: ${subject}. Impact: ${ctx.businessImpact}. Current state: ${ctx.state}.`;
// Type: expression | Role: Incident branch: severity + category + subject + impact + state | Outcome: One-line incident summary | Why: This string is what ends up in JSONL, Teams, and ServiceNow | Description: In simple terms, This incident branch: severity + category + subject + impact + state because this string is what ends up in JSONL, Teams, and ServiceNow.
13:       }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
14:     }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
15:     ctx.audit.push(`${this.name}: summary generated.`);
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
// call | Audit line | Explainability | Description: In simple terms, This line: Audit line, Explainability
16:     return ctx;
// expression | Returns the complete context | Pipeline finished — orchestrator builds the final result | Description: In simple terms, This line: Returns the complete context, Pipeline finished — orchestrator builds the final result
17:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
18: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

## Step 5 — Persistence: `src/storage/jsonl-store.ts`

**Type of file:** storage layer. After the pipeline returns a `DetectionResult`, the entry points call `store.save(email, result)`. Non-incidents are **not** stored. Records are appended as JSON Lines (one JSON object per line), which keeps the store dead-simple, append-only, and human-readable. The store also powers the `/incidents` and `/summary` endpoints.

```ts
 1: import fs from "node:fs";
 // Type: imports | Role: Loads fs, path, and types | Outcome: Ready to read/write files | Why: JSONL storage is plain file I/O | Description: In simple terms, This loads fs, path, and types because jSONL storage is plain file I/O.
 2: import path from "node:path";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 3: import type { DetectionResult, EmailMessage } from "../core/types.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 4:
 5: export interface StoredIncident {
 // Type: interface | Role: Shape of one stored record | Outcome: email + result + createdAt | Why: Everything needed to replay/audit an incident later | Description: In simple terms, This shape of one stored record because everything needed to replay/audit an incident later.
 6:   email: EmailMessage;
 // Type: fields | Role: The stored parts | Outcome: Original email, classification result, timestamp | Why: Complete auditability of every incident | Description: In simple terms, This the stored parts because complete auditability of every incident.
 7:   result: DetectionResult;
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 8:   createdAt: string;
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 9: }
 // Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
10:
11: export class JsonlIncidentStore {
// Type: class | Role: The JSONL store | Outcome: One store instance per app | Why: Simple file-based persistence | Description: In simple terms, This the jsonl store because simple file-based persistence.
12:   constructor(private readonly filePath = "data/incidents.jsonl") {
// Type: constructor | Role: Accepts a file path, defaults to `data/incidents.jsonl` | Outcome: Path is set | Why: Overridable (sample runner uses its own file) | Description: In simple terms, This accepts a file path, defaults to `data/incidents.jsonl` because overridable (sample runner uses its own file).
13:     fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
// Type: call | Role: Creates the parent directory if missing | Outcome: Directory exists | Why: Avoids crashes when `data/` is absent | Description: In simple terms, This code creates the parent directory if missing because avoids crashes when `data/` is absent.
14:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
15:
16:   save(email: EmailMessage, result: DetectionResult): void {
// Type: method | Role: Saves one incident | Outcome: Appends a line | Why: Called by all 3 entry points | Description: In simple terms, This saves one incident because called by all 3 entry points.
17:     if (!result.isIncident) return;
// Type: conditional | Role: Skip non-incidents | Outcome: Nothing written for routine mail | Why: Only real incidents belong in the store | Description: In simple terms, This skip non-incidents because only real incidents belong in the store.
18:     const record: StoredIncident = { email, result, createdAt: new Date().toISOString() };
// Type: expression | Role: Builds the record with an ISO timestamp | Outcome: `record` ready | Why: Timestamp enables time-based queries later | Description: In simple terms, This builds the record with an iso timestamp because timestamp enables time-based queries later.
19:     fs.appendFileSync(this.filePath, JSON.stringify(record) + "\n", "utf8");
// Type: call | Role: Appends the JSON + newline | Outcome: One line per incident | Why: JSON Lines format — append-only, crash-safe, easy to tail | Description: In simple terms, This appends the json + newline because jSON Lines format — append-only, crash-safe, easy to tail.
20:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
21:
22:   list(limit = 100): StoredIncident[] {
// Type: method | Role: Lists the most recent incidents | Outcome: Newest-first array | Why: Powers `GET /incidents` | Description: In simple terms, This lists the most recent incidents because powers `GET /incidents`.
23:     if (!fs.existsSync(this.filePath)) return [];
// Type: conditional | Role: No file yet → empty list | Outcome: Returns `[]` | Why: First run shouldn't error | Description: In simple terms, This no file yet → empty list because first run shouldn't error.
24:     const rows = fs.readFileSync(this.filePath, "utf8").trim().split(/\r?\n/).filter(Boolean);
// Type: expression | Role: Reads file, splits lines, drops blanks | Outcome: `rows` = raw JSON strings | Why: Standard JSONL read | Description: In simple terms, This reads file, splits lines, drops blanks because standard JSONL read.
25:     return rows.slice(-limit).reverse().map(row => JSON.parse(row) as StoredIncident);
// Type: expression | Role: Takes the last `limit`, reverses (newest first), parses each | Outcome: Typed `StoredIncident[]` | Why: Recent incidents are the most relevant | Description: In simple terms, This takes the last `limit`, reverses (newest first), parses each because recent incidents are the most relevant.
26:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
27:
28:   summary(): { total: number; bySeverity: Record<string, number>; byState: Record<string, number>; topFocus: StoredIncident[] } {
// Type: method | Role: Aggregates summary statistics | Outcome: Counts by severity/state + top focus list | Why: Powers `GET /summary` | Description: In simple terms, This aggregates summary statistics because powers `GET /summary`.
29:     const items = this.list(10000);
// Type: expression | Role: Reads up to 10 000 records | Outcome: `items` = full history | Why: Enough for realistic incident volumes | Description: In simple terms, This reads up to 10 000 records because enough for realistic incident volumes.
30:     const bySeverity: Record<string, number> = {};
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
// expressions | Empty count maps | Ready to tally
31:     const byState: Record<string, number> = {};
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
32:     for (const item of items) {
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
// loop | Iterates every record | Each is tallied
33:       bySeverity[item.result.severity] = (bySeverity[item.result.severity] ?? 0) + 1;
// Type: expression | Role: Increments severity count (with `?? 0`) | Outcome: `bySeverity` grows | Why: Answer: how many P1s/P2s/…? | Description: In simple terms, This increments severity count (with `?? 0`) because answer: how many P1s/P2s/…?.
34:       byState[item.result.state] = (byState[item.result.state] ?? 0) + 1;
// Type: expression | Role: Increments state count | Outcome: `byState` grows | Why: Answer: how many FOCUS_REQUIRED vs ADDRESSED? | Description: In simple terms, This increments state count because answer: how many FOCUS_REQUIRED vs ADDRESSED?.
35:     }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
36:     const topFocus = items.filter(i => ["FOCUS_REQUIRED", "ESCALATE_L2"].includes(i.result.state)).slice(0, 10);
// Type: expression | Role: Filters focus/escale records, takes top 10 | Outcome: `topFocus` list | Why: Dashboards show what needs attention now | Description: In simple terms, This filters focus/escale records, takes top 10 because dashboards show what needs attention now.
37:     return { total: items.length, bySeverity, byState, topFocus };
// Type: expression | Role: Returns the aggregate object | Outcome: Complete summary | Why: One call serves the summary endpoint | Description: In simple terms, This returns the aggregate object because one call serves the summary endpoint.
38:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
39: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

## Step 6 — Notifications: `src/integrations/teams-notifier.ts`

**Type of file:** integration. Sends a Teams message via an **incoming webhook** when an incident needs focus. It is intentionally conservative: no webhook configured → do nothing; state not FOCUS_REQUIRED/ESCALATE_L2 → do nothing.

```ts
 1: import type { DetectionResult, EmailMessage } from "../core/types.js";
 // Type: imports | Role: Loads types + env | Outcome: Ready to notify | Why: Webhook URL comes from env | Description: In simple terms, This loads types + env because webhook URL comes from env.
 2: import { env } from "../utils/env.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 3:
 4: export class TeamsNotifier {
 // Type: class | Role: The Teams notifier | Outcome: One instance per app | Why: Encapsulates webhook logic | Description: In simple terms, This the teams notifier because encapsulates webhook logic.
 5:   private readonly webhook = env("TEAMS_WEBHOOK_URL", "");
 // Type: field | Role: Reads webhook URL from env (may be empty) | Outcome: `webhook` string | Why: Empty = feature disabled | Description: In simple terms, This reads webhook url from env (may be empty) because empty = feature disabled.
 6:
 7:   async sendFocusAlert(email: EmailMessage, result: DetectionResult): Promise<boolean> {
 // Type: method | Role: Sends the alert | Outcome: `true` on success, `false` otherwise | Why: Called by API and watcher after saving | Description: In simple terms, This sends the alert because called by API and watcher after saving.
 8:     if (!this.webhook) return false;
 // Type: conditional | Role: No webhook configured → skip | Outcome: Returns `false` | Why: Don't attempt network calls without a URL | Description: In simple terms, This no webhook configured → skip because don't attempt network calls without a URL.
 9:     if (!["FOCUS_REQUIRED", "ESCALATE_L2"].includes(result.state)) return false;
 // Type: conditional | Role: Only focus states alert | Outcome: Returns `false` otherwise | Why: Avoid alert fatigue — routine/answered incidents stay silent | Description: In simple terms, This only focus states alert because avoid alert fatigue — routine/answered incidents stay silent.
10:     const text = [
// Type: expression | Role: Builds a multi-line plain-text message | Outcome: Human-readable alert body | Why: Teams webhooks accept simple `text` payloads | Description: In simple terms, This builds a multi-line plain-text message because teams webhooks accept simple `text` payloads.
11:       `L1 Focus Required: ${result.severity} ${result.category}`,
// Type: data | Role: Alert content | Outcome: severity+category, subject, owner, impact, action | Why: The L1 team gets everything needed to act | Description: In simple terms, This alert content because the L1 team gets everything needed to act.
12:       `Subject: ${email.subject}`,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
13:       `Owner: ${result.owner}`,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
14:       `Impact: ${result.businessImpact}`,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
15:       `Action: ${result.nextAction}`
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
16:     ].join("\n");
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
17:     const response = await fetch(this.webhook, {
// Type: expression | Role: POSTs `{text}` to the webhook | Outcome: HTTP request sent | Why: Standard Teams incoming webhook format | Description: In simple terms, This posts `{text}` to the webhook because standard Teams incoming webhook format.
18:       method: "POST",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
19:       headers: { "Content-Type": "application/json" },
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
20:       body: JSON.stringify({ text })
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
21:     });
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
22:     return response.ok;
// Type: expression | Role: Returns whether the POST succeeded | Outcome: Success signal | Why: Callers can log/retry if needed | Description: In simple terms, This returns whether the post succeeded because callers can log/retry if needed.
23:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
24: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

## Step 7 — Ticket integration: `src/integrations/servicenow-client.ts`

**Type of file:** integration. Optionally creates a ServiceNow incident via the Table API using basic auth. Currently **not wired** into the entry points — it is a ready-to-use component (the README lists ticket creation approval as a backlog item).

```ts
 1: import type { DetectionResult, EmailMessage } from "../core/types.js";
 // Type: imports | Role: Loads types + env | Outcome: Ready to integrate | Why: Credentials come from env | Description: In simple terms, This loads types + env because credentials come from env.
 2: import { env } from "../utils/env.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 3:
 4: export class ServiceNowClient {
 // Type: class | Role: The ServiceNow client | Outcome: One instance | Why: Encapsulates the Table API call | Description: In simple terms, This the servicenow client because encapsulates the Table API call.
 5:   private readonly instanceUrl = env("SERVICENOW_INSTANCE_URL", "").replace(/\/$/, "");
 // Type: field | Role: Instance URL (trailing slash removed) | Outcome: `https://your-org.service-now.com` | Why: The API path is appended | Description: In simple terms, This instance url (trailing slash removed) because the API path is appended.
 6:   private readonly username = env("SERVICENOW_USERNAME", "");
 // Type: fields | Role: Basic-auth credentials | Outcome: username/password | Why: ServiceNow Table API supports Basic auth | Description: In simple terms, This basic-auth credentials because serviceNow Table API supports Basic auth.
 7:   private readonly password = env("SERVICENOW_PASSWORD", "");
 // Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
 8:
 9:   async createIncident(email: EmailMessage, result: DetectionResult): Promise<string | null> {
 // Type: method | Role: Creates an incident in ServiceNow | Outcome: Returns the ticket number or null | Why: This is the optional "create ticket" action | Description: In simple terms, This code creates an incident in servicenow because this is the optional "create ticket" action.
10:     if (!this.instanceUrl || !this.username || !this.password || !result.isIncident) return null;
// Type: conditional | Role: Missing config or not an incident → skip | Outcome: Returns `null` | Why: Never create tickets for non-incidents or broken config | Description: In simple terms, This missing config or not an incident → skip because never create tickets for non-incidents or broken config.
11:     const response = await fetch(`${this.instanceUrl}/api/now/table/incident`, {
// Type: expression | Role: POST to the incident table endpoint | Outcome: API call | Why: Standard ServiceNow REST Table API | Description: In simple terms, This post to the incident table endpoint because standard ServiceNow REST Table API.
12:       method: "POST",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
13:       headers: {
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
14:         "Content-Type": "application/json",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
15:         "Authorization": `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`
// Type: expression | Role: Basic auth header (base64 of user:pass) | Outcome: Authenticated request | Why: Required by the Table API | Description: In simple terms, This basic auth header (base64 of user:pass) because it is required by the Table API.
16:       },
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
17:       body: JSON.stringify({
// Type: body | Role: Maps the result into ServiceNow fields | Outcome: short_description, description, urgency, impact, category | Why: Summary → title, body+action → description, severity → urgency/impact (1–3) | Description: In simple terms, This maps the result into servicenow fields because summary → title, body+action → description, severity → urgency/impact (1–3).
18:         short_description: result.summary,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
19:         description: `${email.body}\n\nNext action: ${result.nextAction}`,
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
20:         urgency: result.severity === "P1" ? "1" : result.severity === "P2" ? "2" : "3",
// Type: expression | Role: Severity → ServiceNow priority numbers | Outcome: P1→1, P2→2, else 3 | Why: Matches ServiceNow's 1-3 urgency/impact scale | Description: In simple terms, This severity → servicenow priority numbers because matches ServiceNow's 1-3 urgency/impact scale.
21:         impact: result.severity === "P1" ? "1" : result.severity === "P2" ? "2" : "3",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
22:         category: result.category
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
23:       })
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
24:     });
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
25:     if (!response.ok) return null;
// Type: conditional | Role: Failed POST → null | Outcome: No ticket created | Why: Report failure instead of crashing | Description: In simple terms, This failed post → null because report failure instead of crashing.
26:     const data = await response.json() as { result?: { number?: string } };
// Type: expressions | Role: Reads the created ticket number | Outcome: e.g. `INC0012345` | Why: Callers can link/confirm the ticket | Description: In simple terms, This reads the created ticket number because callers can link/confirm the ticket.
27:     return data.result?.number ?? null;
// Type: return | Role: Returns a value | Outcome: Function exits with value | Why: Passes result to caller | Description: In simple terms, This returns a value because passes result to caller.
28:   }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
29: }
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
```

## Step 8 — Public API surface: `src/index.ts`

**Type of file:** library entry (barrel re-export). When other modules `import { MultiAgentOrchestrator } from "l1-incident-multi-agent-slm-ts"`, this file defines what is public.

```ts
1: export * from "./core/types.js";
// Type: re-export | Role: Publishes all types | Outcome: Callers get the data model | Why: Shared contracts must be importable | Description: In simple terms, This publishes all types because shared contracts must be importable.
2: export * from "./core/orchestrator.js";
// Type: re-export | Role: Publishes the orchestrator + default agents | Outcome: Callers can run the pipeline | Why: The main capability is the orchestrator | Description: In simple terms, This publishes the orchestrator + default agents because the main capability is the orchestrator.
3: export * from "./clients/slm-client.js";
// Type: re-exports | Role: Publishes clients, store, integrations | Outcome: Everything is reachable from one import | Why: External code (or the scripts) compose these pieces | Description: In simple terms, This publishes clients, store, integrations because external code (or the scripts) compose these pieces.
4: export * from "./clients/graph-mail-client.js";
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
5: export * from "./storage/jsonl-store.js";
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
6: export * from "./integrations/teams-notifier.js";
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
7: export * from "./integrations/servicenow-client.js";
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
```

## Step 9 — Verification: `tests/classifier.test.ts`

**Type of file:** test (run with `npm test`). End-to-end checks of the pipeline using Node's built-in `assert` — no test framework dependency. Two cases: a clear P1 incident and a clear non-incident.

```ts
 1: import assert from "node:assert/strict";
 // Type: import | Role: Loads Node's strict assert | Outcome: Assertions available | Why: Zero-dependency testing | Description: In simple terms, This loads node's strict assert because zero-dependency testing.
 2: import { MultiAgentOrchestrator } from "../src/core/orchestrator.js";
 // Type: imports | Role: Loads the orchestrator + email type | Outcome: Test can run the real pipeline | Why: The test exercises the **actual** agent chain | Description: In simple terms, This loads the orchestrator + email type because the test exercises the **actual** agent chain.
 3: import type { EmailMessage } from "../src/core/types.js";
 // Type: import | Role: Imports dependency | Outcome: Module available | Why: Needed for functionality | Description: In simple terms, This imports dependency because it is needed for functionality.
 4:
 5: const orchestrator = new MultiAgentOrchestrator();
 // Type: expression | Role: One real orchestrator (default 8 agents) | Outcome: Pipeline ready | Why: Integration-style test, not a mock | Description: In simple terms, This one real orchestrator (default 8 agents) because integration-style test, not a mock.
 6:
 7: const p1: EmailMessage = {
 // Type: data | Role: A textbook P1 incident email | Outcome: Test input 1 | Why: "P1" + ticket + "down" + monitoring sender should classify P1 | Description: In simple terms, This a textbook p1 incident email because "P1" + ticket + "down" + monitoring sender should classify P1.
 8:   messageId: "test-001",
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
 9:   subject: "P1 INC99999 Production SQL Database Down",
 // Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
10:   body: "Users unable to login. Production unavailable.",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
11:   sender: "monitoring@company.com",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
12:   senderType: "monitoring"
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
13: };
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
14: const p1Result = await orchestrator.detect(p1);
// Type: expression | Role: Runs the full pipeline | Outcome: p1Result = classification | Why: Same path as production | Description: In simple terms, This runs the full pipeline because same path as production.
15: assert.equal(p1Result.isIncident, true);
// Type: asserts | Role: Verifies isIncident, severity P1, FOCUS_REQUIRED, DBA Team | Outcome: Tests fail loudly if wrong | Why: Locks in expected deterministic behaviour | Description: In simple terms, This verifies isincident, severity p1, focus_required, dba team because locks in expected deterministic behaviour.
16: assert.equal(p1Result.severity, "P1");
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
17: assert.equal(p1Result.state, "FOCUS_REQUIRED");
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
18: assert.equal(p1Result.owner, "DBA Team");
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
19:
20: const nonIncident: EmailMessage = {
// Type: data | Role: A newsletter email | Outcome: Test input 2 | Why: Routine mail must be rejected | Description: In simple terms, This a newsletter email because routine mail must be rejected.
21:   messageId: "test-002",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
22:   subject: "Newsletter release notes",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
23:   body: "Enhancement ideas and information request.",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
24:   sender: "news@company.com",
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
25:   senderType: "unknown"
// Type: property | Role: Sets object property | Outcome: Property is initialized | Why: Required for data structure | Description: In simple terms, This code sets object property because it is required for data structure.
26: };
// Type: syntax | Role: Closes the block | Outcome: Scope ends | Why: Required by syntax | Description: In simple terms, This closes the block because it is required by syntax.
27: const nonResult = await orchestrator.detect(nonIncident);
// expression | Runs the pipeline | nonResult = classification | Description: In simple terms, This line: Runs the pipeline, nonResult = classification
28: assert.equal(nonResult.isIncident, false);
// Type: asserts | Role: Verifies non-incident + NON_INCIDENT severity | Outcome: Tests fail loudly if wrong | Why: Guards against over-classifying routine mail | Description: In simple terms, This verifies non-incident + non_incident severity because guards against over-classifying routine mail.
29: assert.equal(nonResult.severity, "NON_INCIDENT");
// Type: expression | Role: Executes statement | Outcome: State updated | Why: Part of application logic | Description: In simple terms, This code executes statement because part of application logic.
30:
31: console.log("All tests passed.");
// Type: call | Role: Prints success | Outcome: Clean pass message | Why: Simple, framework-free output | Description: In simple terms, This prints success because simple, framework-free output.
```

## Step 10 — Sample data: `samples/sample-emails.json`

**Type of file:** data (JSON array of `EmailMessage`). Used by `scripts/run-sample.ts` to demo the pipeline without a mailbox. The 20 samples deliberately cover the interesting cases:

| Samples | What they cover |
|---|---|
| sample-001 / 002 | same API incident sent twice (shows the need for dedupe) |
| sample-003 | resolved incident (INC54323, "fixed … customer informed") → ADDRESSED |
| sample-004 | newsletter → NON_INCIDENT |
| sample-005 | database connection failure → database/DBA |
| sample-006 | payment latency → revenue impact |
| sample-007 | signup page broken → application |
| sample-008 | meeting invite → NON_INCIDENT |
| sample-009 | high CPU on a server → infrastructure/Infra |
| sample-010 | VPN login issue → authentication/IAM |
| sample-011 | scheduled maintenance → should be non-incident but is trickier (a known false-positive case) |
| sample-012 | data pipeline failure → analytics/data platform |
| sample-013 | positive feedback → NON_INCIDENT |
| sample-014 | CRITICAL website DOWN → P1 focus required |
| sample-015 | out-of-office → NON_INCIDENT |
| sample-016 | minor bug, "not urgent" → low priority |
| sample-017 | invoice → NON_INCIDENT |
| sample-018 | disk 90% full (WARNING) → P3 database |
| sample-019 | password reset request → authentication/access |
| sample-020 | Redis eviction high → performance |

The stored output lives in `data/sample-incidents.jsonl` — same JSONL format the production store uses, produced by the very same `JsonlIncidentStore` class.

## Step 11 — Build & run configuration

These files don't contain pipeline logic, but they define **how the application is built and run**, which is part of the flow from "code" to "running service".

### Step 11.1 — `package.json` — Project manifest and commands

| Field | Value | Role / why |
|---|---|---|
| `name` | `l1-incident-multi-agent-slm-ts` | Package identity |
| `type` | `module` | The code is ESM (`import`/`export` syntax) — modern Node style |
| `main` | `dist/index.js` | Compiled entry for consumers |
| `scripts.dev` | `tsx src/index.ts` | Dev entry (index.ts is only re-exports, so this effectively starts nothing — the real run scripts are `api`/`sample`) |
| `scripts.sample` | `tsx scripts/run-sample.ts` | Runs the offline demo (Step 2.2) |
| `scripts.api` | `tsx src/server/http-server.ts` | Starts the HTTP API (Step 2.1) |
| `scripts.build` | `tsc -p tsconfig.json` | Compiles TS → `dist/` |
| `scripts.test` | `tsx tests/classifier.test.ts` | Runs the regression test (Step 9) |
| `dependencies` | `@azure/msal-node` only | The single runtime dependency — Graph auth; everything else uses Node built-ins |
| `devDependencies` | `tsx`, `typescript`, `@types/node` | Tooling for running TS directly and type-checking |
| `engines` | `node >= 20` | Requires modern Node (native `fetch` is available from Node 18+) |

### Step 11.2 — `tsconfig.json` — TypeScript compiler settings

| Setting | Value | Role / why |
|---|---|---|
| `target` | `ES2022` | Modern JS output; native `fetch`, `AbortController`, `URL` all exist |
| `module` / `moduleResolution` | `NodeNext` | ESM + Node-style `.js` import resolution (files import `"./x.js"` even in TS source) |
| `rootDir` / `outDir` | `.` / `dist` | Compiles everything under `dist/`, preserving structure (`dist/src/server/http-server.js`) |
| `strict` | `true` | Full type safety — this is why the codebase has no implicit `any` |
| `esModuleInterop` | `true` | Simplifies default imports from CommonJS packages |
| `skipLibCheck` | `true` | Skips type-checking dependencies (faster builds) |
| `resolveJsonModule` | `true` | Allows importing JSON if needed |
| `include` | `src/**/*.ts`, `scripts/**/*.ts`, `tests/**/*.ts` | Exactly which sources are compiled |

### Step 11.3 — `Dockerfile` — Container image

```dockerfile
1: FROM node:20-slim
2: WORKDIR /app
3: COPY package*.json ./
4: RUN npm install
5: COPY . .
6: RUN npm run build
7: EXPOSE 8080
8: CMD ["node", "dist/src/server/http-server.js"]
```

| Line | Type | Role / outcome | Why |
|---|---|---|---|
| 1 | base image | Starts from Node 20 (slim variant) | Matches the `engines` requirement; slim = smaller image |
| 2 | WORKDIR | Sets `/app` as the working directory | All later commands run there |
| 3 | COPY | Copies `package.json` + lockfile first | Layer caching — deps reinstall only when the manifest changes |
| 4 | RUN | Installs dependencies | `node_modules` available | |
| 5 | COPY | Copies the rest of the source | Full app in the image | |
| 6 | RUN | Compiles TypeScript to `dist/` | Production JS build created | Node runs compiled JS, not TS |
| 7 | EXPOSE | Documents port 8080 | Container port declared | Matches the default `PORT` |
| 8 | CMD | Starts the HTTP API from the compiled output | `node dist/src/server/http-server.js` | The container runs the API (Step 2.1) |

### Step 11.4 — `docker-compose.yml` — One-command run

```yaml
1: services:
2:   l1-incident-multi-agent-slm-ts:
3:     build: .
4:     ports:
5:       - "8080:8080"
6:     env_file:
7:       - .env
8:     volumes:
9:       - ./data:/app/data
10: ```

| Line | Type | Role / outcome | Why |
|---|---|---|---|
| 1–2 | service | Defines the single service | Compose runs the app | |
| 3 | build | Builds from the local Dockerfile | Image created on first run | |
| 4–5 | ports | Maps host 8080 → container 8080 | API reachable at `localhost:8080` | Standard API access |
| 6–7 | env_file | Injects `.env` into the container | All config (SLM, Graph, Teams, ServiceNow) available | The app reads env via `src/utils/env.ts` |
| 8–9 | volumes | Mounts `./data` over `/app/data` | JSONL incidents persist on the host | The default store path is `data/incidents.jsonl` — this survives container recreation |

### Step 11.5 — `Modelfile` — Local SLM definition (Ollama)

```dockerfile
1: FROM phi3:3.8b-mini-4k-instruct-q4_K_M
// Type: base model | Role: Pulls the Phi-3 3.8B mini instruct model (quantized) | Outcome: A small, fast model suitable for L1 triage | Why: Small models run on a laptop GPU/CPU; `SLM_MODEL` default is `phi3:mini`
2: PARAMETER num_ctx 4096
// Type: parameter | Role: Sets a 4096-token context window | Outcome: The model can read the email + instructions | Why: Emails are short; 4k tokens is plenty and keeps latency low
```

### Step 11.6 — `.env.example` — All configuration knobs

| Variable | Default | Used by | Purpose |
|---|---|---|---|
| `NODE_ENV` / `PORT` | local / 8080 | http-server | Runtime mode and API port |
| `SLM_ENABLED` | false | slm-client | Master switch for the SLM enrichment step |
| `SLM_BASE_URL` | `http://localhost:11434/v1` | slm-client | Ollama/OpenAI-compatible endpoint |
| `SLM_API_KEY` | ollama | slm-client | Auth (Ollama accepts anything) |
| `SLM_MODEL` | phi3:mini | slm-client | Which model to call |
| `SLM_TIMEOUT_MS` | 15000 | slm-client | Abort the SLM call after this long |
| `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `MAILBOX_USER_ID` | — | graph-mail-client | Azure AD app registration + mailbox for the Outlook watcher |
| `MAIL_LOOKBACK_MINUTES` | 30 | graph-mail-client | Only fetch mail newer than this |
| `MAIL_POLL_SECONDS` | 60 | watch-mailbox | Poll interval |
| `TEAMS_WEBHOOK_URL` | (empty) | teams-notifier | Empty = Teams disabled |
| `SERVICENOW_*` | (empty) | servicenow-client | Empty = ServiceNow disabled |

## 5. End-to-end worked example (trace one email through every step)

Using the README's example request, here is exactly what happens inside the system:

```json
{
  "messageId": "demo-001",
  "subject": "P1 INC54321 Production SQL Database Down",
  "body": "Production database unavailable. Users unable to login.",
  "sender": "monitoring-alerts@company.com",
  "senderType": "monitoring"
}
```

1. **POST /detect** (Step 2.1) reads the JSON body as an `EmailMessage` and calls `orchestrator.detect(email)`. (Step 3)
2. **EmailScreeningAgent** (4.1): text = subject + body.
   - `INC54321` matches `ticketPatterns` → `ctx.incidentId = "INC54321"`, signal `ticket-id` (+20).
   - `P1` and `PROD(UCTION)? DOWN` match → `severity-pattern-P1` signals (+45 each).
   - `unavailable` → keyword-critical (+30); `unable to login` → keyword-critical (+30).
   - Sender is explicitly `monitoring` → signal `sender-monitoring` (+15). Total ≈ 140 → will clamp to 100.
3. **SlmIncidentAgent** (4.2): if `SLM_ENABLED=true`, asks the model; if the model says `severity: P1`, it's kept. If disabled/unavailable → nothing changes.
4. **SeverityClassifierAgent** (4.3): score 140 → bounded 100 → `hasP1` true → severity P1; isIncident = true; confidence = 100 capped at 99 (+10 ticket bonus) → 99.
5. **OwnershipResolverAgent** (4.4): "database" matches the DBA routing row → category `database`, owner `DBA Team`.
6. **BusinessImpactAgent** (4.5): "unavailable" → "Production availability impact".
7. **StatusTrackerAgent** (4.6): no status phrases → WATCH, but severity P1 → `FOCUS_REQUIRED`.
8. **ActionAgent** (4.7): FOCUS_REQUIRED → "Assign immediately to DBA Team; escalate if no update."
9. **SummaryAgent** (4.8): builds "P1 database incident detected from email: P1 INC54321 Production SQL Database Down. Impact: Production availability impact. Current state: FOCUS_REQUIRED."
10. **Outputs** (Steps 5–7): record saved to `data/incidents.jsonl`; Teams alert posted (state is FOCUS_REQUIRED and webhook set); ServiceNow client available for optional ticket creation.

Final result matches the README example output, including `confidence: 99`.

## 6. How the design maps to the flow (summary)

| Design decision | Where | Why it matters |
|---|---|---|
| Shared `AgentContext` mutated in place | `core/types.ts`, `core/orchestrator.ts` | Lets 8 independent agents collaborate without complex plumbing |
| Deterministic rules first, SLM optional | `config/rules.ts`, `agents/slm-incident-agent.ts` | Repeatable, cheap, offline-safe classification |
| Every agent degrades gracefully | `slm-client.ts` (returns null), each agent's guards | One broken step can never crash the whole pipeline |
| Audit trail on everything | `ctx.audit` | Every result is explainable — important for an L1 triage tool |
| JSONL append-only storage | `storage/jsonl-store.ts` | Simple, crash-safe persistence with zero infra |
| Integrations opt-in via env | teams-notifier, servicenow-client, slm-client | One build, many deployment flavours |
| Single pipeline entry (`detect`) | `core/orchestrator.ts` | API, sample runner, and watcher share identical behaviour |

## 7. Where to go deeper

- **Rules tuning** — all thresholds, keywords, weights, and routing live in `src/config/rules.ts`; changing them changes classification everywhere.
- **SLM behaviour** — the system prompt and schema hint live in `src/agents/slm-incident-agent.ts`; the client + env config in `src/clients/slm-client.ts`.
- **Dedupe gap** — samples 001/002 show the same incident twice; deduplication (by conversationId/incidentId/semantic similarity) is listed in the README backlog.
- **Production hardening** — README's backlog suggests replacing JSONL with a real database, adding approval before ServiceNow creation, and dashboards.

---

*This document was generated from the actual source code — every snippet above matches the current files. If any part of the flow is unclear, ask and it can be expanded further (e.g. deep-dive one agent, or walk through a specific sample email).*
