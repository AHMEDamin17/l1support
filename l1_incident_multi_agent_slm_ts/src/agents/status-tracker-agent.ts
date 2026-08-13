import type { Agent, AgentContext, IncidentState } from "../core/types.js";
import { rules } from "../config/rules.js";

export class StatusTrackerAgent implements Agent {
  name = "StatusTrackerAgent";

  async run(ctx: AgentContext): Promise<AgentContext> {
    const text = `${ctx.email.subject}\n${ctx.email.body}`.toLowerCase();
    let state: IncidentState = "WATCH";

    for (const phrase of rules.statusPhrases.ADDRESSED) {
      if (text.includes(phrase)) state = "ADDRESSED";
    }
    for (const phrase of rules.statusPhrases.AWAITING_CUSTOMER) {
      if (text.includes(phrase)) state = "AWAITING_CUSTOMER";
    }
    for (const phrase of rules.statusPhrases.FOCUS_REQUIRED) {
      if (text.includes(phrase)) state = "FOCUS_REQUIRED";
    }

    if (ctx.severity === "P1" && state !== "ADDRESSED" && state !== "AWAITING_CUSTOMER") state = "FOCUS_REQUIRED";
    if (ctx.severity === "P2" && state === "WATCH") state = "FOCUS_REQUIRED";
    if (!ctx.isIncident || ctx.severity === "NON_INCIDENT") state = "NON_INCIDENT";

    ctx.state = ctx.state && ctx.state !== "WATCH" ? ctx.state : state;
    ctx.audit.push(`${this.name}: state=${ctx.state}.`);
    return ctx;
  }
}
