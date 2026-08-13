# L1 Incident Multi-Agent System using TypeScript and SLM

This package is a TypeScript multi-agent implementation for an L1 incident email watcher. It monitors incident-like emails, uses deterministic triage rules, optionally enriches classification with a Small Language Model, and produces actionable L1 outputs.

## Included agents

1. **Email Screening Agent** - extracts incident IDs, severity patterns, keywords, and sender trust signals.
2. **SLM Incident Agent** - calls an OpenAI-compatible SLM endpoint for semantic incident enrichment.
3. **Severity Classifier Agent** - computes P1/P2/P3/P4 severity from signals.
4. **Ownership Resolver Agent** - maps issue category to support owner.
5. **Business Impact Agent** - identifies production, revenue, access, data, and performance impact.
6. **Status Tracker Agent** - identifies Focus Required, Addressed, Awaiting Customer, Watch, or Non-Incident.
7. **Action Agent** - recommends the next L1 action.
8. **Summary Agent** - creates a concise incident summary.

## Project structure

```text
src/
  agents/
  clients/
  config/
  core/
  integrations/
  server/
  storage/
  utils/
scripts/
samples/
tests/
docs/
```

## Setup

```bash
npm install
cp .env.example .env
```

## Run sample emails

```bash
npm run sample
```

## Run API

```bash
npm run api
```

Endpoints:

- `GET /health`
- `POST /detect`
- `GET /incidents`
- `GET /summary`

## Sample detect request

```bash
curl -X POST http://localhost:8080/detect \
  -H "Content-Type: application/json" \
  -d '{
    "messageId":"demo-001",
    "subject":"P1 INC54321 Production SQL Database Down",
    "body":"Production database unavailable. Users unable to login.",
    "sender":"monitoring-alerts@company.com",
    "senderType":"monitoring"
  }'
```

## Enable local SLM

The SLM client supports any OpenAI-compatible `/chat/completions` endpoint.

Example `.env` for Ollama-compatible endpoint:

```bash
SLM_ENABLED=true
SLM_BASE_URL=http://localhost:11434/v1
SLM_API_KEY=ollama
SLM_MODEL=phi3:mini
```

If the SLM is unavailable, the deterministic agents continue processing emails.

## Run tests

```bash
npm test
```

## Outlook watcher

Set the Graph values in `.env`:

```bash
TENANT_ID=...
CLIENT_ID=...
CLIENT_SECRET=...
MAILBOX_USER_ID=shared-support-mailbox@company.com
```

Then run:

```bash
tsx scripts/watch-mailbox.ts
```

## Output example

```json
{
  "isIncident": true,
  "incidentId": "INC54321",
  "severity": "P1",
  "category": "database",
  "owner": "DBA Team",
  "state": "FOCUS_REQUIRED",
  "confidence": 99,
  "businessImpact": "Production availability impact",
  "summary": "P1 database incident detected from email: P1 INC54321 Production SQL Database Down. Impact: Production availability impact. Current state: FOCUS_REQUIRED.",
  "nextAction": "Assign immediately to DBA Team; escalate if no update."
}
```

## Production hardening backlog

- Replace JSONL store with Azure SQL, Dataverse, or PostgreSQL.
- Add duplicate incident correlation by conversation ID, incident ID, and semantic similarity.
- Add adaptive card approval before ServiceNow ticket creation.
- Add Power BI dashboard over incident JSONL/SQL table.
- Add customer-specific routing rules and SLA timers.
