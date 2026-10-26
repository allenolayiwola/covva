import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Spinner } from "@im/ui";
import { AuthFrame } from "@/components/shell/AuthFrame";
import { createClient } from "@/lib/supabase/server";
import { mfaRequired } from "@/lib/auth";
import { MfaFlow } from "./MfaFlow";

export const metadata: Metadata = { title: "Verify it's you" };

export default function MfaPage({ searchParams }: PageProps<"/mfa">) {
  return (
    <AuthFrame
      title="Two-step verification"
      subtitle="Admin access requires an authenticator app (TOTP). Your session is upgraded to assurance level 2 once verified."
    >
      <Suspense fallback={<div className="flex items-center gap-2 text-sm text-muted"><Spinner className="size-4" /> Checking your session…</div>}>
        <Gate searchParams={searchParams} />
      </Suspense>
    </AuthFrame>
  );
}

async function Gate({ searchParams }: Pick<PageProps<"/mfa">, "searchParams">) {
  const params = await searchParams;
  const rawNext = typeof params.next === "string" ? params.next : "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/sign-in");

  // Local demo escape hatch: ADMIN_MFA_REQUIRED=false skips the gate (the shell shows a red banner).
  if (!mfaRequired()) redirect(next);

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") redirect(next);

  return <MfaFlow next={next} email={data.user.email ?? ""} />;
}
