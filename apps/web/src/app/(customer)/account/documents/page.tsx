import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download, FileText, Files } from "lucide-react";
import { formatDate, humanize } from "@im/core";
import { EmptyState, PageHeader, Pill } from "@im/ui";
import { ListSkeleton } from "@/components/customer/skeletons";
import { formatBytes } from "@/components/customer/utils";
import { account, signUrls } from "../_lib/data";

export const metadata: Metadata = { title: "Documents" };

export default function DocumentsPage() {
  return (
    <>
      <PageHeader title="Documents" description="Everything you've uploaded and every document issued to you, grouped by policy, request and claim." />
      <Suspense fallback={<ListSkeleton rows={5} />}>
        <DocumentList />
      </Suspense>
    </>
  );
}

type Doc = {
  id: string;
  file_name: string;
  storage_path: string;
  kind: string;
  size_bytes: number | null;
  created_at: string;
  uploaded_by_party: string;
  delivered_to_insurer_at: string | null;
  policy: { id: string; nickname: string | null; policy_number: string | null; internal_reference: string } | null;
  request: { id: string; reference: string; title: string | null } | null;
  claim: { id: string; reference: string; incident_type: string } | null;
};

async function DocumentList() {
  const { supabase } = await account("/account/documents");
  const { data } = await supabase
    .from("documents")
    .select(
      "id, file_name, storage_path, kind, size_bytes, created_at, uploaded_by_party, delivered_to_insurer_at, policy:policies(id, nickname, policy_number, internal_reference), request:requests(id, reference, title), claim:claims!documents_claim_fk(id, reference, incident_type)",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  const docs = (data ?? []) as unknown as Doc[];
  if (!docs.length) {
    return (
      <EmptyState
        icon={<Files className="size-5" />}
        title="No documents yet"
        body="Policy schedules and certificates appear here once an insurer issues them, along with anything you upload for requests and claims."
      />
    );
  }
  const paths = docs.map((d) => d.storage_path);
  const [view, download] = await Promise.all([signUrls(supabase, paths), signUrls(supabase, paths, true)]);

  const groups = new Map<string, { title: string; href: string; docs: Doc[] }>();
  const add = (key: string, title: string, href: string, d: Doc) => {
    const g = groups.get(key) ?? { title, href, docs: [] };
    g.docs.push(d);
    groups.set(key, g);
  };
  for (const d of docs) {
    if (d.claim) add(`c:${d.claim.id}`, `Claim ${d.claim.reference} · ${humanize(d.claim.incident_type)}`, `/account/claims/${d.claim.id}`, d);
    else if (d.policy) add(`p:${d.policy.id}`, `Policy · ${d.policy.nickname ?? d.policy.policy_number ?? d.policy.internal_reference}`, `/account/policies/${d.policy.id}`, d);
    else if (d.request) add(`r:${d.request.id}`, `Request ${d.request.reference}${d.request.title ? ` · ${d.request.title}` : ""}`, `/account/requests/${d.request.id}`, d);
    else add("other", "Other documents", "/account/profile", d);
  }

  return (
    <div className="space-y-8">
      {[...groups.entries()].map(([key, g]) => (
        <section key={key} aria-label={g.title}>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="font-semibold text-ink">{g.title}</h2>
            <Link href={g.href} className="text-sm font-medium text-brand hover:underline">Open</Link>
          </div>
          <ul className="divide-y divide-line rounded-card border border-line">
            {g.docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <FileText aria-hidden className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  {view[d.storage_path] ? (
                    <a href={view[d.storage_path]} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-ink hover:text-brand hover:underline">{d.file_name}</a>
                  ) : (
                    <span className="block truncate font-medium text-ink">{d.file_name}</span>
                  )}
                  <span className="block text-xs text-subtle">{[humanize(d.kind), formatBytes(d.size_bytes), formatDate(d.created_at)].filter(Boolean).join(" · ")}</span>
                </span>
                {d.uploaded_by_party === "insurer" ? (
                  <Pill tone="ok">From insurer</Pill>
                ) : d.uploaded_by_party === "broker" ? (
                  <Pill tone="info">From broker</Pill>
                ) : d.delivered_to_insurer_at ? (
                  <Pill tone="ok">Delivered to insurer</Pill>
                ) : null}
                {download[d.storage_path] && (
                  <a href={download[d.storage_path]} className="grid size-9 place-items-center rounded-full text-brand hover:bg-mist" aria-label={`Download ${d.file_name}`}>
                    <Download className="size-4" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-xs text-subtle">Download links are private and expire after an hour. An upload isn&apos;t insurer notification until delivery is confirmed.</p>
    </div>
  );
}
