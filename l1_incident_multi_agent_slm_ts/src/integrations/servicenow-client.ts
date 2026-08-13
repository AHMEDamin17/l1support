import type { DetectionResult, EmailMessage } from "../core/types.js";
import { env } from "../utils/env.js";

export class ServiceNowClient {
  private readonly instanceUrl = env("SERVICENOW_INSTANCE_URL", "").replace(/\/$/, "");
  private readonly username = env("SERVICENOW_USERNAME", "");
  private readonly password = env("SERVICENOW_PASSWORD", "");

  async createIncident(email: EmailMessage, result: DetectionResult): Promise<string | null> {
    if (!this.instanceUrl || !this.username || !this.password || !result.isIncident) return null;
    const response = await fetch(`${this.instanceUrl}/api/now/table/incident`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`
      },
      body: JSON.stringify({
        short_description: result.summary,
        description: `${email.body}\n\nNext action: ${result.nextAction}`,
        urgency: result.severity === "P1" ? "1" : result.severity === "P2" ? "2" : "3",
        impact: result.severity === "P1" ? "1" : result.severity === "P2" ? "2" : "3",
        category: result.category
      })
    });
    if (!response.ok) return null;
    const data = await response.json() as { result?: { number?: string } };
    return data.result?.number ?? null;
  }
}
