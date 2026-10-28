import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@im/ui";
import { ForgotPasswordForm } from "./form";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <Card className="p-6 shadow-float sm:p-8">
      <h1 className="text-[28px] font-bold tracking-tight text-ink">Forgot your password?</h1>
      <p className="mt-1 text-[15px] text-muted">Enter your email and we&apos;ll send you a link to choose a new one.</p>
      <div className="mt-6">
        <ForgotPasswordForm />
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        Remembered it? <Link href="/sign-in" className="font-semibold text-brand hover:underline">Back to sign in</Link>
      </p>
    </Card>
  );
}
