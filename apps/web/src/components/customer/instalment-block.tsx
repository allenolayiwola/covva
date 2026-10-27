import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { SCHEDULE_STATE_LABEL, instalmentProgressLine } from "@im/core";
import { Card, Pill, buttonClass } from "@im/ui";
import { scheduleForPolicy } from "@/server/instalments";

/**
 * Policy detail: "Instalments: 3 of 12 paid · next GH₵ X on <date>" when the premium is paid in
 * instalments. The caller has already checked the user can see the policy.
 */
export async function InstalmentBlock({ policyId }: { policyId: string }) {
  const schedule = await scheduleForPolicy(policyId).catch(() => null);
  if (!schedule) return null;
  const meta = SCHEDULE_STATE_LABEL[schedule.state.state];
  return (
    <Card className="flex flex-wrap items-center gap-4 p-5" aria-label="Instalments">
      <span className="grid size-11 place-items-center rounded-xl bg-mint-2 text-brand">
        <CalendarClock aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{instalmentProgressLine(schedule.state)}</p>
        <p className="text-sm text-muted">Each payment goes to the insurer in cedis. Grace and lapse follow the insurer&apos;s plan.</p>
      </div>
      <Pill tone={meta.tone}>{meta.label}</Pill>
      <Link href="/account/payments/instalments" className={buttonClass("secondary", "sm")}>{schedule.state.arrears > 0 || schedule.state.state === "lapsed" ? "Pay now" : "View schedule"}</Link>
    </Card>
  );
}
