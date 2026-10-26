import { Suspense } from "react";
import Link from "next/link";
import { Input, PageHeader, Pill, Table, THead, Th, Td } from "@im/ui";
import { withinServiceWindow } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { ilikeTerm, pageOf, personName, profileMap, sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { ActionForm, ConfirmAction } from "@/components/ui/forms";
import { FilterBar, FilterCheck, FilterInput, LoadingBlock, Pagination } from "@/components/ui/layout";
import { linkContact, optOutContact } from "../actions";
import { SubNav } from "../sub-nav";

export default function ContactsPage({ searchParams }: PageProps<"/whatsapp/contacts">) {
  return (
    <>
      <PageHeader title="WhatsApp contacts" description="Every number that has messaged us or that we have messaged. Opt-outs are honoured in full: an opted-out contact receives nothing until they message again." actions={<SubNav active="contacts" />} />
      <Suspense fallback={<LoadingBlock label="Loading contacts…" />}>
        <Contacts searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Contacts({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const writer = can(staff.roles, "whatsapp");
  const { page, from, to } = pageOf(params);
  const q = sp(params, "q");
  const optout = sp(params, "optout") === "1";
  let query = supabase.from("wa_contacts").select("*", { count: "exact" }).order("last_inbound_at", { ascending: false, nullsFirst: false }).range(from, to);
  if (q) query = query.or(`phone.ilike.${ilikeTerm(q)},display_name.ilike.${ilikeTerm(q)}`);
  if (optout) query = query.not("opted_out_at", "is", null);
  const { data, count, error } = await query;
  const rows = data ?? [];
  const people = await profileMap(supabase, rows.map((r) => r.user_id));
  return (
    <>
      <FilterBar action="/whatsapp/contacts">
        <FilterInput name="q" label="Phone or name" value={q} />
        <FilterCheck name="optout" label="Opted out only" checked={optout} />
      </FilterBar>
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      <Table>
        <THead><tr><Th>Contact</Th><Th>Account</Th><Th>Consent</Th><Th>Last inbound</Th><Th>Last outbound</Th><Th>Actions</Th></tr></THead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="hover:bg-mist/60">
              <Td><p className="font-semibold text-ink">{c.display_name ?? "—"}</p><p className="text-xs text-muted">{c.phone}</p></Td>
              <Td>
                {c.user_id ? (
                  <Link href={`/users/${c.user_id}`} className="text-brand hover:underline">{personName(people.get(c.user_id))}</Link>
                ) : (
                  <ActionForm action={linkContact} inline submitLabel="Link" submitVariant="ghost" readOnly={!writer} audited={false}>
                    <input type="hidden" name="contactId" value={c.id} />
                    <Input name="email" type="email" placeholder="account email" aria-label="Account email" className="h-8 w-44 text-xs" required />
                  </ActionForm>
                )}
              </Td>
              <Td>{c.opted_out_at ? <Pill tone="danger">Opted out {formatDateTime(c.opted_out_at)}</Pill> : c.opted_in ? <Pill tone="ok">Opted in</Pill> : <Pill>Unknown</Pill>}</Td>
              <Td className="whitespace-nowrap text-muted">{c.last_inbound_at ? formatDateTime(c.last_inbound_at) : "—"}{c.last_inbound_at && withinServiceWindow(c.last_inbound_at) && <Pill tone="ok" className="ml-1">window open</Pill>}</Td>
              <Td className="whitespace-nowrap text-muted">{c.last_outbound_at ? formatDateTime(c.last_outbound_at) : "—"}</Td>
              <Td>
                {!c.opted_out_at && <ConfirmAction action={optOutContact} fields={{ contactId: c.id }} label="Opt out" title="Opt this contact out" body="They asked us (by phone, email or in person) not to receive WhatsApp messages. Open conversations are closed. Only the contact can opt back in, by messaging us." confirmLabel="Opt out" variant="danger" disabled={!writer} />}
              </Td>
            </tr>
          ))}
          {!rows.length && <tr><Td colSpan={6} className="py-10 text-center text-muted">No contacts.</Td></tr>}
        </tbody>
      </Table>
      <Pagination base="/whatsapp/contacts" params={params} page={page} total={count} />
    </>
  );
}
