import type { Agent, AgentContext } from "../core/types.js";
import { rules } from "../config/rules.js";

export class OwnershipResolverAgent implements Agent {
  name = "OwnershipResolverAgent";

  async run(ctx: AgentContext): Promise<AgentContext> {
    const text = `${ctx.email.subject}\n${ctx.email.body}`.toLowerCase();
    const route = rules.routing.find(r => r.aliases.some(alias => text.includes(alias.toLowerCase()))) ?? rules.routing[rules.routing.length - 1];
    ctx.category = ctx.category && ctx.category !== "unknown" ? ctx.category : route.category;
    ctx.owner = route.owner;
    ctx.audit.push(`${this.name}: category=${ctx.category}; owner=${ctx.owner}.`);
    return ctx;
  }
}
