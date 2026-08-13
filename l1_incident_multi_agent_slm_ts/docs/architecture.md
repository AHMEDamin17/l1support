# Multi-Agent Architecture

```text
Outlook / Sample Email
        |
        v
Email Screening Agent
        |
        v
SLM Incident Agent
        |
        v
Severity Classifier Agent
        |
        v
Ownership Resolver Agent
        |
        v
Business Impact Agent
        |
        v
Status Tracker Agent
        |
        v
Action Agent
        |
        v
Summary Agent
        |
        +--> JSONL Store
        +--> Teams Webhook
        +--> Optional ServiceNow
```

## Why SLM + deterministic agents

The package uses deterministic screening for repeatability and cost control. The SLM is used as an enrichment layer for ambiguous email language, impact extraction, and concise summaries. If the SLM is disabled or unavailable, the pipeline still works using the deterministic agents.

## SLM compatibility

Use any OpenAI-compatible small language model endpoint:

- Ollama OpenAI-compatible endpoint
- vLLM
- LM Studio
- Azure AI Foundry model endpoint if exposed as OpenAI-compatible chat completions
- Any internal model gateway supporting `/chat/completions`
