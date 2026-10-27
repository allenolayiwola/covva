import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { after, type NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiErrorCodes, CLIENT_HEADER, accessMessage, isClientBlocked, parseClientKind, workspaceAccess, type ApiKeyScope, type ApiResult, type ClientKind, type MembershipType } from "@im/core";
import type { Database, Enum } from "@im/db";
import { createClient as createCookieClient, createServiceClient } from "@/lib/supabase/server";
import { BusinessRuleError } from "@/server/requests";
import { log } from "@/server/log";
import { siteUrl } from "@/lib/site-url";

/**
 * API v1 plumbing: authentication (Supabase bearer token, cookie session or
 * partner API key), the `ApiResult` envelope, consistent error codes, zod
 * validation helpers, an in-memory rate limiter, request ids and structured logs.
 */

export type UserClient = Awaited<ReturnType<typeof createCookieClient>>;
export type ServiceClient = ReturnType<typeof createServiceClient>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export type ApiErrorCode = (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes];

const STATUS: Record<string, number> = {
  unauthorised: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  business_rule: 422,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  internal_error: 500,
};

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public details?: unknown,
    public status = STATUS[code] ?? 500,
  ) {
    super(message);
  }
}

export const unauthorised = (m = "Please sign in to continue.") => new ApiError("unauthorised", m);
export const forbidden = (m = "You don't have access to this.") => new ApiError("forbidden", m);
export const notFound = (m = "Not found.") => new ApiError("not_found", m);
export const invalid = (m: string, details?: unknown) => new ApiError("invalid_input", m, details);
export const rule = (m: string) => new ApiError("business_rule", m);
export const conflict = (m: string, details?: unknown) => new ApiError("conflict", m, details);

interface PgError { code?: string; message?: string; details?: string | null; hint?: string | null }

/** Map a PostgREST/Postgres error to an ApiError. P0001 = business rule raised by a trigger. */
export function dbError(err: PgError, fallback = "Something went wrong."): ApiError {
  switch (err.code) {
    case "P0001":
      return new ApiError("business_rule", err.message ?? fallback);
    case "23505":
      return new ApiError("conflict", "This has already been submitted.");
    case "23503":
    case "22P02":
    case "23502":
    case "23514":
      return new ApiError("invalid_input", "Some of the details provided are not valid.", { db: err.code });
    case "42501":
      return new ApiError("forbidden", "You don't have permission to do that.");
    case "PGRST116":
      return new ApiError("not_found", "Not found.");
    default:
      return new ApiError("internal_error", fallback, { db: err.code });
  }
}

/** Unwrap a Supabase result; throw ApiError on error, `not_found` when the row is missing. */
export function must<R extends { data: unknown; error: PgError | null }>(res: R, notFoundMessage = "Not found."): NonNullable<R["data"]> {
  if (res.error) throw dbError(res.error);
  if (res.data === null || res.data === undefined) throw notFound(notFoundMessage);
  return res.data as NonNullable<R["data"]>;
}

/** Throw on a write error (insert/update without needing the row back). */
export function check(res: { error: PgError | null }, fallback?: string) {
  if (res.error) throw dbError(res.error, fallback);
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof BusinessRuleError) {
    const code = (err.code in STATUS ? err.code : "business_rule") as ApiErrorCode;
    return new ApiError(code, err.message);
  }
  if (err instanceof z.ZodError) return invalid("Some of the details provided are not valid.", issues(err));
  if (err instanceof Error && /SUPABASE_SECRET_KEY is not configured/.test(err.message)) {
    return new ApiError("unavailable", "This service isn't configured on this environment.");
  }
  if (err && typeof err === "object" && "code" in err && typeof (err as PgError).code === "string" && "message" in err) {
    return dbError(err as PgError);
  }
  return new ApiError("internal_error", "Something went wrong. Please try again.");
}

function issues(err: z.ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------
export function ok<T>(data: T, init: ResponseInit = {}): Response {
  const body: ApiResult<T> = { ok: true, data };
  return Response.json(body, init);
}

export function fail(err: ApiError, headers: HeadersInit = {}): Response {
  const body: ApiResult<never> = { ok: false, error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } };
  return Response.json(body, { status: err.status, headers });
}

/** Parse and validate a JSON body. */
export async function parseJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw invalid("The request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid input.", issues(parsed.error));
  return parsed.data;
}

/** Parse and validate query-string parameters. */
export function parseQuery<S extends z.ZodType>(req: NextRequest, schema: S): z.infer<S> {
  const obj = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = schema.safeParse(obj);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid query.", issues(parsed.error));
  return parsed.data;
}

/** Validate a single path parameter as a UUID. */
export function uuidParam(value: string | undefined, name = "id"): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw notFound(`Unknown ${name}.`);
  return parsed.data;
}

/** Common list pagination: ?limit=&before= (ISO timestamp cursor on created_at). */
export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  before: z.string().datetime({ offset: true }).optional(),
});

// ---------------------------------------------------------------------------
// Rate limiting — in-memory token bucket per principal + IP.
// NOTE: this is per serverless instance. At scale use a durable limiter
// (Vercel WAF rate limiting, Upstash Redis or a Postgres-backed counter).
// ---------------------------------------------------------------------------
export interface RateLimit { capacity: number; refillPerSecond: number; name?: string }
export const RATE_LIMITS = {
  default: { capacity: 120, refillPerSecond: 2, name: "default" },
  write: { capacity: 30, refillPerSecond: 0.5, name: "write" },
  ai: { capacity: 15, refillPerSecond: 0.1, name: "ai" },
  partner: { capacity: 300, refillPerSecond: 5, name: "partner" },
} satisfies Record<string, RateLimit>;

const buckets = new Map<string, { tokens: number; updated: number }>();

export function takeToken(key: string, limit: RateLimit): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  if (buckets.size > 20_000) {
    for (const [k, b] of buckets) if (now - b.updated > 10 * 60_000) buckets.delete(k);
  }
  const b = buckets.get(key) ?? { tokens: limit.capacity, updated: now };
  b.tokens = Math.min(limit.capacity, b.tokens + ((now - b.updated) / 1000) * limit.refillPerSecond);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return { ok: false, retryAfter: Math.ceil((1 - b.tokens) / limit.refillPerSecond) };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return { ok: true, retryAfter: 0 };
}

/**
 * Which client is calling: `X-Covva-Client: mobile | web | partner-web` (default `web`).
 * Used for the Addendum 4 access rules (insurer users are web-only) and `profiles.last_seen_platform`.
 */
export function clientKind(req: Request): ClientKind {
  return parseClientKind(req.headers.get(CLIENT_HEADER));
}

export { siteUrl };

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------
export interface UserAuth {
  kind: "user";
  userId: string;
  email: string | null;
  phone: string | null;
  /** Supabase client acting as the user — RLS applies. */
  supabase: UserClient;
  /** Bearer access token when the caller is the mobile app; null for cookie sessions. */
  token: string | null;
  via: "bearer" | "cookie";
}

export interface ApiKeyAuth {
  kind: "apiKey";
  keyId: string;
  orgId: string;
  orgType: Extract<Enum<"org_type">, "broker" | "insurer" | "distributor">;
  orgName: string;
  scopes: string[];
  /**
   * Service client. RLS is bypassed for API-key calls, so every handler MUST scope
   * its queries to `orgId` in code.
   */
  svc: ServiceClient;
}

export type AuthMode = "user" | "apiKey" | "either" | "optional" | "none";
type AuthFor<M extends AuthMode> = M extends "user"
  ? UserAuth
  : M extends "apiKey"
    ? ApiKeyAuth
    : M extends "either"
      ? UserAuth | ApiKeyAuth
      : M extends "optional"
        ? UserAuth | null
        : null;

function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}

/** Supabase client that sends the user's access token, so PostgREST applies RLS as that user. */
export function createTokenClient(token: string): UserClient {
  const client = createPlainClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client as unknown as UserClient;
}

async function resolveUser(req: Request, required: boolean): Promise<UserAuth | null> {
  const token = bearerToken(req);
  if (token && token.startsWith("imk_")) throw unauthorised("API keys go in the x-api-key header.");
  const supabase = token ? createTokenClient(token) : await createCookieClient();
  const { data, error } = token ? await supabase.auth.getClaims(token) : await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub || claims.role !== "authenticated") {
    if (required || token) throw unauthorised(token ? "Your session has expired. Please sign in again." : undefined);
    return null;
  }
  return {
    kind: "user",
    userId: claims.sub,
    email: (claims.email as string | undefined) || null,
    phone: (claims.phone as string | undefined) || null,
    supabase,
    token,
    via: token ? "bearer" : "cookie",
  };
}

const API_KEY_RE = /^imk_([a-z0-9]{6,16})_([A-Za-z0-9_-]{20,128})$/;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Generate a new partner API key. Store `prefix` + `hash` in `api_keys`; show `key`
 * to the partner exactly once. Format: `imk_<prefix>_<secret>`; hash = sha256(full key).
 */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomBytes(6).toString("hex").slice(0, 10);
  const secret = randomBytes(32).toString("base64url");
  const key = `imk_${prefix}_${secret}`;
  return { key, prefix, hash: hashApiKey(key) };
}

function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

async function resolveApiKey(req: Request): Promise<ApiKeyAuth> {
  const raw = req.headers.get("x-api-key")?.trim();
  if (!raw) throw unauthorised("An API key is required (x-api-key header).");
  const m = API_KEY_RE.exec(raw);
  if (!m) throw unauthorised("Invalid API key.");
  // Service client: api_keys is not readable without an org-admin session. The key itself is the credential.
  const svc = createServiceClient();
  const { data: key } = await svc
    .from("api_keys")
    .select("id, org_id, key_hash, scopes, expires_at, revoked_at, last_used_at, org:organizations!api_keys_org_id_fkey(id, type, status, name)")
    .eq("prefix", m[1]!)
    .maybeSingle();
  if (!key || !safeEqualHex(hashApiKey(raw), key.key_hash)) throw unauthorised("Invalid API key.");
  if (key.revoked_at) throw unauthorised("This API key has been revoked.");
  if (key.expires_at && new Date(key.expires_at) < new Date()) throw unauthorised("This API key has expired.");
  const org = key.org as unknown as { id: string; type: Enum<"org_type">; status: Enum<"org_status">; name: string } | null;
  // Distributors (embedded partners) may only call /distribution/* — those routes require distribution:* scopes,
  // and partner routes check orgType, so a distributor key cannot reach broker/insurer data.
  if (!org || org.status !== "active" || (org.type !== "broker" && org.type !== "insurer" && org.type !== "distributor")) {
    throw forbidden("This organisation is not active on the platform.");
  }
  // Throttled last_used_at update (api_keys is audited, so avoid a write per call).
  if (!key.last_used_at || Date.now() - new Date(key.last_used_at).getTime() > 5 * 60_000) {
    after(async () => {
      await svc.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);
    });
  }
  return { kind: "apiKey", keyId: key.id, orgId: org.id, orgType: org.type, orgName: org.name, scopes: key.scopes ?? [], svc };
}

export function hasScopes(auth: ApiKeyAuth, scopes: ApiKeyScope[]) {
  return auth.scopes.includes("*") || scopes.every((s) => auth.scopes.includes(s));
}

// ---------------------------------------------------------------------------
// Platform access by user type (Addendum 4)
// ---------------------------------------------------------------------------
/** Active membership org types for a user (RLS: own memberships are always readable). */
export async function membershipTypes(auth: UserAuth): Promise<MembershipType[]> {
  const { data } = await auth.supabase.from("memberships").select("org:organizations!memberships_org_id_fkey(type)").eq("user_id", auth.userId).eq("active", true);
  const out: MembershipType[] = [];
  for (const m of data ?? []) {
    const t = (m.org as unknown as { type?: string } | null)?.type;
    if (t === "broker" || t === "insurer" || t === "platform") out.push(t);
  }
  return out;
}

/**
 * Rejects clients a user type may not use: insurer-only (and staff-only) accounts calling from the
 * mobile app get a 403 `forbidden` that points them to the web portal. Brokers use the same app as
 * customers; a user with any broker membership (or no memberships) always passes.
 */
export async function assertClientAllowed(auth: UserAuth, client: ClientKind): Promise<void> {
  if (client !== "mobile") return;
  const types = await membershipTypes(auth);
  if (!isClientBlocked(types, client)) return;
  const access = workspaceAccess(types.includes("insurer") ? "insurer" : "platform", client);
  throw new ApiError("forbidden", accessMessage(access, siteUrl()) ?? "This account can't use the mobile app.", { reason: access.reason, portalUrl: `${siteUrl()}/partner` });
}

// ---------------------------------------------------------------------------
// withApi
// ---------------------------------------------------------------------------
export interface ApiCtx<M extends AuthMode> {
  auth: AuthFor<M>;
  req: NextRequest;
  requestId: string;
  ip: string;
  /** `X-Covva-Client` header, default `web`. */
  client: ClientKind;
}

export interface WithApiOptions<M extends AuthMode> {
  auth: M;
  /** Required API-key scopes (ignored for user auth). */
  scopes?: ApiKeyScope[];
  rateLimit?: RateLimit;
  /**
   * Enforce the platform-access rules for the calling client (default true for user auth):
   * insurer-only accounts on `X-Covva-Client: mobile` get a 403 pointing to the web portal.
   */
  clientGate?: boolean;
}

/**
 * Wrap a route handler. The handler returns plain data (wrapped as `{ ok: true, data }`)
 * or a `Response` (passed through, e.g. streams). Thrown errors become `{ ok: false, error }`.
 */
export function withApi<M extends AuthMode, P = unknown>(
  handler: (ctx: ApiCtx<M>, route: P) => Promise<unknown>,
  opts: WithApiOptions<M>,
): (req: NextRequest, route: P) => Promise<Response> {
  return async (req, route) => {
    const started = Date.now();
    const requestId = req.headers.get("x-request-id")?.slice(0, 100) || randomUUID();
    const ip = clientIp(req);
    const client = clientKind(req);
    const headers: Record<string, string> = { "x-request-id": requestId, "cache-control": "private, no-store" };
    let principal = "anon";
    let status = 200;
    try {
      let auth: UserAuth | ApiKeyAuth | null = null;
      switch (opts.auth) {
        case "user":
          auth = await resolveUser(req, true);
          break;
        case "optional":
          auth = req.headers.get("x-api-key") ? null : await resolveUser(req, false);
          break;
        case "apiKey":
          auth = await resolveApiKey(req);
          break;
        case "either":
          auth = req.headers.get("x-api-key") ? await resolveApiKey(req) : await resolveUser(req, true);
          break;
        case "none":
          break;
      }
      if (auth?.kind === "apiKey" && opts.scopes?.length && !hasScopes(auth, opts.scopes)) {
        throw forbidden(`This API key is missing the required scope: ${opts.scopes.join(", ")}.`);
      }
      // Distributor keys reach only the /distribution/* endpoints (every scope required there is distribution:*).
      if (auth?.kind === "apiKey" && auth.orgType === "distributor" && !(opts.scopes?.length && opts.scopes.every((sc) => sc.startsWith("distribution:")))) {
        throw forbidden("Distribution partner keys can only call the /distribution endpoints.");
      }
      principal = auth ? (auth.kind === "user" ? `u:${auth.userId}` : `k:${auth.keyId}`) : "anon";
      if (auth?.kind === "user" && opts.clientGate !== false) await assertClientAllowed(auth, client);

      const limit = opts.rateLimit ?? (auth?.kind === "apiKey" ? RATE_LIMITS.partner : req.method === "GET" ? RATE_LIMITS.default : RATE_LIMITS.write);
      const rl = takeToken(`${limit.name ?? "rl"}|${principal}|${ip}`, limit);
      if (!rl.ok) {
        headers["retry-after"] = String(rl.retryAfter);
        throw new ApiError("rate_limited", "Too many requests. Please wait a moment and try again.");
      }

      const result = await handler({ auth: auth as AuthFor<M>, req, requestId, ip, client }, route);
      if (result instanceof Response) {
        status = result.status;
        for (const [k, v] of Object.entries(headers)) if (!result.headers.has(k)) result.headers.set(k, v);
        return result;
      }
      return ok(result, { headers });
    } catch (err) {
      unstable_rethrow(err);
      const apiErr = toApiError(err);
      status = apiErr.status;
      if (apiErr.status >= 500) log.error("api.error", { requestId, path: req.nextUrl.pathname, err });
      return fail(apiErr, headers);
    } finally {
      log.info("api.request", { requestId, method: req.method, path: req.nextUrl.pathname, status, ms: Date.now() - started, principal, client });
    }
  };
}

/** Throws unless the authenticated principal is a user. */
export function requireUserAuth(auth: UserAuth | ApiKeyAuth | null): UserAuth {
  if (!auth || auth.kind !== "user") throw unauthorised();
  return auth;
}
