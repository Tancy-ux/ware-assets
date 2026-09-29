// Gets an offline Admin API token for the py-analytics Shopify app through
// the browser approval round-trip (authorization code grant), and saves it
// as the Supabase secret SHOPIFY_ADMIN_TOKEN for the chatbot's delivery
// lookup. The token is never printed.
//
// Why this and not client ID + secret: the app lives in a different Dev
// Dashboard organization from the store, so Shopify refuses the client
// credentials grant (shop_not_permitted). The approval round-trip works
// regardless.
//
// Usage (PowerShell), with the app's keys from Dev Dashboard > py-analytics
// > Settings:
//   $env:SHOPIFY_CLIENT_ID="..."; $env:SHOPIFY_CLIENT_SECRET="..."
//   node scripts/shopify-token.mjs
// Then approve in the browser window that opens.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawnSync, exec } from "node:child_process";

const SHOP = "ware-innovations-mumbai.myshopify.com";
const PORT = 3456; // must match the app's allowed redirect URL
const REDIRECT = `http://localhost:${PORT}/callback`;
// The app's full scope list, so approving doesn't change what the app
// already has on the store (only read_shipping is used by the chatbot).
const SCOPES = process.env.SHOPIFY_SCOPES ??
  "read_all_orders,read_analytics,read_orders,read_products,read_reports,read_shipping";

const clientId = process.env.SHOPIFY_CLIENT_ID;
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET first (see the top of this file).");
  process.exit(1);
}

const state = randomBytes(16).toString("hex");
const authorizeUrl = `https://${SHOP}/admin/oauth/authorize?${new URLSearchParams({
  client_id: clientId,
  scope: SCOPES,
  redirect_uri: REDIRECT,
  state,
})}`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }
  const finish = (status, message) => {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }).end(message);
    server.close();
  };
  if (url.searchParams.get("state") !== state) {
    finish(400, "State didn't match. Run the script again.");
    console.error("State didn't match; stopped.");
    return;
  }
  const code = url.searchParams.get("code");
  if (!code) {
    finish(400, "No code from Shopify. Run the script again.");
    return;
  }

  const tokenRes = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const data = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !data.access_token) {
    finish(500, "Shopify didn't return a token. See the terminal.");
    console.error("Token exchange failed:", tokenRes.status, JSON.stringify(data).slice(0, 300));
    return;
  }
  if (!String(data.scope ?? "").split(",").includes("read_shipping")) {
    console.warn(`Warning: the token's scopes are "${data.scope}", without read_shipping. Is the version with read_shipping released and approved?`);
  }

  // Straight into Supabase, never shown on screen.
  const saved = spawnSync(
    "npx",
    ["supabase", "secrets", "set", `SHOPIFY_ADMIN_TOKEN=${data.access_token}`],
    { shell: true, stdio: ["ignore", "ignore", "inherit"] },
  );
  if (saved.status === 0) {
    finish(200, "Done! The token is saved in Supabase. You can close this tab.");
    console.log(`Saved SHOPIFY_ADMIN_TOKEN to Supabase (scopes: ${data.scope}).`);
    if (data.expires_in) {
      console.log(`Note: this token expires in about ${Math.round(data.expires_in / 3600)} hours.`);
    }
  } else {
    finish(500, "Couldn't save the token to Supabase. See the terminal.");
    console.error("npx supabase secrets set failed. Are you logged in to the Supabase CLI?");
  }
});

server.listen(PORT, () => {
  console.log("Opening Shopify to approve the app. If nothing opens, visit:\n" + authorizeUrl);
  const opener = process.platform === "win32" ? `start "" "${authorizeUrl}"` : `open "${authorizeUrl}"`;
  exec(opener);
});
