import { loadDotEnv } from "../src/utils/env.js";
import { ImapMailClient } from "../src/clients/imap-mail-client.js";

async function testConnection() {
  loadDotEnv();
  console.log("Attempting to connect to IMAP...");
  try {
    const client = new ImapMailClient();
    const messages = await client.fetchRecentMessages();
    console.log(`SUCCESS! Connected and found ${messages.length} recent messages.`);
    process.exit(0);
  } catch (err) {
    console.error("CONNECTION FAILED:", err);
    process.exit(1);
  }
}

testConnection();
