import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ShieldCheck } from "lucide-react";
import { Logo, Spinner } from "@im/ui";
import { ROLE_STATEMENTS } from "@im/core";
import { getAssuranceLevel, getUser, partnerMfaRequired } from "@/lib/auth";
import { MfaFlow } from "./MfaFlow";

export const metadata: Metadata = { title: "Two-step verification · Partner workspace", robots: { index: false, follow: false } };

/**
 * `/partner/mfa` — TOTP enrolment + verification for broker and insurer users (Addendum 4).
 * Sits outside the `(workspace)` segment so it never renders the workspace shell (which itself
 * requires AAL2). With `PARTNER_MFA_REQUIRED=false` (local demos, e2e) the page just forwards to `next`.
 */
export default function PartnerMfaPage({ searchParams }: PageProps<"/partner/mfa">) {
  return (
    <div className="flex min-h-dvh flex-col bg-mist/60">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="Home"><Logo /></Link>
          <span className="text-[15px] text-muted">Partner workspace</span>
        </div>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-[480px]">
          <div className="rounded-card border border-line bg-white p-6 shadow-float sm:p-8">
            <h1 className="text-2xl font-bold tracking-tight text-ink">Two-step verification</h1>
            <p className="mt-1.5 text-sm text-muted">
              Broker and insurer accounts need an authenticator app (TOTP) in addition to your password. Codes are generated on your phone and change every 30 seconds.
            </p>
            <div className="mt-6">
              <Suspense fallback={<p className="flex items-center gap-2 text-sm text-muted"><Spinner className="size-4" /> Checking your session…</p>}>
                <Gate searchParams={searchParams} />
              </Suspense>
            </div>
          </div>
          <p className="mx-auto mt-4 flex max-w-xl items-start justify-center gap-1.5 text-center text-xs text-subtle">
            <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>{ROLE_STATEMENTS.platform}</span>
          </p>
        </div>
      </main>
    </div>
  );
}

function safeNext(raw: unknown): string {
  const v = typeof raw === "string" ? raw : "/partner";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/partner";
}

async function Gate({ searchParams }: Pick<PageProps<"/partner/mfa">, "searchParams">) {
  await connection();
  const params = await searchParams;
  const next = safeNext(params.next);
  const user = await getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/partner/mfa?next=${next}`)}`);

  // Local demo / e2e escape hatch (`PARTNER_MFA_REQUIRED=false`): nothing to verify.
  if (!partnerMfaRequired()) redirect(next);
  // `?manage=1` lets an already verified user re-enrol a new authenticator from Security settings.
  if ((await getAssuranceLevel()) === "aal2" && params.manage !== "1") redirect(next);

  return <MfaFlow next={next} email={user.email ?? ""} forceEnrol={params.manage === "1"} />;
}
