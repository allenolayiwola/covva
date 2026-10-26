import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { AuthFrame } from "@/components/shell/AuthFrame";
import { signOut } from "@/app/sign-in/actions";
import { buttonClass } from "@im/ui";

export const metadata: Metadata = { title: "403 · No access" };

export default function NoAccessPage() {
  return (
    <AuthFrame title="403 — you don't have access" subtitle="This console is for COVVA platform staff only.">
      <div className="space-y-4 text-sm text-ink-2">
        <div className="flex gap-3 rounded-xl bg-danger-bg p-4 text-danger">
          <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>
            Your account is not an active member of the platform organisation with a staff role (platform admin, operations,
            compliance or support), or your role does not allow this page. Partner staff should use the partner workspace instead.
          </p>
        </div>
        <p className="text-muted">If you believe this is a mistake, ask a platform admin to add you. Access changes are audited.</p>
        <div className="flex gap-2">
          <Link href="/" className={buttonClass("outline", "sm")}>Try again</Link>
          <form action={signOut}>
            <button type="submit" className={buttonClass("secondary", "sm")}>Sign out</button>
          </form>
        </div>
      </div>
    </AuthFrame>
  );
}
