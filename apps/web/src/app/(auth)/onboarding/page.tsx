import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Card } from "@im/ui";
import { getProfile, requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/catalog";
import { firstName, safeNext } from "@/components/customer/utils";
import { PageSkeleton } from "@/components/customer/skeletons";
import { OnboardingForm } from "./form";

export const metadata: Metadata = { title: "Set up your account", robots: { index: false } };

export default function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  return (
    <Card className="p-6 shadow-float sm:p-8">
      <Suspense fallback={<PageSkeleton rows={6} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </Card>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/onboarding">, "searchParams">) {
  await connection();
  const sp = await searchParams;
  const next = safeNext(sp.next);
  await requireUser(`/onboarding?next=${encodeURIComponent(next)}`);
  const [profile, termsVersion, privacyVersion] = await Promise.all([
    getProfile(),
    getSetting<string>("terms_version"),
    getSetting<string>("privacy_version"),
  ]);
  if (profile?.onboarded_at) redirect(next);

  return (
    <>
      <p className="text-sm text-muted">Step 2 of 2</p>
      <h1 className="mt-1 text-[28px] font-bold tracking-tight text-ink">Welcome, {firstName(profile?.full_name)}</h1>
      <p className="mt-1 mb-6 text-[15px] text-muted">
        A couple of details and your consent, then you can request cover, compare quotes and talk to your broker.
      </p>
      <OnboardingForm
        next={next}
        termsVersion={termsVersion ?? "current"}
        privacyVersion={privacyVersion ?? "current"}
        defaults={{
          full_name: profile?.full_name ?? "",
          phone: profile?.phone ?? "",
          region: profile?.region ?? "",
          ghana_card: profile?.ghana_card_number ?? "",
        }}
      />
    </>
  );
}
