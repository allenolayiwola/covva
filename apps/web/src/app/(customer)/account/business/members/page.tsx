import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { UserPlus } from "lucide-react";
import { businessCan, formatDate, humanize, memberCsvTemplate } from "@im/core";
import { EmptyState, Field, Input, Notice, PageHeader, Pill, Select, Table, Td, Th, THead, buttonClass } from "@im/ui";
import { ActionForm } from "@/components/partner/action-form";
import { PageSkeleton } from "@/components/customer/skeletons";
import { formatGhanaPhone } from "@/components/customer/utils";
import { listSchemes, schemeDetail } from "@/server/business";
import { addMemberAction, importMembersAction, removeMemberAction } from "../actions";
import { CsvImportForm } from "../csv-import";
import { BusinessNav, businessContext, one, withOrg } from "../_lib";

export const metadata: Metadata = { title: "Business members" };

export default function MembersPage({ searchParams }: PageProps<"/account/business/members">) {
  return (
    <div className="space-y-8">
      <PageHeader title="Members" description="Employees and their dependants on your group schemes. Only owners and admins, your broker and the insurer see personal details; members see their own cover." />
      <Suspense fallback={<PageSkeleton rows={5} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const PREVIEW_COLUMNS = [
  { key: "employee_ref", label: "Ref" },
  { key: "full_name", label: "Name" },
  { key: "relationship", label: "Relationship" },
  { key: "principal_ref", label: "Principal" },
  { key: "date_of_birth", label: "Date of birth" },
  { key: "phone", label: "Phone" },
  { key: "cover_tier", label: "Tier" },
];

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { ctx, accounts, current } = await businessContext("/account/business/members", sp);
  if (!current) return <EmptyState title="No business account" body="Create a business account first." action={<Link href="/account/business/new" className={buttonClass("primary")}>Create a business account</Link>} />;
  const schemes = (await listSchemes(ctx, current.orgId)).filter((s) => s.status !== "cancelled");
  const nav = <BusinessNav current={current} accounts={accounts} active="members" />;
  if (!schemes.length) {
    return (
      <>
        {nav}
        <EmptyState title="Create a scheme first" body="Members belong to a group scheme (health, life & funeral or personal accident). Create one from the dashboard." action={<Link href={withOrg("/account/business", current.orgId)} className={buttonClass("primary")}>Go to the dashboard</Link>} />
      </>
    );
  }
  const scheme = schemes.find((s) => s.id === one(sp.scheme)) ?? schemes[0]!;
  const detail = await schemeDetail(ctx, scheme.id);
  const canEdit = businessCan(current.role, "members");
  const members = detail.members ?? [];
  const employees = members.filter((m) => m.relationship === "employee");
  const nameOf = new Map(members.map((m) => [m.id, m.full_name]));
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(memberCsvTemplate)}`;

  return (
    <>
      {nav}
      {schemes.length > 1 && (
        <form action="/account/business/members" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="org" value={current.orgId} />
          <Field label="Scheme" htmlFor="scheme-pick">
            <Select id="scheme-pick" name="scheme" defaultValue={scheme.id} className="h-10 text-sm">
              {schemes.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.categoryName}</option>)}
            </Select>
          </Field>
          <button className="h-10 rounded-[10px] bg-mint px-4 text-sm font-semibold text-brand-deep">Show</button>
        </form>
      )}
      <p className="text-sm text-muted">
        <Link href={withOrg(`/account/business/schemes/${scheme.id}`, current.orgId)} className="font-semibold text-brand hover:underline">{scheme.name}</Link> · {detail.categoryName} · {detail.census.lives} lives ({detail.census.employees} employees, {detail.census.dependants} dependants)
      </p>

      {!canEdit ? (
        <Notice tone="info" title="Member details are restricted">Your role ({current.role}) sees counts only. Owners and admins manage members.</Notice>
      ) : (
        <>
          <section aria-labelledby="list-title">
            <h2 id="list-title" className="mb-3 text-lg font-semibold text-ink">Members ({members.length})</h2>
            {members.length === 0 ? (
              <p className="text-sm text-muted">No members yet. Add them one by one or upload your staff list below.</p>
            ) : (
              <Table>
                <THead><tr><Th>Name</Th><Th>Ref</Th><Th>Relationship</Th><Th>Date of birth</Th><Th>Phone</Th><Th>Tier</Th><Th>Account</Th><Th><span className="sr-only">Actions</span></Th></tr></THead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <Td className="font-medium text-ink">{m.full_name}</Td>
                      <Td className="text-xs text-muted">{m.employee_ref ?? "—"}</Td>
                      <Td>{humanize(m.relationship)}{m.principal_member_id ? <span className="block text-xs text-muted">of {nameOf.get(m.principal_member_id) ?? "employee"}</span> : null}</Td>
                      <Td>{formatDate(m.date_of_birth)}</Td>
                      <Td className="text-xs">{m.phone ? formatGhanaPhone(m.phone) : "—"}</Td>
                      <Td>{m.cover_tier ? humanize(m.cover_tier) : "—"}</Td>
                      <Td>{m.user_id ? <Pill tone="ok">Linked</Pill> : <Pill tone="neutral">Not yet</Pill>}</Td>
                      <Td>
                        <ActionForm action={removeMemberAction} submitLabel="Remove" variant="ghost" size="sm" inline confirm={m.relationship === "employee" ? `Remove ${m.full_name} and their dependants from the scheme?` : `Remove ${m.full_name} from the scheme?`}>
                          <input type="hidden" name="memberId" value={m.id} />
                        </ActionForm>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>

          <section aria-labelledby="add-title" className="rounded-xl border border-line p-5">
            <h2 id="add-title" className="mb-3 flex items-center gap-2 text-lg font-semibold text-ink"><UserPlus aria-hidden className="size-5 text-brand" /> Add a member</h2>
            <ActionForm action={addMemberAction} submitLabel="Add member" resetOnSuccess>
              <input type="hidden" name="schemeId" value={scheme.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Full name" htmlFor="m-name"><Input id="m-name" name="full_name" required /></Field>
                <Field label="Relationship" htmlFor="m-rel">
                  <Select id="m-rel" name="relationship" defaultValue="employee">
                    <option value="employee">Employee</option>
                    <option value="spouse">Spouse</option>
                    <option value="child">Child</option>
                    <option value="parent">Parent</option>
                  </Select>
                </Field>
                <Field label="Dependant of" htmlFor="m-principal" hint="For spouses, children and parents">
                  <Select id="m-principal" name="principal_member_id" defaultValue="">
                    <option value="">—</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.employee_ref ? ` (${e.employee_ref})` : ""}</option>)}
                  </Select>
                </Field>
                <Field label="Employee ref" htmlFor="m-ref"><Input id="m-ref" name="employee_ref" /></Field>
                <Field label="Date of birth" htmlFor="m-dob"><Input id="m-dob" name="date_of_birth" type="date" /></Field>
                <Field label="Gender" htmlFor="m-gender">
                  <Select id="m-gender" name="gender" defaultValue="">
                    <option value="">—</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
                <Field label="Mobile (Ghana)" htmlFor="m-phone" hint="They link their cover by signing in with this number"><Input id="m-phone" name="phone" type="tel" inputMode="tel" placeholder="024 123 4567" /></Field>
                <Field label="Email" htmlFor="m-email"><Input id="m-email" name="email" type="email" /></Field>
                <Field label="Ghana Card" htmlFor="m-card" hint="Only the last 4 digits are kept"><Input id="m-card" name="ghana_card" autoComplete="off" /></Field>
                <Field label="Cover tier" htmlFor="m-tier"><Input id="m-tier" name="cover_tier" placeholder="standard" /></Field>
                <Field label="Salary band" htmlFor="m-band" hint="For life cover multiples"><Input id="m-band" name="salary_band" /></Field>
              </div>
            </ActionForm>
          </section>

          <section aria-labelledby="import-title" className="rounded-xl border border-line p-5">
            <h2 id="import-title" className="mb-1 text-lg font-semibold text-ink">Upload your staff list</h2>
            <p className="mb-4 text-sm text-muted">Check the file first: problems are listed with their row numbers and those rows are never imported. Dependants name their employee in <code>principal_ref</code>.</p>
            <CsvImportForm
              action={importMembersAction}
              hidden={{ schemeId: scheme.id }}
              label="Members (CSV)"
              hint="Columns: employee_ref, full_name, date_of_birth, gender, phone, email, ghana_card, relationship, principal_ref, cover_tier, salary_band · up to 900 KB"
              columns={PREVIEW_COLUMNS}
              noun="member"
              templateHref={template}
              templateName="covva-members-template.csv"
            />
          </section>
        </>
      )}
    </>
  );
}
