import { google } from "googleapis";
import fs from "node:fs/promises";
import path from "node:path";
import type { EmailMessage, SenderType } from "../core/types.js";
import { env } from "../utils/env.js";

export class GmailApiClient {
  private oauth2Client: any;
  private readonly tokenPath = path.join(process.cwd(), "gmail-token.json");

  constructor() {
    const clientId = env("GMAIL_CLIENT_ID");
    const clientSecret = env("GMAIL_CLIENT_SECRET");
    const redirectUri = env("GMAIL_REDIRECT_URI", "http://localhost:3000/oauth2callback");

    if (!clientId || !clientSecret) {
      throw new Error("Missing Gmail OAuth values: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET.");
    }

    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  private async authorize(): Promise<void> {
    try {
      const tokenStr = await fs.readFile(this.tokenPath, "utf-8");
      const token = JSON.parse(tokenStr);
      this.oauth2Client.setCredentials(token);
    } catch (error) {
      throw new Error(`Unable to read gmail-token.json. Please run 'npm run auth:gmail' first. (${error})`);
    }
  }

  async fetchRecentMessages(lookbackMinutes = Number(env("MAIL_LOOKBACK_MINUTES", "30")), top = 25): Promise<EmailMessage[]> {
    await this.authorize();
    const gmail = google.gmail({ version: "v1", auth: this.oauth2Client });

    // Look back time
    const sinceEpoch = Math.floor((Date.now() - lookbackMinutes * 60_000) / 1000);
    const query = `after:${sinceEpoch} in:inbox`;

    const res = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: top,
    });

    const messages = res.data.messages;
    if (!messages || messages.length === 0) {
      return [];
    }

    const emailMessages: EmailMessage[] = [];

    for (const msg of messages) {
      if (!msg.id) continue;
      
      const details = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      });

      const payload = details.data.payload;
      const headers = payload?.headers || [];
      
      const subject = headers.find(h => h.name?.toLowerCase() === "subject")?.value ?? "No Subject";
      const from = headers.find(h => h.name?.toLowerCase() === "from")?.value ?? "Unknown Sender";
      const dateStr = headers.find(h => h.name?.toLowerCase() === "date")?.value;
      const messageIdHeader = headers.find(h => h.name?.toLowerCase() === "message-id")?.value;

      // Extract body (very basic extraction for plain text or simple html)
      let bodyText = "";
      if (payload?.body?.data) {
        bodyText = Buffer.from(payload.body.data, 'base64').toString('utf-8');
      } else if (payload?.parts && payload.parts.length > 0) {
        // Try to find plain text part
        const textPart = payload.parts.find(p => p.mimeType === "text/plain");
        if (textPart?.body?.data) {
          bodyText = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
        } else {
           // Fallback to first part
           const firstPart = payload.parts[0];
           if (firstPart?.body?.data) {
             bodyText = Buffer.from(firstPart.body.data, 'base64').toString('utf-8');
           }
        }
      }

      // Clean up sender to just email address if possible (e.g., "Name <email@dom.com>" -> "email@dom.com")
      let senderEmail = from;
      const match = from.match(/<([^>]+)>/);
      if (match && match[1]) {
        senderEmail = match[1];
      }

      emailMessages.push({
        messageId: msg.id,
        subject,
        body: bodyText.substring(0, 1000),
        sender: senderEmail,
        senderType: this.senderType(senderEmail, []),
        receivedAt: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
        conversationId: details.data.threadId ?? undefined,
        importance: "normal",
        categories: []
      });
    }

    // Sort descending by received date
    return emailMessages.sort((a, b) => {
      return new Date(b.receivedAt!).getTime() - new Date(a.receivedAt!).getTime();
    });
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
