import type { Agent, AgentContext } from "../core/types.js";

export class ActionAgent implements Agent {
  name = "ActionAgent";

  async run(ctx: AgentContext): Promise<AgentContext> {
    if (!ctx.isIncident || ctx.severity === "NON_INCIDENT") ctx.nextAction = "No incident action required.";
    else if (ctx.state === "ADDRESSED") ctx.nextAction = "Monitor and wait for validation if required.";
    else if (ctx.state === "AWAITING_CUSTOMER") ctx.nextAction = "Follow up with customer for confirmation.";
    else if (ctx.state === "ESCALATE_L2") ctx.nextAction = `Escalate to L2 / SME group: ${ctx.owner}.`;
    else if (ctx.state === "FOCUS_REQUIRED") ctx.nextAction = `Assign immediately to ${ctx.owner}; escalate if no update.`;
    else ctx.nextAction = `Track in L1 queue and assign to ${ctx.owner}.`;

    ctx.audit.push(`${this.name}: nextAction=${ctx.nextAction}`);
    return ctx;
  }
}
