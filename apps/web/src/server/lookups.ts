import "server-only";
import { normaliseRegistration, type VehicleData } from "@im/core";
import type { Json } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/server/log";

/**
 * Vehicle registration lookup and identity (Ghana Card) verification providers.
 *
 * Both are swappable behind a small interface. Nothing here is required for a quote:
 * when a provider is not configured (`DVLA_API_URL` / `NIA_API_URL` unset) it returns
 * null and the form simply asks for the details, or the KYC record goes to manual review.
 *
 *   VEHICLE_LOOKUP_PROVIDER = cache (default) | dvla | manual
 *   IDENTITY_PROVIDER       = manual (default) | nia
 */
export interface VehicleLookupResult {
  registration: string;
  source: "dvla" | "manual" | "cache";
  data: VehicleData;
  fetchedAt: string;
}

export interface VehicleLookupProvider {
  readonly name: "cache" | "dvla" | "manual";
  lookup(registration: string): Promise<VehicleLookupResult | null>;
}

type Svc = ReturnType<typeof createServiceClient>;

const VEHICLE_KEYS: (keyof VehicleData)[] = ["make", "model", "year", "body", "colour", "chassis_last4", "engine_cc", "seats", "use"];

/** Keep only the vehicle fields we store — never the keeper's name, address or ID numbers. */
export function sanitiseVehicleData(raw: Record<string, unknown> | null | undefined): VehicleData {
  const out: VehicleData = {};
  if (!raw) return out;
  for (const k of VEHICLE_KEYS) {
    const v = raw[k];
    if (v === undefined || v === null || v === "") continue;
    if (k === "year" || k === "engine_cc" || k === "seats") {
      const n = Number(v);
      if (Number.isFinite(n)) (out as Record<string, unknown>)[k] = Math.round(n);
    } else if (k === "use") {
      out.use = /commercial|taxi|hire|ride|bus|truck/i.test(String(v)) ? "commercial" : "private";
    } else {
      (out as Record<string, unknown>)[k] = String(v).slice(0, 80);
    }
  }
  return out;
}

/** Manual: no external source — the form shows the fields. */
export const manualVehicleProvider: VehicleLookupProvider = {
  name: "manual",
  async lookup() {
    return null;
  },
};

/** Cache: the `vehicle_lookups` table (written by previous lookups or by ops). */
export function cacheVehicleProvider(svc: Svc): VehicleLookupProvider {
  return {
    name: "cache",
    async lookup(registration) {
      const reg = normaliseRegistration(registration);
      if (!reg) return null;
      const { data } = await svc.from("vehicle_lookups").select("registration, source, data, fetched_at, expires_at").eq("registration", reg).maybeSingle();
      if (!data || new Date(data.expires_at) < new Date()) return null;
      return { registration: data.registration, source: "cache", data: sanitiseVehicleData(data.data as Record<string, unknown>), fetchedAt: data.fetched_at };
    },
  };
}

/**
 * DVLA (or a licensed data partner) stub. Expects `GET {DVLA_API_URL}/vehicles/{registration}` with a
 * bearer key, returning JSON with make/model/year… fields. Returns null when unset or on any error,
 * so quoting never depends on it.
 */
export const dvlaVehicleProvider: VehicleLookupProvider = {
  name: "dvla",
  async lookup(registration) {
    const base = process.env.DVLA_API_URL?.replace(/\/$/, "");
    const key = process.env.DVLA_API_KEY;
    if (!base || !key) return null;
    const reg = normaliseRegistration(registration);
    if (!reg) return null;
    try {
      const res = await fetch(`${base}/vehicles/${encodeURIComponent(reg)}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        log.warn("dvla.lookup_failed", { status: res.status });
        return null;
      }
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const data = sanitiseVehicleData((json?.data as Record<string, unknown>) ?? json);
      if (!data.make && !data.model) return null;
      return { registration: reg, source: "dvla", data, fetchedAt: new Date().toISOString() };
    } catch (err) {
      log.warn("dvla.lookup_error", { err });
      return null;
    }
  },
};

export function vehicleLookupProvider(svc: Svc): VehicleLookupProvider {
  const name = (process.env.VEHICLE_LOOKUP_PROVIDER ?? "cache").toLowerCase();
  if (name === "manual") return manualVehicleProvider;
  if (name === "dvla") return dvlaVehicleProvider;
  return cacheVehicleProvider(svc);
}

/**
 * Look a registration up: cache first, then the configured external provider; external hits
 * are cached for 90 days (vehicle facts only). Null means "ask the customer".
 */
export async function lookupVehicle(registration: string, svc: Svc = createServiceClient()): Promise<VehicleLookupResult | null> {
  const reg = normaliseRegistration(registration);
  if (!reg || reg.length < 4) return null;
  const cached = await cacheVehicleProvider(svc).lookup(reg);
  if (cached) return cached;
  const provider = vehicleLookupProvider(svc);
  if (provider.name === "cache" || provider.name === "manual") {
    // Cache miss and no live source configured: try DVLA anyway if its env is set (opt-in by env).
    const live = await dvlaVehicleProvider.lookup(reg);
    if (!live) return null;
    await cacheLookup(svc, live);
    return live;
  }
  const live = await provider.lookup(reg);
  if (live) await cacheLookup(svc, live);
  return live;
}

async function cacheLookup(svc: Svc, r: VehicleLookupResult) {
  const { error } = await svc
    .from("vehicle_lookups")
    .upsert({ registration: r.registration, source: r.source === "cache" ? "manual" : r.source, data: r.data as Json, fetched_at: r.fetchedAt, expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString() }, { onConflict: "registration" });
  if (error) log.warn("vehicle_lookups.cache_failed", { err: error });
}

// ---------------------------------------------------------------------------
// Identity (Ghana Card)
// ---------------------------------------------------------------------------
export interface IdentityCheckInput {
  ghanaCardNumber: string;
  fullName?: string | null;
  dateOfBirth?: string | null;
}

export interface IdentityCheckResult {
  provider: "manual" | "nia";
  /** `verified` / `rejected` come from the provider; `pending` means manual review. */
  status: "verified" | "rejected" | "pending";
  reference?: string | null;
  result?: Record<string, unknown> | null;
  checkedAt?: string | null;
}

export interface IdentityProvider {
  readonly name: "manual" | "nia";
  verify(input: IdentityCheckInput): Promise<IdentityCheckResult>;
}

/** Manual: every submission goes to the admin KYC review queue. */
export const manualIdentityProvider: IdentityProvider = {
  name: "manual",
  async verify() {
    return { provider: "manual", status: "pending", reference: null, result: null, checkedAt: null };
  },
};

/**
 * NIA (National Identification Authority) verification stub — `POST {NIA_API_URL}/verify` with the
 * card number and, where given, name/date of birth. Only the match outcome is stored (`result`),
 * never the full identity record. Falls back to manual review when unset or on error.
 */
export const niaIdentityProvider: IdentityProvider = {
  name: "nia",
  async verify(input) {
    const base = process.env.NIA_API_URL?.replace(/\/$/, "");
    const key = process.env.NIA_API_KEY;
    if (!base || !key) return manualIdentityProvider.verify(input);
    try {
      const res = await fetch(`${base}/verify`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ pin: input.ghanaCardNumber, full_name: input.fullName ?? undefined, date_of_birth: input.dateOfBirth ?? undefined }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => ({}))) as { reference?: string; match?: boolean; verified?: boolean; status?: string; score?: number; reasons?: string[] };
      if (!res.ok) {
        log.warn("nia.verify_failed", { status: res.status });
        return manualIdentityProvider.verify(input);
      }
      const ok = json.verified === true || json.match === true || json.status === "verified";
      const rejected = json.verified === false || json.match === false || json.status === "rejected";
      return {
        provider: "nia",
        status: ok ? "verified" : rejected ? "rejected" : "pending",
        reference: json.reference ?? null,
        result: { match: ok, score: json.score ?? null, reasons: json.reasons ?? [] },
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      log.warn("nia.verify_error", { err });
      return manualIdentityProvider.verify(input);
    }
  },
};

export function identityProvider(): IdentityProvider {
  return (process.env.IDENTITY_PROVIDER ?? "manual").toLowerCase() === "nia" ? niaIdentityProvider : manualIdentityProvider;
}

/**
 * Run the configured identity check for a pending `kyc_verifications` row and apply the outcome.
 * Provider says verified → profile `kyc_status = verified`; rejected → `rejected`; otherwise the
 * row stays `pending` for manual review. Uses the service client (system write).
 */
export async function runIdentityCheck(svc: Svc, verificationId: string): Promise<IdentityCheckResult> {
  const { data: row } = await svc.from("kyc_verifications").select("id, user_id, id_number, status").eq("id", verificationId).maybeSingle();
  if (!row || row.status !== "pending" || !row.id_number) return { provider: "manual", status: "pending" };
  const { data: profile } = await svc.from("profiles").select("full_name, date_of_birth").eq("id", row.user_id).maybeSingle();
  const r = await identityProvider().verify({ ghanaCardNumber: row.id_number, fullName: profile?.full_name, dateOfBirth: profile?.date_of_birth });
  await svc
    .from("kyc_verifications")
    .update({
      provider: r.provider,
      provider_reference: r.reference ?? null,
      result: (r.result ?? null) as Json,
      checked_at: r.checkedAt ?? null,
      status: r.status === "pending" ? "pending" : r.status,
      reviewed_at: r.status === "pending" ? null : new Date().toISOString(),
    })
    .eq("id", row.id);
  if (r.status === "verified") {
    await svc.from("profiles").update({ kyc_status: "verified", kyc_verified_at: new Date().toISOString() }).eq("id", row.user_id);
  } else if (r.status === "rejected") {
    await svc.from("profiles").update({ kyc_status: "rejected" }).eq("id", row.user_id);
  }
  return r;
}
