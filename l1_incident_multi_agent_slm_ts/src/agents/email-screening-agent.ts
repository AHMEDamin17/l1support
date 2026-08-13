import type { Agent, AgentContext, IncidentSignal, SenderType } from "../core/types.js";
import { rules } from "../config/rules.js";

export class EmailScreeningAgent implements Agent {
  name = "EmailScreeningAgent";

  async run(ctx: AgentContext): Promise<AgentContext> {
    const text = `${ctx.email.subject}\n${ctx.email.body}`;
    const signals: IncidentSignal[] = [];

    for (const expr of rules.ticketPatterns) {
      const hit = text.match(expr)?.[0];
      if (hit) {
        ctx.incidentId = hit.toUpperCase();
        signals.push({ source: this.name, name: "ticket-id", weight: 20, evidence: hit });
        break;
      }
    }

    for (const [severity, patterns] of Object.entries(rules.severityPatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          signals.push({ source: this.name, name: `severity-pattern-${severity}`, weight: severity === "P1" ? 45 : severity === "P2" ? 30 : 20, evidence: pattern.source });
        }
      }
    }

    for (const [level, words] of Object.entries(rules.keywords)) {
      for (const word of words) {
        if (text.toLowerCase().includes(word.toLowerCase())) {
          const weight = level === "critical" ? 30 : level === "high" ? 20 : level === "medium" ? 10 : -25;
          signals.push({ source: this.name, name: `keyword-${level}`, weight, evidence: word });
        }
      }
    }

    const senderType = this.senderType(ctx.email.sender, ctx.email.senderType, ctx.email.categories ?? []);
    ctx.email.senderType = senderType;
    signals.push({ source: this.name, name: `sender-${senderType}`, weight: Math.floor(rules.senderScore[senderType] / 5), evidence: ctx.email.sender || "unknown" });
    ctx.signals.push(...signals);
    ctx.audit.push(`${this.name}: collected ${signals.length} screening signals.`);
    return ctx;
  }

  private senderType(sender: string, explicit?: SenderType, categories: string[] = []): SenderType {
    if (explicit) return explicit;
    const lower = sender.toLowerCase();
    const cat = categories.join(" ").toLowerCase();
    if (lower.includes("monitor") || lower.includes("alert") || cat.includes("monitoring")) return "monitoring";
    if (lower.includes("servicenow") || lower.includes("jira") || lower.includes("ticket")) return "ticketing";
    if (lower.includes("customer") || lower.includes("client")) return "customer";
    return sender ? "internal" : "unknown";
  }
}
