import type { SenderType, Severity } from "../core/types.js";

export const rules = {
  incidentScoreThreshold: 40,
  slmConfidenceFloor: 65,
  ticketPatterns: [/\bINC[0-9]{4,}\b/i, /\bSR[0-9]{4,}\b/i, /\bCASE[0-9]{4,}\b/i, /\bTICKET[0-9]{4,}\b/i],
  severityPatterns: {
    P1: [/\bP1\b/i, /\bSEV[- ]?1\b/i, /\bCRITICAL\b/i, /\bPROD(UCTION)? DOWN\b/i],
    P2: [/\bP2\b/i, /\bSEV[- ]?2\b/i, /\bURGENT\b/i, /\bESCALATION\b/i],
    P3: [/\bP3\b/i, /\bSEV[- ]?3\b/i, /\bWARNING\b/i]
  } satisfies Record<Exclude<Severity, "P4" | "NON_INCIDENT">, RegExp[]>,
  keywords: {
    critical: ["outage", "production down", "unavailable", "application down", "database down", "service down", "data loss", "unable to login", "payment failure"],
    high: ["incident", "failed", "error", "degraded", "escalation", "business impact", "blocked", "customer impacted"],
    medium: ["warning", "delay", "slow", "performance", "timeout", "intermittent"],
    nonIncident: ["enhancement", "change request", "access request", "information request", "newsletter", "release notes"]
  },
  senderScore: {
    vip: 100,
    customer: 90,
    operations: 80,
    monitoring: 75,
    ticketing: 70,
    internal: 60,
    unknown: 30
  } satisfies Record<SenderType, number>,
  routing: [
    { category: "database", owner: "DBA Team", aliases: ["database", "sql", "db", "oracle", "postgres", "mysql", "deadlock"] },
    { category: "api", owner: "Middleware/API Team", aliases: ["api", "gateway", "apim", "rest", "endpoint"] },
    { category: "infrastructure", owner: "Infra/Cloud Operations", aliases: ["server", "vm", "cpu", "memory", "disk", "azure", "network", "load balancer"] },
    { category: "authentication", owner: "IAM Team", aliases: ["login", "auth", "sso", "entra", "aad", "token", "permission"] },
    { category: "analytics", owner: "Data Platform Support", aliases: ["power bi", "report", "dashboard", "databricks", "data pipeline", "adf", "fabric"] },
    { category: "application", owner: "Application Support", aliases: ["application", "app", "portal", "ui", "page", "module"] }
  ],
  statusPhrases: {
    ADDRESSED: ["resolved", "fixed", "service restored", "patch applied", "monitoring", "customer informed", "workaround applied"],
    AWAITING_CUSTOMER: ["awaiting customer", "pending confirmation", "waiting for validation", "customer action required", "please confirm"],
    FOCUS_REQUIRED: ["no owner", "still down", "not resolved", "urgent attention", "sla breach", "escalated"]
  }
};
