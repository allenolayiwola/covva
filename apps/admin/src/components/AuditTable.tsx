import type { Row } from "@im/db";
import { Pill, Table, THead, Th, Td } from "@im/ui";
import { createClient } from "@/lib/supabase/server";
import { personName, profileMap } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { ChangesDiff, JsonView } from "@/components/ui/layout";

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

const ACTION_TONE: Record<string, "ok" | "info" | "danger" | "neutral"> = { insert: "ok", update: "info", delete: "danger" };

/** Audit events with expandable row detail (field diff for updates, row snapshot for inserts/deletes). */
export async function AuditTable({ rows, compact = false }: { rows: Row<"audit_events">[]; compact?: boolean }) {
  const supabase = await createClient();
  const people = await profileMap(supabase, rows.map((r) => r.actor_id));
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
                <details>
                  <summary className="cursor-pointer text-ink-2">
                    {changed.length ? `Changed: ${changed.slice(0, 4).join(", ")}${changed.length > 4 ? ` +${changed.length - 4}` : ""}` : e.action === "insert" ? "Created" : "View"}
                  </summary>
                  <div className="mt-2 space-y-2">
                    {data.changes ? <ChangesDiff changes={data.changes} /> : <JsonView value={data.row ?? data} className="max-h-64" />}
                    <p className="break-all font-mono text-[10px] text-subtle">hash {e.hash.slice(0, 24)}… · prev {e.prev_hash?.slice(0, 16)}…</p>
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
