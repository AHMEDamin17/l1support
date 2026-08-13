import { ConfidentialClientApplication } from "@azure/msal-node";
import type { EmailMessage, SenderType } from "../core/types.js";
import { env } from "../utils/env.js";

interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  from?: { emailAddress?: { address?: string } };
  receivedDateTime?: string;
  conversationId?: string;
  importance?: string;
  categories?: string[];
}

export class GraphMailClient {
  private readonly tenantId = env("TENANT_ID");
  private readonly clientId = env("CLIENT_ID");
  private readonly clientSecret = env("CLIENT_SECRET");
  private readonly mailboxUserId = env("MAILBOX_USER_ID");
  private readonly scope = "https://graph.microsoft.com/.default";
  private readonly app: ConfidentialClientApplication;

  constructor() {
    if (!this.tenantId || !this.clientId || !this.clientSecret || !this.mailboxUserId) {
      throw new Error("Missing Graph env values: TENANT_ID, CLIENT_ID, CLIENT_SECRET, MAILBOX_USER_ID.");
    }
    this.app = new ConfidentialClientApplication({
      auth: {
        clientId: this.clientId,
        authority: `https://login.microsoftonline.com/${this.tenantId}`,
        clientSecret: this.clientSecret
      }
    });
  }

  async fetchRecentMessages(lookbackMinutes = Number(env("MAIL_LOOKBACK_MINUTES", "30")), top = 25): Promise<EmailMessage[]> {
    const token = await this.token();
    const since = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();
    const url = new URL(`https://graph.microsoft.com/v1.0/users/${this.mailboxUserId}/mailFolders/inbox/messages`);
    url.searchParams.set("$top", String(top));
    url.searchParams.set("$select", "id,subject,bodyPreview,from,receivedDateTime,conversationId,importance,categories");
    url.searchParams.set("$orderby", "receivedDateTime desc");
    url.searchParams.set("$filter", `receivedDateTime ge ${since}`);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Graph fetch failed: ${response.status} ${await response.text()}`);
    const data = await response.json() as { value?: GraphMessage[] };
    return (data.value ?? []).map(m => {
      const sender = m.from?.emailAddress?.address ?? "";
      return {
        messageId: m.id,
        subject: m.subject ?? "",
        body: m.bodyPreview ?? "",
        sender,
        senderType: this.senderType(sender, m.categories ?? []),
        receivedAt: m.receivedDateTime,
        conversationId: m.conversationId,
        importance: m.importance,
        categories: m.categories ?? []
      };
    });
  }

  private async token(): Promise<string> {
    const result = await this.app.acquireTokenByClientCredential({ scopes: [this.scope] });
    if (!result?.accessToken) throw new Error("Unable to acquire Microsoft Graph token.");
    return result.accessToken;
  }

  private senderType(sender: string, categories: string[]): SenderType {
    const lower = sender.toLowerCase();
    const cat = categories.join(" ").toLowerCase();
    if (lower.includes("monitor") || lower.includes("alert") || cat.includes("monitoring")) return "monitoring";
    if (lower.includes("servicenow") || lower.includes("jira") || lower.includes("ticket")) return "ticketing";
    if (lower.includes("customer") || lower.includes("client")) return "customer";
    return sender ? "internal" : "unknown";
  }
}
