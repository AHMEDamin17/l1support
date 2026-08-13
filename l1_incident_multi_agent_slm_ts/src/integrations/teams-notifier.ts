import type { DetectionResult, EmailMessage } from "../core/types.js";
import { env } from "../utils/env.js";

export class TeamsNotifier {
  private readonly webhook = env("TEAMS_WEBHOOK_URL", "");

  async sendFocusAlert(email: EmailMessage, result: DetectionResult): Promise<boolean> {
    if (!this.webhook) return false;
    if (!["FOCUS_REQUIRED", "ESCALATE_L2"].includes(result.state)) return false;
    const text = [
      `L1 Focus Required: ${result.severity} ${result.category}`,
      `Subject: ${email.subject}`,
      `Owner: ${result.owner}`,
      `Impact: ${result.businessImpact}`,
      `Action: ${result.nextAction}`
    ].join("\n");
    const response = await fetch(this.webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    return response.ok;
  }
}
