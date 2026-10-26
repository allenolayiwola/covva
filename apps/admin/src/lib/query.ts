import "server-only";
import { createClient } from "@/lib/supabase/server";

export type SearchParams = Record<string, string | string[] | undefined>;
export type Supabase = Awaited<ReturnType<typeof createClient>>;

export const PAGE_SIZE = 25;

export function sp(params: SearchParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() !== "" ? s.trim() : undefined;
}

export function pageOf(params: SearchParams): { page: number; from: number; to: number } {
  const page = Math.max(1, Number.parseInt(sp(params, "page") ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  return { page, from, to: from + PAGE_SIZE - 1 };
}

/** Escape a user search term for use inside a PostgREST `or=(...ilike...)` filter. */
export function ilikeTerm(q: string): string {
  return `%${q.replace(/[%_,()*\\]/g, " ").trim()}%`;
}

export const isUuid = (s: string | undefined): s is string => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export type OrgLite = { id: string; name: string; type: string; status: string; slug: string };
export type CategoryLite = { id: string; name: string; slug: string; segment: string; availability: string };

/** Organisations are a small table; load once per request and map by id (avoids ambiguous FK embeds). */
export async function orgMap(supabase: Supabase): Promise<Map<string, OrgLite>> {
  const { data } = await supabase.from("organizations").select("id, name, type, status, slug").order("name").limit(2000);
  return new Map((data ?? []).map((o) => [o.id, o]));
}

export async function categoryMap(supabase: Supabase): Promise<Map<string, CategoryLite>> {
  const { data } = await supabase.from("product_categories").select("id, name, slug, segment, availability").order("sort_order");
  return new Map((data ?? []).map((c) => [c.id, c]));
}

export async function profileMap(supabase: Supabase, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map<string, { id: string; full_name: string | null; email: string | null; phone: string | null }>();
  const { data } = await supabase.from("profiles").select("id, full_name, email, phone").in("id", unique.slice(0, 500));
  return new Map((data ?? []).map((p) => [p.id, p]));
}

export function personName(p: { full_name: string | null; email: string | null } | undefined | null, fallback = "Unknown"): string {
  return p?.full_name || p?.email || fallback;
}

/** Build a URL keeping current filters but overriding some keys. */
export function withParams(base: string, params: SearchParams, overrides: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s && k !== "page") u.set(k, s);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === "") u.delete(k);
    else u.set(k, v);
  }
  const q = u.toString();
  return q ? `${base}?${q}` : base;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

/** Current time in ms. Admin pages are request-time (see resolveStaff → connection()). */
export function nowMs(): number {
  return Date.now();
}
