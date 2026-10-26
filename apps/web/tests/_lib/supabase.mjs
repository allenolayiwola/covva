// Dependency-free helpers for talking to Supabase Auth + PostgREST from Node's test runner.
// Reads env first, then apps/web/.env.local (public values only), then the known demo defaults.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function readEnvLocal() {
  const out = {};
  for (const file of [resolve(here, "../../.env.local"), resolve(here, "../../.env")]) {
    try {
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (!m) continue;
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        out[m[1]] ??= v.replace(/\s+#.*$/, "");
      }
    } catch {
      /* file is optional */
    }
  }
  return out;
}

const local = readEnvLocal();
const pick = (...keys) => keys.map((k) => process.env[k] ?? local[k]).find((v) => v && v.trim() !== "");

export const SUPABASE_URL = (pick("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL") ?? "https://krmnyqaweawkpygjmdry.supabase.co").replace(/\/$/, "");
export const PUBLISHABLE_KEY = pick("SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? "";
export const SECRET_KEY = pick("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY") ?? "";

export const PASSWORD = pick("E2E_PASSWORD") ?? "Demo-UtEjEEuvXJWZJm";
export const ACCOUNTS = {
  customer: pick("E2E_CUSTOMER_EMAIL") ?? "ama@demo-customer.example",
  brokerSupervisor: pick("E2E_BROKER_EMAIL") ?? "kofi@demo-broker.example",
  adviser: pick("E2E_ADVISER_EMAIL") ?? "abena@demo-broker.example",
  underwriter: pick("E2E_UNDERWRITER_EMAIL") ?? "underwriter@coastline.example",
  claims: pick("E2E_CLAIMS_EMAIL") ?? "claims@coastline.example",
  admin: pick("E2E_ADMIN_EMAIL") ?? "admin@demo.insurance-marketplace.example",
};

/** Prefix for every row the automated suites create. The purge script deletes rows tagged `E2E-%`. */
export const TAG = "E2E-DBRULES";

if (!PUBLISHABLE_KEY) {
  throw new Error("SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in apps/web/.env.local) is required");
}

async function parse(res) {
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: res.status, body, code: body && typeof body === "object" && !Array.isArray(body) ? body.code : undefined, message: body && typeof body === "object" && !Array.isArray(body) ? body.message : undefined };
}

/** Password sign-in through the Auth REST API. Returns { token, userId, email }. */
export async function signIn(email, password = PASSWORD) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const r = await parse(res);
  if (!res.ok || !r.body?.access_token) throw new Error(`Sign-in failed for ${email}: ${res.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.access_token, userId: r.body.user.id, email };
}

/**
 * A PostgREST client bound to one identity.
 *   anon()          → publishable key only
 *   asUser(session) → bearer = user access token
 *   service()       → secret key (bypasses RLS; trusted server role)
 */
function client(apikey, bearer) {
  const call = async (method, path, body, prefer) => {
    const headers = { apikey, authorization: `Bearer ${bearer}`, "content-type": "application/json" };
    if (prefer) headers.prefer = prefer;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return parse(res);
  };
  return {
    get: (path) => call("GET", path),
    insert: (table, row, { select = "*" } = {}) => call("POST", `${table}?select=${encodeURIComponent(select)}`, row, "return=representation"),
    update: (path, patch) => call("PATCH", path, patch, "return=representation"),
    delete: (path) => call("DELETE", path, undefined, "return=representation"),
    rpc: (fn, args) => call("POST", `rpc/${fn}`, args ?? {}),
  };
}

export const anon = () => client(PUBLISHABLE_KEY, PUBLISHABLE_KEY);
export const asUser = (session) => client(PUBLISHABLE_KEY, session.token);
export const service = () => {
  if (!SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY is not set");
  return client(SECRET_KEY, SECRET_KEY);
};
export const hasServiceKey = () => SECRET_KEY !== "";

export const uuid = () => globalThis.crypto.randomUUID();
export const stamp = () => new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
