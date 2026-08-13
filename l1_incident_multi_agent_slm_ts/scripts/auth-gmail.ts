import { google } from "googleapis";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { loadDotEnv, env } from "../src/utils/env.js";
import { exec } from "node:child_process";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const TOKEN_PATH = path.join(process.cwd(), "gmail-token.json");

async function run() {
  loadDotEnv();
  
  const clientId = env("GMAIL_CLIENT_ID");
  const clientSecret = env("GMAIL_CLIENT_SECRET");
  const redirectUri = env("GMAIL_REDIRECT_URI", "http://localhost:3000/oauth2callback");

  if (!clientId || !clientSecret) {
    console.error("❌ Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env file.");
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent" // Force to get refresh token
  });

  console.log("==========================================");
  console.log("Authorize this app by visiting this url:");
  console.log(authUrl);
  console.log("==========================================\n");
  
  // Try to open the URL automatically
  const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${startCmd} "${authUrl}"`, () => {});

  return new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (req.url && req.url.startsWith("/oauth2callback")) {
          const url = new URL(req.url, `http://localhost:3000`);
          const code = url.searchParams.get("code");
          
          if (code) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<h1>Authentication successful!</h1><p>You can close this window now.</p>");
            
            console.log("Fetching tokens...");
            const { tokens } = await oauth2Client.getToken(code);
            await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
            console.log(`✅ Token saved to ${TOKEN_PATH}`);
            
            server.close();
            resolve();
          } else {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end("<h1>Error</h1><p>No code found in URL.</p>");
            server.close();
            reject(new Error("No code found"));
          }
        }
      } catch (e) {
        console.error("Error during token exchange:", e);
        res.writeHead(500);
        res.end("Error occurred");
        server.close();
        reject(e);
      }
    });
    
    server.listen(3000, () => {
      console.log("Listening on http://localhost:3000/oauth2callback for the redirect...");
    });
  });
}

run().then(() => {
  console.log("You are ready to use the Gmail API watcher!");
  process.exit(0);
}).catch(err => {
  console.error("Failed:", err);
  process.exit(1);
});
