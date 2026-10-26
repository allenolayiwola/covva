import Link from "next/link";
import { buttonClass } from "@im/ui";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.12em] text-brand">404</p>
      <h1 className="text-2xl font-bold text-ink">We couldn&apos;t find that record</h1>
      <p className="max-w-md text-sm text-muted">It may have a different id, or you may not have access to it.</p>
      <Link href="/" className={buttonClass("outline", "sm", "mt-2")}>Back to overview</Link>
    </main>
  );
}
