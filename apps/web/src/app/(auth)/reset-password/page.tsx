import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Notice } from "@im/ui";
import { getUser } from "@/lib/auth";
import { ResetPasswordForm } from "./form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default function ResetPasswordPage() {
  return (
    <Card className="p-6 shadow-float sm:p-8">
      <h1 className="text-[28px] font-bold tracking-tight text-ink">Choose a new password</h1>
      <div className="mt-6">
        <Suspense fallback={<div className="h-48" aria-hidden />}>
          <Body />
        </Suspense>
      </div>
    </Card>
  );
}

async function Body() {
  const user = await getUser();
  if (!user) {
    return (
      <Notice tone="wait" title="This reset link has expired">
        <Link href="/forgot-password" className="font-semibold underline">Request a new link</Link> and open it on this device.
      </Notice>
    );
  }
  return <ResetPasswordForm email={user.email ?? ""} />;
}
