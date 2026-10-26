"use server";
import { z } from "zod";
import { routeRequest, type RoutingCandidate } from "@im/core";
import type { SimulationResult } from "./types";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { resolveStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DAY } from "@/lib/query";

const list = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean)));

const Rule = z.object({
  brokerOrgId: z.string().uuid({ error: "Choose a broker" }),
  categoryId: z.string().uuid({ error: "Choose a category" }),
  priority: z.coerce.number().int().min(0).max(10000),
  is_secondary: z.string().optional(),
  regions: list,
  segments: list,
  daily_capacity: z.string().optional().transform((v) => (v && v.trim() !== "" ? Number(v) : null)).refine((v) => v === null || (Number.isInteger(v) && v >= 0), "Capacity must be a whole number"),
  active: z.string().optional(),
});

export async function saveRoutingRule(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = Rule.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const d = parsed.data;
  const { data: broker } = await auth.supabase.from("organizations").select("type").eq("id", d.brokerOrgId).single();
  if (broker?.type !== "broker") return fail("Routing rules apply to broker organisations only.");
  const { error } = await auth.supabase.from("broker_routing_rules").upsert(
    {
      broker_org_id: d.brokerOrgId,
      category_id: d.categoryId,
      priority: d.priority,
      is_secondary: d.is_secondary === "on",
      regions: d.regions,
      segments: d.segments,
      daily_capacity: d.daily_capacity,
      active: d.active === "on",
    },
    { onConflict: "broker_org_id,category_id" },
  );
  if (error) return fail(dbMessage(error));
  return done("Routing rule saved.");
}

const Toggle = z.object({ ruleId: z.string().uuid(), value: z.enum(["true", "false"]) });

export async function toggleRoutingRule(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = Toggle.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.from("broker_routing_rules").update({ active: parsed.data.value === "true" }).eq("id", parsed.data.ruleId);
  if (error) return fail(dbMessage(error));
  return done(parsed.data.value === "true" ? "Rule activated." : "Rule paused.");
}

const Sim = z.object({
  categoryId: z.string().uuid({ error: "Choose a category" }),
  region: z.string().optional().transform((v) => v || undefined),
  segment: z.string().optional().transform((v) => v || undefined),
});


/**
 * Read-only: runs @im/core routeRequest against live routing rules, licences,
 * appointments, today's load and 30-day SLA performance. Nothing is written.
 */
export async function simulateRouting(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await resolveStaff();
  if (r.status !== "ok") return fail("Not authorised");
  const parsed = Sim.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { categoryId, region, segment } = parsed.data;
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const startToday = `${today}T00:00:00Z`;
  const since30 = new Date(Date.now() - 30 * DAY).toISOString();

  const [{ data: rules }, { data: appts }, { data: todays }, { data: recent }] = await Promise.all([
    supabase.from("broker_routing_rules").select("*").eq("category_id", categoryId).eq("active", true),
    supabase.from("insurer_broker_appointments").select("broker_org_id, insurer_org_id, category_id, active, ends_on").eq("active", true).or(`category_id.eq.${categoryId},category_id.is.null`),
    supabase.from("requests").select("broker_org_id").gte("created_at", startToday).not("broker_org_id", "is", null).limit(10000),
    supabase.from("requests").select("broker_org_id, sla_breached_at, due_at, completed_at").gte("created_at", since30).not("broker_org_id", "is", null).limit(20000),
  ]);
  const brokerIds = [...new Set((rules ?? []).map((x) => x.broker_org_id))];
  const insurerIds = [...new Set((appts ?? []).map((a) => a.insurer_org_id))];
  const { data: orgs } = await supabase
    .from("organizations")
    .select("id, name, status, licence_verified_at, nic_licence_expires_on")
    .in("id", [...brokerIds, ...insurerIds].length ? [...brokerIds, ...insurerIds] : ["00000000-0000-0000-0000-000000000000"]);
  const orgById = new Map((orgs ?? []).map((o) => [o.id, o]));

  const candidates: RoutingCandidate[] = [];
  for (const rule of rules ?? []) {
    const b = orgById.get(rule.broker_org_id);
    if (!b || b.status !== "active") continue;
    const access = new Set(
      (appts ?? [])
        .filter((a) => a.broker_org_id === rule.broker_org_id && (!a.ends_on || a.ends_on >= today) && orgById.get(a.insurer_org_id)?.status === "active")
        .map((a) => a.insurer_org_id),
    ).size;
    const mine = (recent ?? []).filter((x) => x.broker_org_id === rule.broker_org_id);
    const breached = mine.filter((x) => x.sla_breached_at || (x.due_at && !x.completed_at && x.due_at < new Date().toISOString())).length;
    candidates.push({
      brokerOrgId: rule.broker_org_id,
      brokerName: b.name,
      priority: rule.priority,
      isSecondary: rule.is_secondary,
      regions: rule.regions,
      segments: rule.segments,
      dailyCapacity: rule.daily_capacity,
      openToday: (todays ?? []).filter((x) => x.broker_org_id === rule.broker_org_id).length,
      insurerAccess: access,
      licenceValid: !!b.licence_verified_at && (!b.nic_licence_expires_on || b.nic_licence_expires_on >= today),
      slaBreachRate30d: mine.length ? breached / mine.length : 0,
    });
  }
  const decision = routeRequest(candidates, { region, segment });
  const names = Object.fromEntries([...orgById.values()].map((o) => [o.id, o.name]));
  const data: SimulationResult = { decision, candidates, names };
  return { ok: true, message: decision.reason, data };
}
