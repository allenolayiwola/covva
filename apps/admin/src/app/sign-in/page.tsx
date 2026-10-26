import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthFrame } from "@/components/shell/AuthFrame";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <AuthFrame title="Staff sign in" subtitle="Platform administration. Access is restricted to Covva staff and protected by multi-factor authentication.">
      <Suspense fallback={<div className="h-64" />}>
        <SignInForm />
      </Suspense>
    </AuthFrame>
  );
}

