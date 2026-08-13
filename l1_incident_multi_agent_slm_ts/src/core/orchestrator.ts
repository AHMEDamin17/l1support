import type { Agent, AgentContext, DetectionResult, EmailMessage } from "./types.js";
import { EmailScreeningAgent } from "../agents/email-screening-agent.js";
import { SlmIncidentAgent } from "../agents/slm-incident-agent.js";
import { SeverityClassifierAgent } from "../agents/severity-classifier-agent.js";
import { OwnershipResolverAgent } from "../agents/ownership-resolver-agent.js";
import { BusinessImpactAgent } from "../agents/business-impact-agent.js";
import { StatusTrackerAgent } from "../agents/status-tracker-agent.js";
import { ActionAgent } from "../agents/action-agent.js";
import { SummaryAgent } from "../agents/summary-agent.js";

export class MultiAgentOrchestrator {
  constructor(private readonly agents: Agent[] = defaultAgents()) {}

  async detect(email: EmailMessage): Promise<DetectionResult> {
    let ctx: AgentContext = { email, signals: [], audit: [] };
    for (const agent of this.agents) {
      ctx = await agent.run(ctx);
    }
    return {
      isIncident: ctx.isIncident ?? false,
      incidentId: ctx.incidentId,
      severity: ctx.severity ?? "NON_INCIDENT",
      category: ctx.category ?? "unknown",
      owner: ctx.owner ?? "Unassigned",
      state: ctx.state ?? "NON_INCIDENT",
      confidence: ctx.confidence ?? 0,
      businessImpact: ctx.businessImpact ?? "Impact not clearly stated",
      summary: ctx.summary ?? "No summary generated.",
      nextAction: ctx.nextAction ?? "No action.",
      signals: ctx.signals,
      audit: ctx.audit
    };
  }
}

export function defaultAgents(): Agent[] {
  return [
    new EmailScreeningAgent(),
    new SlmIncidentAgent(),
    new SeverityClassifierAgent(),
    new OwnershipResolverAgent(),
    new BusinessImpactAgent(),
    new StatusTrackerAgent(),
    new ActionAgent(),
    new SummaryAgent()
  ];
}
