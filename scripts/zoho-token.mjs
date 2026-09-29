// Connects the Chats page's "Send to Zoho" button to Zoho CRM
// (zoho.in): swaps a one-time code from a Zoho "Self Client" for a refresh
// token and saves ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_REFRESH_TOKEN
// as Supabase secrets for the chat-admin function. Nothing is printed.
//
// 1. https://api-console.zoho.in > Add Client > Self Client > Create.
//    Copy its Client ID and Client Secret (Client Secret tab).
// 2. Generate Code tab, Scope (paste exactly):
//      ZohoCRM.modules.leads.CREATE,ZohoCRM.modules.leads.READ,ZohoCRM.modules.leads.UPDATE,ZohoCRM.settings.fields.READ,ZohoCRM.settings.tags.ALL
//    Time duration: 10 minutes, description "Ware chat leads" > Create.
//    Copy the code (it works once, within 10 minutes).
// 3. In PowerShell:
//      $env:ZOHO_CLIENT_ID="..."; $env:ZOHO_CLIENT_SECRET="..."; $env:ZOHO_CODE="..."
//      node scripts/zoho-token.mjs

import { spawnSync } from "node:child_process";

const ACCOUNTS = "https://accounts.zoho.in";
const { ZOHO_CLIENT_ID: id, ZOHO_CLIENT_SECRET: secret, ZOHO_CODE: code } =
  process.env;
if (!id || !secret || !code) {
  console.error(
    "Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_CODE first (see the top of this file).",
  );
  process.exit(1);
}

const res = await fetch(`${ACCOUNTS}/oauth/v2/token`, {
  method: "POST",
  body: new URLSearchParams({
    grant_type: "authorization_code",
    client_id: id,
    client_secret: secret,
    code,
  }),
});
const data = await res.json().catch(() => ({}));
if (!data.refresh_token) {
  // e.g. "invalid_code": the code expired or was already used.
  console.error(
    `Zoho didn't return a refresh token (${data.error ?? res.status}). ` +
      "Generate a new code and run this again within 10 minutes.",
  );
  process.exit(1);
}

// Straight into Supabase, never shown on screen.
const saved = spawnSync(
  "npx",
  [
    "supabase",
    "secrets",
    "set",
    `ZOHO_CLIENT_ID=${id}`,
    `ZOHO_CLIENT_SECRET=${secret}`,
    `ZOHO_REFRESH_TOKEN=${data.refresh_token}`,
  ],
  { stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" },
);
if (saved.status !== 0) {
  console.error("Couldn't save the secrets to Supabase (is the project linked?).");
  process.exit(1);
}
console.log(
  `Connected to Zoho CRM. Saved ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_REFRESH_TOKEN to Supabase (scopes: ${data.scope ?? "?"}).`,
);
