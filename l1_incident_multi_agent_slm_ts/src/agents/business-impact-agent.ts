import type { Agent, AgentContext } from "../core/types.js";

export class BusinessImpactAgent implements Agent {
  name = "BusinessImpactAgent";

  async run(ctx: AgentContext): Promise<AgentContext> {
    const text = `${ctx.email.subject}\n${ctx.email.body}`.toLowerCase();
    let impact = "Impact not clearly stated";
    if (["production down", "application down", "service down", "unavailable"].some(x => text.includes(x))) impact = "Production availability impact";
    else if (["data loss", "corrupt", "integrity"].some(x => text.includes(x))) impact = "Data integrity risk";
    else if (["payment", "revenue", "billing", "order"].some(x => text.includes(x))) impact = "Revenue transaction impact";
    else if (["login", "sso", "auth", "unable to login"].some(x => text.includes(x))) impact = "User access impact";
    else if (["slow", "performance", "latency", "timeout"].some(x => text.includes(x))) impact = "Performance degradation";
    ctx.businessImpact = ctx.businessImpact ?? impact;
    ctx.audit.push(`${this.name}: impact=${ctx.businessImpact}.`);
    return ctx;
  }
}
