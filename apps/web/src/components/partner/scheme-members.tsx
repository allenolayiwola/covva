import { AGE_BANDS, formatDate, humanize, type CensusSummary } from "@im/core";
import { Table, Td, Th, THead } from "@im/ui";
import type { SchemeMemberRow } from "@/server/sme-db";

/** Census counts + member list of a group scheme for the broker of record / insurer (server component). */
export function SchemeCensus({ census }: { census: CensusSummary }) {
  const bands = [...AGE_BANDS, "unknown" as const].filter((b) => census.byAgeBand[b] > 0);
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-4">
      <p><span className="block text-xs text-muted">Lives</span><span className="font-semibold text-ink">{census.lives}</span> ({census.employees} employees · {census.dependants} dependants)</p>
      <p><span className="block text-xs text-muted">Average age</span><span className="font-semibold text-ink">{census.averageAge ?? "—"}</span> (oldest {census.oldestAge ?? "—"})</p>
      <p><span className="block text-xs text-muted">Age bands</span>{bands.map((b) => `${b}: ${census.byAgeBand[b]}`).join(" · ") || "—"}</p>
      <p><span className="block text-xs text-muted">Tiers</span>{Object.entries(census.byTier).map(([k, n]) => `${humanize(k)}: ${n}`).join(" · ") || "—"}</p>
    </div>
  );
}

export function SchemeMemberTable({ members, limit = 500 }: { members: SchemeMemberRow[]; limit?: number }) {
  if (!members.length) return <p className="text-sm text-muted">No members on the scheme yet.</p>;
  const names = new Map(members.map((m) => [m.id, m.full_name]));
  return (
    <>
      <Table>
        <THead><tr><Th>Name</Th><Th>Ref</Th><Th>Relationship</Th><Th>Date of birth</Th><Th>Gender</Th><Th>Tier</Th><Th>Salary band</Th><Th>Card</Th></tr></THead>
        <tbody>
          {members.slice(0, limit).map((m) => (
            <tr key={m.id}>
              <Td className="font-medium text-ink">{m.full_name}</Td>
              <Td className="text-xs text-muted">{m.employee_ref ?? "—"}</Td>
              <Td>{humanize(m.relationship)}{m.principal_member_id ? <span className="block text-xs text-muted">of {names.get(m.principal_member_id) ?? "employee"}</span> : null}</Td>
              <Td>{formatDate(m.date_of_birth)}</Td>
              <Td>{m.gender ? humanize(m.gender) : "—"}</Td>
              <Td>{m.cover_tier ? humanize(m.cover_tier) : "—"}</Td>
              <Td>{m.salary_band ?? "—"}</Td>
              <Td className="text-xs">{m.ghana_card_last4 ? `•••• ${m.ghana_card_last4}` : "—"}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {members.length > limit && <p className="mt-2 text-xs text-muted">Showing {limit} of {members.length} members.</p>}
    </>
  );
}
