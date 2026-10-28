import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card } from "@im/ui";
import { safeNext } from "@/components/customer/utils";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create your account", robots: { index: false } };

export default function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  return (
    <Card className="p-6 shadow-float sm:p-8">
      <h1 className="text-[28px] font-bold tracking-tight text-ink">Create your account</h1>
      <p className="mt-1 text-[15px] text-muted">
        Keep every policy in one place, compare quotes from participating insurers and talk to a named broker.
      </p>
      <div className="mt-6">
        <Suspense fallback={<SignUpForm next="/account" />}>
          <Body searchParams={searchParams} />
        </Suspense>
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-semibold text-brand hover:underline">Sign in</Link>
      </p>
    </Card>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/sign-up">, "searchParams">) {
  const sp = await searchParams;
  const email = typeof sp.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sp.email) ? sp.email : undefined;
  return <SignUpForm next={safeNext(sp.next)} defaultEmail={email} />;
}
