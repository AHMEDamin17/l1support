import type { Agent, AgentContext, Severity } from "../core/types.js";
import { rules } from "../config/rules.js";

export class SeverityClassifierAgent implements Agent {
  name = "SeverityClassifierAgent";

  async run(ctx: AgentContext): Promise<AgentContext> {
    const score = ctx.signals.reduce((sum, s) => sum + s.weight, 0);
    const bounded = Math.max(0, Math.min(100, score));
    const hasP1 = ctx.signals.some(s => s.name.includes("severity-pattern-P1"));
    const hasP2 = ctx.signals.some(s => s.name.includes("severity-pattern-P2"));
    const hasP3 = ctx.signals.some(s => s.name.includes("severity-pattern-P3"));
    const nonIncident = ctx.signals.some(s => s.name === "keyword-nonIncident") && bounded < 70;

    let severity: Severity = "P4";
    if (hasP1 || bounded >= 85) severity = "P1";
    else if (hasP2 || bounded >= 65) severity = "P2";
    else if (hasP3 || bounded >= 45) severity = "P3";
    const hasTicket = ctx.signals.some(s => s.name === "ticket-id");
    if (nonIncident || (bounded < rules.incidentScoreThreshold && !hasTicket)) severity = "NON_INCIDENT";

    ctx.severity = ctx.severity && ctx.severity !== "NON_INCIDENT" ? ctx.severity : severity;
    ctx.isIncident = ctx.isIncident ?? (ctx.severity !== "NON_INCIDENT" || (hasTicket && !nonIncident));
    ctx.confidence = Math.max(ctx.confidence ?? 0, Math.min(99, bounded + (ctx.incidentId ? 10 : 0)));
    ctx.audit.push(`${this.name}: severity=${ctx.severity}; score=${bounded}; confidence=${ctx.confidence}.`);
    return ctx;
  }
}
