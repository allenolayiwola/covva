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
      <h1 className="text-h4 text-ink">Sign in</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">A code to your phone or a link to your email. Your quotes, policies and broker messages are waiting.</p>
      <div className="mt-6">
        <Suspense fallback={<div role="status" className="h-64 animate-pulse rounded-card bg-mist p-6 text-sm text-muted">Loading sign-in…</div>}>
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
      {typeof sp.next === "string" && sp.next === next && (
        next.split(/[?#]/)[0] === "/partner/register" ? <p className="mb-4 font-medium text-ink">Sign in to register as a partner</p>
          : (next === "/account" || next.startsWith("/account/") || next.startsWith("/account?")) ? <p className="mb-4 font-medium text-ink">Sign in to view your account</p> : null
      )}
      {sp.signed_out && <Notice tone="ok" className="mb-4">You&apos;ve signed out. See you soon.</Notice>}
      {error && (
        <Notice tone="danger" className="mb-4">
          {error === "link" ? "That sign-in link is invalid or has expired. Request a new one." : "We couldn't sign you in. Please try again."}
        </Notice>
      )}
      <SignInForm next={next} defaultMode={sp.method === "link" ? "link" : sp.method === "password" ? "password" : "phone"} />
    </>
  );
}
