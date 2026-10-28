import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BUSINESS_ROLE_OPTIONS, businessCan, businessRoleLabel, formatDate } from "@im/core";
import { EmptyState, Field, Input, PageHeader, Pill, Select, Table, Td, Th, THead, buttonClass } from "@im/ui";
import { ActionForm } from "@/components/partner/action-form";
import { PageSkeleton } from "@/components/customer/skeletons";
import { listTeam } from "@/server/business";
import { inviteAction, updateTeamMemberAction } from "../actions";
import { BusinessNav, businessContext } from "../_lib";

export const metadata: Metadata = { title: "Business team" };

export default function TeamPage({ searchParams }: PageProps<"/account/business/team">) {
  return (
    <div className="space-y-8">
      <PageHeader title="Team" description="Colleagues who can use this business account. Owners and admins manage everything; finance pays statements; viewers see the dashboard." />
      <Suspense fallback={<PageSkeleton rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { ctx, accounts, current } = await businessContext("/account/business/team", sp);
  if (!current) return <EmptyState title="No business account" body="Create a business account first." action={<Link href="/account/business/new" className={buttonClass("primary")}>Create a business account</Link>} />;
  const team = await listTeam(ctx, current.orgId);
  const manage = businessCan(current.role, "manage");
  const roleOptions = BUSINESS_ROLE_OPTIONS.filter((r) => r.value !== "owner" || current.role === "owner");
  return (
    <>
      <BusinessNav current={current} accounts={accounts} active="team" />
      <Table>
        <THead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Team</Th><Th>Status</Th>{manage && <Th><span className="sr-only">Actions</span></Th>}</tr></THead>
        <tbody>
          {team.members.map((m) => (
            <tr key={m.membershipId}>
              <Td className="font-medium text-ink">{m.name}{m.isYou ? <span className="ml-1 text-xs text-muted">(you)</span> : null}</Td>
              <Td className="text-sm text-muted">{m.email ?? "—"}</Td>
              <Td>{businessRoleLabel(m.role)}</Td>
              <Td>{m.team ?? "—"}</Td>
              <Td>{m.active ? <Pill tone="ok">Active</Pill> : <Pill tone="neutral">Removed</Pill>}</Td>
              {manage && (
                <Td>
                  {!m.isYou && (
                    <div className="flex flex-wrap items-center gap-2">
                      <ActionForm action={updateTeamMemberAction} submitLabel="Change role" variant="ghost" size="sm" inline>
                        <input type="hidden" name="orgId" value={current.orgId} />
                        <input type="hidden" name="membershipId" value={m.membershipId} />
                        <input type="hidden" name="op" value="role" />
                        <label className="sr-only" htmlFor={`role-${m.membershipId}`}>Role for {m.name}</label>
                        <Select id={`role-${m.membershipId}`} name="role" defaultValue={m.role} className="h-9 w-32 text-sm">
                          {roleOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </Select>
                      </ActionForm>
                      <ActionForm action={updateTeamMemberAction} submitLabel={m.active ? "Remove access" : "Restore access"} variant="ghost" size="sm" inline confirm={m.active ? `Remove ${m.name}'s access to ${current.name}?` : undefined}>
                        <input type="hidden" name="orgId" value={current.orgId} />
                        <input type="hidden" name="membershipId" value={m.membershipId} />
                        <input type="hidden" name="op" value={m.active ? "deactivate" : "reactivate"} />
                      </ActionForm>
                    </div>
                  )}
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>

      {manage && (
        <>
          <section aria-labelledby="invite-title" className="rounded-xl border border-line p-5">
            <h2 id="invite-title" className="mb-3 text-lg font-semibold text-ink">Invite a colleague</h2>
            <ActionForm action={inviteAction} submitLabel="Send invitation" resetOnSuccess>
              <input type="hidden" name="orgId" value={current.orgId} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Email" htmlFor="inv-email"><Input id="inv-email" name="email" type="email" required /></Field>
                <Field label="Role" htmlFor="inv-role">
                  <Select id="inv-role" name="role" defaultValue="viewer">
                    {roleOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </Select>
                </Field>
                <Field label="Team (optional)" htmlFor="inv-team" hint="e.g. HR, Finance"><Input id="inv-team" name="team" /></Field>
              </div>
              <ul className="space-y-1 text-xs text-muted">
                {roleOptions.map((r) => <li key={r.value}><span className="font-semibold text-ink-2">{r.label}:</span> {r.description}</li>)}
              </ul>
            </ActionForm>
          </section>
          {team.invitations.length > 0 && (
            <section aria-labelledby="pending-title">
              <h2 id="pending-title" className="mb-3 text-lg font-semibold text-ink">Pending invitations</h2>
              <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                {team.invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span className="text-ink">{i.email} · {businessRoleLabel(i.role)}{i.team ? ` · ${i.team}` : ""}</span>
                    <span className="text-muted">expires {formatDate(i.expiresAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
