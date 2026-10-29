import type { Row } from "@im/db";
import { describeActivity, isTeamActivity } from "@im/core";
import { Pill } from "@im/ui";
import { Table, THead, Th, Td } from "@/components/ui/page";
import { createClient } from "@/lib/supabase/server";
import { personName, profileMap } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { ChangesDiff, JsonView } from "@/components/ui/layout";
import { CopyText } from "@/components/ui/copy-text";

const ENTITY_LINK: Record<string, (id: string) => string> = {
  organizations: (id) => `/organisations/${id}`,
  requests: (id) => `/requests/${id}`,
  policies: (id) => `/policies/${id}`,
  claims: (id) => `/claims/${id}`,
  complaints: (id) => `/complaints/${id}`,
  product_categories: (id) => `/categories/${id}`,
  products: (id) => `/products/${id}`,
  invoices: (id) => `/invoices/${id}`,
};

const ACTION_TONE: Record<string, "ok" | "info" | "danger" | "neutral" | "wait"> = {
  insert: "ok",
  update: "info",
  delete: "danger",
  "mfa.enrolled": "ok",
  "mfa.removed": "danger",
  "products.bulk_pause": "wait",
  "products.bulk_withdraw": "danger",
  "products.bulk_republish": "ok",
};

type AuditData = { changes?: Record<string, { from: unknown; to: unknown }>; row?: Record<string, unknown> } & Record<string, unknown>;

/** The whitelisted detail the partner activity view exposes, rebuilt from the raw payload for staff. */
function detailFor(e: Row<"audit_events">): unknown {
  const data = (e.data as AuditData | null) ?? {};
  if (e.entity_type === "mfa") return data;
  if (e.action === "update") return data.changes ?? {};
  if (e.action.startsWith("products.bulk_")) return data;
  return data.row ?? {};
}

/**
 * Audit events with expandable row detail (field diff for updates, row snapshot for inserts/deletes).
 * Team rows (memberships, invitations, two-step verification) and bulk product actions also get a plain
 * sentence — "Changed Ama Owusu's role: Underwriter → Claims" — so staff can read them without the diff.
 */
export async function AuditTable({ rows, compact = false }: { rows: Row<"audit_events">[]; compact?: boolean }) {
  const supabase = await createClient();
  const membershipIds = rows.filter((r) => r.entity_type === "memberships" && r.entity_id).map((r) => r.entity_id!);
  const [{ data: memberships }, orgRows] = await Promise.all([
    membershipIds.length ? supabase.from("memberships").select("id, user_id, org_id").in("id", membershipIds) : Promise.resolve({ data: [] as { id: string; user_id: string; org_id: string }[] }),
    supabase.from("organizations").select("id, type").in("id", [...new Set(rows.map((r) => r.org_id).filter((x): x is string => !!x))].slice(0, 200)),
  ]);
  const membershipUser = new Map((memberships ?? []).map((m) => [m.id, m.user_id]));
  const orgType = new Map((orgRows.data ?? []).map((o) => [o.id, o.type]));
  const subjectOf = (e: Row<"audit_events">) => (e.entity_type === "memberships" ? membershipUser.get(e.entity_id ?? "") ?? ((e.data as AuditData | null)?.row?.user_id as string | undefined) ?? null : e.entity_type === "mfa" ? e.entity_id : null);
  const people = await profileMap(supabase, [...rows.map((r) => r.actor_id), ...rows.map(subjectOf)]);
  const name = (id: string | null | undefined) => (id ? personName(people.get(id), id.slice(0, 8)) : null);
  return (
    <Table className={compact ? "rounded-none border-0" : undefined}>
      <THead>
        <tr><Th>#</Th><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Entity</Th><Th>Detail</Th></tr>
      </THead>
      <tbody>
        {rows.map((e) => {
          const data = (e.data as { changes?: Record<string, { from: unknown; to: unknown }>; row?: unknown } | null) ?? {};
          const link = e.entity_id && ENTITY_LINK[e.entity_type]?.(e.entity_id);
          const changed = data.changes ? Object.keys(data.changes) : [];
          const readable = isTeamActivity(e) || e.action.startsWith("products.bulk_")
            ? describeActivity({ ...e, subject_user_id: subjectOf(e), detail: detailFor(e) }, { kind: (orgType.get(e.org_id ?? "") === "broker" ? "broker" : orgType.get(e.org_id ?? "") === "distributor" ? "distributor" : "insurer"), names: name })
            : null;
          return (
            <tr key={e.id} className="align-top">
              <Td className="font-mono text-xs text-muted">{e.id}</Td>
              <Td className="whitespace-nowrap text-xs">{formatDateTime(e.occurred_at)}</Td>
              <Td className="text-xs">
                {e.actor_id ? personName(people.get(e.actor_id), e.actor_id.slice(0, 8)) : <span className="text-muted">system</span>}
                <p className="text-subtle">{e.actor_role}</p>
              </Td>
              <Td><Pill tone={ACTION_TONE[e.action] ?? "neutral"}>{e.action}</Pill></Td>
              <Td className="text-xs">
                <span className="font-medium text-ink">{e.entity_type}</span>
                <p className="font-mono text-subtle">{link ? <a href={link} className="text-brand hover:underline">{e.entity_id?.slice(0, 13)}</a> : e.entity_id?.slice(0, 13)}</p>
              </Td>
              <Td className="min-w-72 text-xs">
                {readable && <p className="mb-1 text-ink">{readable.summary}</p>}
                <details>
                  <summary className="cursor-pointer text-ink-2">
                    {changed.length ? `Changed: ${changed.slice(0, 4).join(", ")}${changed.length > 4 ? ` +${changed.length - 4}` : ""}` : e.action === "insert" ? "Created" : "View"}
                  </summary>
                  <div className="mt-2 space-y-2">
                    {data.changes ? <ChangesDiff changes={data.changes} /> : <JsonView value={data.row ?? data} className="max-h-64" />}
                    <p className="flex flex-wrap items-center gap-x-1 gap-y-1 font-mono text-[13px] text-subtle">
                      <span>hash {e.hash.slice(0, 12)}…</span>
                      <CopyText value={e.hash} label="Copy the full hash" />
                      {e.prev_hash && (
                        <>
                          <span>· prev {e.prev_hash.slice(0, 12)}…</span>
                          <CopyText value={e.prev_hash} label="Copy the full previous hash" />
                        </>
                      )}
                    </p>
                  </div>
                </details>
              </Td>
            </tr>
          );
        })}
        {!rows.length && <tr><Td colSpan={6} className="py-8 text-center text-muted">No audit events.</Td></tr>}
      </tbody>
    </Table>
  );
}
