import type { Agent, AgentContext, IncidentState, Severity } from "../core/types.js";
import { SlmClient } from "../clients/slm-client.js";

interface SlmIncidentJson {
  isIncident?: boolean;
  severity?: Severity;
  category?: string;
  businessImpact?: string;
  state?: IncidentState;
  confidence?: number;
  summary?: string;
}

export class SlmIncidentAgent implements Agent {
  name = "SlmIncidentAgent";
  constructor(private readonly slm = new SlmClient()) {}

  async run(ctx: AgentContext): Promise<AgentContext> {
    const prompt = [
      "Analyze the following email for L1 incident management.",
      `Subject: ${ctx.email.subject}`,
      `Sender: ${ctx.email.sender}`,
      `Body: ${ctx.email.body}`,
      "Classify whether this is an IT incident, severity, category, state, impact, and a concise summary."
    ].join("\n");

    const result = await this.slm.completeJson<SlmIncidentJson>({
      system: "You are an L1 incident triage agent. Be strict. Prefer valid JSON. Do not invent fields.",
      prompt,
      schemaHint: `{"isIncident":true,"severity":"P1|P2|P3|P4|NON_INCIDENT","category":"database|api|infrastructure|authentication|analytics|application|unknown","businessImpact":"short text","state":"FOCUS_REQUIRED|ADDRESSED|AWAITING_CUSTOMER|ESCALATE_L2|WATCH|NON_INCIDENT","confidence":0,"summary":"short text"}`
    });

    if (!result) {
      ctx.audit.push(`${this.name}: SLM disabled or unavailable; deterministic agents will continue.`);
      return ctx;
    }

    if (typeof result.isIncident === "boolean") ctx.isIncident = result.isIncident;
    if (result.severity) ctx.severity = result.severity;
    if (result.category) ctx.category = result.category;
    if (result.businessImpact) ctx.businessImpact = result.businessImpact;
    if (result.state) ctx.state = result.state;
    if (typeof result.confidence === "number") ctx.confidence = Math.max(0, Math.min(99, Math.round(result.confidence)));
    if (result.summary) ctx.summary = result.summary;
    ctx.audit.push(`${this.name}: SLM enrichment applied.`);
    return ctx;
  }
}
