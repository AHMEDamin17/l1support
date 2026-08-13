import type { Agent, AgentContext } from "../core/types.js";

export class SummaryAgent implements Agent {
  name = "SummaryAgent";

  async run(ctx: AgentContext): Promise<AgentContext> {
    if (!ctx.summary) {
      const subject = ctx.email.subject || "No subject";
      if (!ctx.isIncident || ctx.severity === "NON_INCIDENT") {
        ctx.summary = `Non-incident email: ${subject}.`;
      } else {
        ctx.summary = `${ctx.severity} ${ctx.category} incident detected from email: ${subject}. Impact: ${ctx.businessImpact}. Current state: ${ctx.state}.`;
      }
    }
    ctx.audit.push(`${this.name}: summary generated.`);
    return ctx;
  }
}
