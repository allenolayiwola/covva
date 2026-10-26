import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Notice } from "@im/ui";
import { safeNext } from "@/components/customer/utils";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <Card className="p-6 shadow-float sm:p-8">
      <h1 className="text-[28px] font-bold tracking-tight text-ink">Welcome back</h1>
      <p className="mt-1 text-[15px] text-muted">Sign in to see your cover, requests and messages from your broker.</p>
      <div className="mt-6">
        <Suspense fallback={<SignInForm next="/account" />}>
          <SignInBody searchParams={searchParams} />
        </Suspense>
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        New here?{" "}
        <Link href="/sign-up" className="font-semibold text-brand hover:underline">Create an account</Link>
      </p>
    </Card>
  );
}

async function SignInBody({ searchParams }: Pick<PageProps<"/sign-in">, "searchParams">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const error = typeof sp.error === "string" ? sp.error : null;
  return (
    <>
      {sp.signed_out && <Notice tone="ok" className="mb-4">You&apos;ve signed out. See you soon.</Notice>}
      {error && (
        <Notice tone="danger" className="mb-4">
          {error === "link" ? "That sign-in link is invalid or has expired. Request a new one." : "We couldn't sign you in. Please try again."}
        </Notice>
      )}
      <SignInForm next={next} defaultMode={sp.method === "phone" ? "phone" : sp.method === "link" ? "link" : "password"} />
    </>
  );
}
