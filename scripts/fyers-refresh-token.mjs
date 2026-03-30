/**
 * Fyers Access Token Auto-Refresh Script
 *
 * Implements the exact 6-step TOTP flow documented in fyers_connect.md:
 *   Step 1  POST /send_login_otp    → request_key
 *   Step 2  (local) TOTP generate   → 6-digit OTP
 *   Step 3  POST /verify_otp        → new request_key
 *   Step 4  POST /verify_pin        → intermediate bearer token
 *   Step 5  POST /token             → auth_code
 *   Step 6  POST /validate-authcode → final access_token (JWT)
 *
 * Reads from .env:
 *   FYERS_ID        — Fyers login username   (e.g. YS02387)
 *   PIN             — 4-digit Fyers PIN       (e.g. 1973)
 *   APP_ID          — Full app ID             (e.g. QVK3WHLJ1W-100)
 *   SECRET_KEY      — App secret key          (e.g. AYBZVM8XND)
 *   FYERS_TOTP_KEY  — TOTP base32 secret      (32-char key from Fyers 2FA)
 *   REDIRECT_URI    — Must match myapi.fyers.in setting
 *
 * Writes FYERS_ACCESS_TOKEN back to .env on success.
 *
 * Usage:
 *   node scripts/fyers-refresh-token.mjs             # refresh + update .env
 *   node scripts/fyers-refresh-token.mjs --dry-run   # test without writing
 *
 * Add to crontab for daily auto-refresh at 8:55 AM (before market open):
 *   55 8 * * 1-5 cd /Users/sandeep/investment/india-s-best-option-hub && node scripts/fyers-refresh-token.mjs >> logs/fyers-refresh.log 2>&1
 */

import { createHmac, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");
const ENV_PATH  = resolve(ROOT, ".env");
const DRY_RUN   = process.argv.includes("--dry-run");

// ── Load .env ──────────────────────────────────────────────────────────────

function loadEnv(path) {
  const env = {};
  try {
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();

      // Handle quoted values: extract content between first and last matching quote,
      // ignoring inline comments after the closing quote
      if (val.startsWith('"')) {
        const closeQuote = val.indexOf('"', 1);
        val = closeQuote !== -1 ? val.slice(1, closeQuote) : val.slice(1);
      } else if (val.startsWith("'")) {
        const closeQuote = val.indexOf("'", 1);
        val = closeQuote !== -1 ? val.slice(1, closeQuote) : val.slice(1);
      } else {
        // Unquoted: strip inline comment (space + # is a comment separator)
        const commentIdx = val.search(/\s+#/);
        if (commentIdx !== -1) val = val.slice(0, commentIdx).trim();
      }

      env[key] = val;
    }
  } catch { /* .env may not exist */ }
  return env;
}

// ── Update a single key in .env (preserves all other lines) ───────────────

function updateEnvKey(path, key, value) {
  let content = "";
  try { content = readFileSync(path, "utf-8"); } catch { content = ""; }

  const lines = content.split("\n");
  const idx = lines.findIndex(l => l.trim().startsWith(`${key}=`));
  if (idx !== -1) {
    lines[idx] = `${key}=${value}`;
  } else {
    // Append before first blank line after a Fyers comment, or at end
    const fyersIdx = lines.findIndex(l => /fyers|FYERS/i.test(l) && l.startsWith("#"));
    fyersIdx !== -1 ? lines.splice(fyersIdx + 1, 0, `${key}=${value}`) : lines.push(`${key}=${value}`);
  }
  writeFileSync(path, lines.join("\n"), "utf-8");
}

// ── TOTP Generator — RFC 6238, no external deps ───────────────────────────

function generateTOTP(base32Key) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const key = base32Key.toUpperCase().replace(/[\s=]/g, "");
  let bits = "";
  for (const ch of key) {
    const v = alphabet.indexOf(ch);
    if (v === -1) throw new Error(`Invalid base32 character: '${ch}'`);
    bits += v.toString(2).padStart(5, "0");
  }
  const keyBytes = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
      parseInt(bits.slice(i * 8, i * 8 + 8), 2)
    )
  );

  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hash = createHmac("sha1", keyBytes).update(counterBuf).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    (((hash[offset] & 0x7f) << 24) |
     ((hash[offset + 1] & 0xff) << 16) |
     ((hash[offset + 2] & 0xff) << 8) |
      (hash[offset + 3] & 0xff)) % 1_000_000;

  return code.toString().padStart(6, "0");
}

// ── HTTP helper ────────────────────────────────────────────────────────────

async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(`Non-JSON from ${url} (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  return { status: res.status, json };
}

// ── Fyers API endpoints (from fyers_connect.md) ────────────────────────────

const VAGATOR = "https://api-t2.fyers.in/vagator/v2";
const API_V3  = "https://api-t1.fyers.in/api/v3";

// ── Main 6-step flow ───────────────────────────────────────────────────────

async function refreshFyersToken() {
  const env = loadEnv(ENV_PATH);

  // Map .env variables — supports both fyers_connect.md naming and legacy naming
  // fyers_connect.md uses: CLIENT_ID, PIN, APP_ID (base), APP_TYPE, APP_SECRET, TOTP_SECRET_KEY, REDIRECT_URI
  const clientId    = env.CLIENT_ID    || env.FYERS_ID;
  const pin         = env.PIN;
  const totpKey     = env.TOTP_SECRET_KEY || env.FYERS_TOTP_KEY;
  const redirectUri = env.REDIRECT_URI;
  const secretKey   = env.APP_SECRET   || env.SECRET_KEY;

  // APP_ID in .env can be:
  //   a) base only:  "GLIZL180NU"  (with APP_TYPE="200" separate) — fyers_connect.md style
  //   b) full:       "ZYERBVP3YA-100"                             — FYERS_APP_ID style
  // We prefer APP_ID + APP_TYPE (more explicit) over FYERS_APP_ID
  let appIdBase, appType;
  if (env.APP_ID && env.APP_TYPE) {
    // fyers_connect.md style — base and type are separate
    appIdBase = env.APP_ID;
    appType   = env.APP_TYPE;
  } else {
    // FYERS_APP_ID style — full string like "ZYERBVP3YA-100"
    const fullId = env.FYERS_APP_ID || env.APP_ID || "";
    const dash = fullId.lastIndexOf("-");
    appIdBase  = dash !== -1 ? fullId.slice(0, dash) : fullId;
    appType    = dash !== -1 ? fullId.slice(dash + 1) : "100";
  }

  // Validate
  const missing = Object.entries({ "CLIENT_ID/FYERS_ID": clientId, PIN: pin, "TOTP_SECRET_KEY/FYERS_TOTP_KEY": totpKey, "APP_ID": appIdBase, "APP_TYPE": appType, "APP_SECRET/SECRET_KEY": secretKey, REDIRECT_URI: redirectUri })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) throw new Error(`Missing .env keys: ${missing.join(", ")}`);

  console.log(`[${new Date().toISOString()}] Fyers token refresh starting...`);
  console.log(`  Client: ${clientId}  |  App: ${appIdBase}-${appType}`);
  if (DRY_RUN) console.log("  *** DRY RUN — .env will NOT be written ***");

  // ── Step 1: send_login_otp → request_key ──────────────────────────────
  console.log("\n[1/6] send_login_otp...");
  const r1 = await post(`${VAGATOR}/send_login_otp`, { fy_id: clientId, app_id: "2" });
  if (r1.status !== 200) throw new Error(`Step 1 failed (HTTP ${r1.status}): ${JSON.stringify(r1.json)}`);
  const requestKey1 = r1.json.request_key;
  if (!requestKey1) throw new Error(`Step 1: no request_key in response: ${JSON.stringify(r1.json)}`);
  console.log("      OK — request_key received.");

  // ── Step 2: generate TOTP ──────────────────────────────────────────────
  console.log("[2/6] Generating TOTP...");
  const totp = generateTOTP(totpKey);
  console.log(`      OK — OTP: ${totp.slice(0, 2)}****`);

  // ── Step 3: verify_otp → new request_key ──────────────────────────────
  console.log("[3/6] verify_otp...");
  const r3 = await post(`${VAGATOR}/verify_otp`, { request_key: requestKey1, otp: totp });
  if (r3.status !== 200) throw new Error(`Step 3 failed (HTTP ${r3.status}): ${JSON.stringify(r3.json)}`);
  const requestKey2 = r3.json.request_key;
  if (!requestKey2) throw new Error(`Step 3: no request_key in response: ${JSON.stringify(r3.json)}`);
  console.log("      OK — TOTP verified.");

  // ── Step 4: verify_pin → intermediate bearer token ────────────────────
  console.log("[4/6] verify_pin...");
  const r4 = await post(`${VAGATOR}/verify_pin`, {
    request_key: requestKey2,
    identity_type: "pin",
    identifier: pin,
  });
  if (r4.status !== 200) throw new Error(`Step 4 failed (HTTP ${r4.status}): ${JSON.stringify(r4.json)}`);
  const bearerToken = r4.json?.data?.access_token;
  if (!bearerToken) throw new Error(`Step 4: no data.access_token in response: ${JSON.stringify(r4.json)}`);
  console.log("      OK — intermediate bearer token received.");

  // ── Step 5: /token with bearer auth → auth_code ───────────────────────
  console.log("[5/6] Getting auth_code via /token...");
  const r5 = await post(`${API_V3}/token`, {
    fyers_id: clientId,
    app_id: appIdBase,
    redirect_uri: redirectUri,
    appType: appType,
    code_challenge: "",
    state: "state",
    scope: "",
    nonce: "",
    response_type: "code",
    create_cookie: true,
  }, { Authorization: `Bearer ${bearerToken}` });

  let authCode;
  // New format: HTTP 200 with s:"ok" and data.auth
  if (r5.status === 200 && r5.json?.s === "ok") {
    authCode = r5.json?.data?.auth;
  }
  // Old format: HTTP 308 with Url containing auth_code query param
  if (!authCode && r5.status === 308 && r5.json?.Url) {
    const urlObj = new URL(r5.json.Url);
    authCode = urlObj.searchParams.get("auth_code");
  }
  if (!authCode) throw new Error(`Step 5: could not extract auth_code. Response (HTTP ${r5.status}): ${JSON.stringify(r5.json)}`);
  console.log("      OK — auth_code received.");

  // ── Step 6: validate-authcode → final access_token ────────────────────
  console.log("[6/6] Exchanging auth_code for access_token...");
  // appIdHash = sha256("{appIdBase}-{appType}:{secretKey}")
  const hashInput = `${appIdBase}-${appType}:${secretKey}`;
  const appIdHash = createHash("sha256").update(hashInput).digest("hex");

  const r6 = await post(`${API_V3}/validate-authcode`, {
    grant_type: "authorization_code",
    appIdHash,
    code: authCode,
  });
  if (r6.status !== 200) throw new Error(`Step 6 failed (HTTP ${r6.status}): ${JSON.stringify(r6.json)}`);
  const accessToken = r6.json?.access_token;
  if (!accessToken) throw new Error(`Step 6: no access_token in response: ${JSON.stringify(r6.json)}`);
  console.log(`      OK — access_token received (${accessToken.slice(0, 8)}...)`);

  // ── Write to .env ──────────────────────────────────────────────────────
  const fullAppIdForProxy = `${appIdBase}-${appType}`;  // e.g. GLIZL180NU-200
  if (DRY_RUN) {
    console.log("\n✅ DRY RUN complete — .env NOT written");
    console.log(`   Would set FYERS_ACCESS_TOKEN = ${accessToken.slice(0, 12)}...`);
    console.log(`   Would set FYERS_APP_ID       = ${fullAppIdForProxy}`);
  } else {
    updateEnvKey(ENV_PATH, "FYERS_ACCESS_TOKEN", accessToken);
    updateEnvKey(ENV_PATH, "FYERS_APP_ID", fullAppIdForProxy);
    console.log("\n✅ .env updated successfully.");
    console.log(`   FYERS_ACCESS_TOKEN = ${accessToken.slice(0, 12)}...`);
    console.log(`   FYERS_APP_ID       = ${fullAppIdForProxy}`);
    console.log("   Expires: end of today's trading session (Fyers daily limit)");
    console.log("\n   The proxy auto-reloads the token within 30 min.");
    console.log("   For immediate effect: restart proxy with  npm run proxy");
  }

  // Append to log file (non-fatal if it fails)
  try {
    mkdirSync(resolve(ROOT, "logs"), { recursive: true });
    writeFileSync(resolve(ROOT, "logs/fyers-refresh.log"),
      `${new Date().toISOString()} | ${DRY_RUN ? "DRY-RUN" : "OK"} | ${accessToken.slice(0, 8)}...\n`,
      { flag: "a" });
  } catch { /* log failure is non-fatal */ }

  return accessToken;
}

// ── Run ────────────────────────────────────────────────────────────────────

refreshFyersToken()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n❌ Token refresh failed: ${err.message}`);
    process.exit(1);
  });
