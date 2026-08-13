import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { EmailMessage, SenderType } from "../core/types.js";
import { env } from "../utils/env.js";

export class ImapMailClient {
  private readonly host = env("IMAP_HOST");
  private readonly port = Number(env("IMAP_PORT", "993"));
  private readonly user = env("IMAP_USER");
  private readonly pass = env("IMAP_PASS");
  private readonly tls = env("IMAP_TLS", "true") === "true";

  constructor() {
    if (!this.host || !this.user || !this.pass) {
      throw new Error("Missing IMAP env values: IMAP_HOST, IMAP_USER, IMAP_PASS.");
    }
  }

  async fetchRecentMessages(lookbackMinutes = Number(env("MAIL_LOOKBACK_MINUTES", "30")), top = 25): Promise<EmailMessage[]> {
    const client = new ImapFlow({
      host: this.host,
      port: this.port,
      secure: this.tls,
      auth: {
        user: this.user,
        pass: this.pass,
      },
      logger: false, // Disable verbose logging
    });

    await client.connect();
    
    const messages: EmailMessage[] = [];
    
    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const since = new Date(Date.now() - lookbackMinutes * 60_000);
        
        // Search for messages received since the lookback time
        const searchParams = { since };
        const seqs = await client.search(searchParams);
        
        if (seqs && typeof seqs !== "boolean" && seqs.length > 0) {
          // Fetch up to 'top' messages
          const limitedSeqs = seqs.slice(-top); 
          
          for await (let message of client.fetch(limitedSeqs, { source: true })) {
            if (!message.source) continue;
            
            const parsed = await simpleParser(message.source);
            
            const senderAddress = parsed.from?.value[0]?.address ?? "";
            const subject = parsed.subject ?? "";
            const body = parsed.text ?? "";
            
            messages.push({
              messageId: message.uid.toString(),
              subject,
              body: body.substring(0, 1000), // Preview body to avoid giant text
              sender: senderAddress,
              senderType: this.senderType(senderAddress, []), // IMAP doesn't have categories natively in the same way
              receivedAt: parsed.date?.toISOString() ?? new Date().toISOString(),
              conversationId: parsed.messageId,
              importance: "normal",
              categories: [],
            });
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
    
    // Sort descending by receivedAt, to match graph client behavior
    return messages.sort((a, b) => {
      const dateA = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
      const dateB = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
      return dateB - dateA;
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
