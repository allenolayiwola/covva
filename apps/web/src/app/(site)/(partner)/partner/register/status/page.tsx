import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Notice, PageHeader, Pill, Timeline, buttonClass, type TimelineStep } from "@im/ui";
import { formatDateTime, humanize } from "@im/core";
import { Skeleton } from "@/components/partner/ui";
import { getMyApplications, registerPath } from "../_lib";

export const metadata: Metadata = { title: "Application status" };

export default function StatusPage({ searchParams }: PageProps<"/partner/register/status">) {
  return (
    <>
      <PageHeader eyebrow="Covva partners" title="Your partner application" description="Where your registration stands and what happens next." />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Status searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const TONE: Record<string, "neutral" | "wait" | "ok" | "danger" | "info"> = {
  draft: "neutral",
  submitted: "wait",
  in_review: "info",
  needs_changes: "danger",
  approved: "ok",
  rejected: "danger",
};

async function Status({ searchParams }: Pick<PageProps<"/partner/register/status">, "searchParams">) {
  const sp = await searchParams;
  const { applications } = await getMyApplications();
  if (!applications.length) {
    return (
      <Notice tone="info" title="No application yet">
        <Link href="/partner/register" className={buttonClass("primary", "sm")}>Start a registration</Link>
      </Notice>
    );
  }
  return (
    <div className="space-y-6">
      {sp.submitted && <Notice tone="ok" title="Application submitted">We have emailed you a confirmation. Verification usually takes up to 3 working days.</Notice>}
      {applications.map((a) => {
        const type = a.type as "insurer" | "broker";
        const editable = a.status === "draft" || a.status === "needs_changes";
        const stepState = (idx: number): TimelineStep["state"] => {
          const order = ["draft", "submitted", "in_review", "approved"];
          const pos = a.status === "needs_changes" ? 1 : a.status === "rejected" ? 2 : order.indexOf(a.status);
          return idx < pos ? "done" : idx === pos ? (a.status === "approved" ? "done" : "current") : "upcoming";
        };
        const steps: TimelineStep[] = [
          { title: "Application started", detail: formatDateTime(a.created_at), state: stepState(0) },
          { title: a.status === "needs_changes" ? "Returned for changes" : "Submitted for verification", detail: a.submitted_at ? formatDateTime(a.submitted_at) : "Complete the steps and submit", state: a.status === "needs_changes" ? "current" : stepState(1) },
          { title: a.status === "rejected" ? "Not approved" : "NIC licence and documents verified by Covva", detail: a.reviewed_at ? formatDateTime(a.reviewed_at) : "Usually within 3 working days", state: a.status === "rejected" ? "current" : stepState(2) },
          { title: "Workspace live", detail: a.status === "approved" ? "Sign in to your partner workspace" : "You will receive an email with a sign-in link", state: stepState(3) },
        ];
        return (
          <Card key={a.id} className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink">{a.company_name ?? `${humanize(type)} application`}</h2>
                <p className="text-sm text-muted">{humanize(type)} · started {formatDateTime(a.created_at)}</p>
              </div>
              <Pill tone={TONE[a.status] ?? "neutral"}>{humanize(a.status)}</Pill>
            </div>
            {a.status === "needs_changes" && (
              <Notice tone="wait" className="mt-4" title="What needs to change">
                <p className="whitespace-pre-line">{a.review_notes}</p>
              </Notice>
            )}
            {a.status === "rejected" && a.review_notes && (
              <Notice tone="danger" className="mt-4" title="Reason">
                <p className="whitespace-pre-line">{a.review_notes}</p>
              </Notice>
            )}
            <Timeline steps={steps} className="mt-5" />
            <div className="mt-5 flex flex-wrap gap-2">
              {editable && <Link href={registerPath(type)} className={buttonClass("primary", "sm")}>{a.status === "needs_changes" ? "Update application" : "Continue application"}</Link>}
              {a.status === "approved" && <Link href="/partner" className={buttonClass("primary", "sm")}>Open partner workspace</Link>}
              {(a.status === "submitted" || a.status === "in_review") && <p className="text-sm text-muted">We will email {(a.primary_contact as { email?: string })?.email ?? "you"} with the decision.</p>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
