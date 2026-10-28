import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Car, Gauge, ShieldCheck } from "lucide-react";
import { TELEMATICS_FACTOR_LABEL, formatDate, formatDateTime, drivingScoreBand, type TelematicsFactor } from "@im/core";
import { Card, Notice, PageHeader, Pill, StatCard, buttonClass } from "@im/ui";
import { getFlags } from "@/lib/catalog";
import { ListSkeleton } from "@/components/customer/skeletons";
import { telematicsOverview } from "@/server/telematics";
import { account, requestTime } from "../_lib/data";
import { EnrolForm, WithdrawForm } from "./forms";

export const metadata: Metadata = { title: "Driving score" };

export default function TelematicsPage() {
  return (
    <>
      <PageHeader title="Driving score" description="Optional. Share trip summaries from your phone and your insurer can reward safe driving at renewal. No GPS route is ever stored, and you can stop at any time." />
      <Suspense fallback={<ListSkeleton rows={3} />}>
        <Telematics />
      </Suspense>
    </>
  );
}

function ScoreRing({ score }: { score: number | null }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0.02, score / 100);
  const band = drivingScoreBand(score);
  const stroke = band.tone === "ok" ? "var(--color-brand)" : band.tone === "wait" ? "var(--color-gold)" : band.tone === "danger" ? "var(--color-danger)" : "var(--color-line)";
  return (
    <svg viewBox="0 0 100 100" className="size-28 shrink-0" role="img" aria-label={score === null ? "No score yet" : `Driving score ${score} out of 100`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-mint)" strokeWidth="9" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={stroke} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="fill-ink text-[26px] font-bold">{score === null ? "—" : score}</text>
    </svg>
  );
}

async function Telematics() {
  const { user, supabase } = await account("/account/telematics");
  const [data, flags] = await Promise.all([telematicsOverview(supabase, user.id, new Date(requestTime())), getFlags()]);
  const active = data.enrolments.filter((e) => e.status === "active");
  const policyById = new Map(data.policies.map((p) => [p.id, p]));

  return (
    <div className="space-y-6" data-testid="telematics-page">
      {flags.demo_mode && <Pill tone="wait">DEMO · illustrative insurers</Pill>}
      {data.policies.length === 0 && (
        <Notice tone="info" icon={<Car className="size-4" aria-hidden />}>
          Driving scoring works with motor policies arranged through Covva. You don&apos;t have one yet.{" "}
          <Link href="/get-started?category=motor" className="font-semibold underline">Get a motor quote</Link>
        </Notice>
      )}

      {active.map((e) => {
        const policy = policyById.get(e.policyId);
        const latestFinal = e.months.find((m) => m.final && m.score !== null) ?? null;
        const shown = latestFinal ? { score: latestFinal.score, label: `Last full month (${formatDate(latestFinal.period)})` } : { score: e.current.score, label: "This month so far (provisional)" };
        const band = drivingScoreBand(shown.score);
        const factors = latestFinal ? (latestFinal.factors as Record<TelematicsFactor, { score: number; detail: string }>) : e.current.factors;
        return (
          <Card key={e.id} className="p-5" data-testid="telematics-enrolment">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted">{policy?.label ?? "Motor policy"} · {policy?.insurerName ?? "Insurer"}</p>
                <h2 className="text-lg font-semibold text-ink">Your driving score</h2>
              </div>
              <Pill tone={band.tone}>{band.label}</Pill>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-5">
              <ScoreRing score={shown.score} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted">{shown.label}</p>
                {e.summary ? (
                  <p className="text-[15px] text-ink">Average <span className="font-semibold">{e.summary.averageScore}</span> over {e.summary.monthsOfData} scored month{e.summary.monthsOfData === 1 ? "" : "s"}. Your insurer sees these monthly scores only — never your trips.</p>
                ) : (
                  <p className="text-[15px] text-ink">Your first monthly score needs at least {data.scoring.minTrips} trips and {data.scoring.minDistanceKm} km in a month. Keep the app on your phone and drive as usual.</p>
                )}
                <p className="mt-1 text-[13px] text-muted">Enrolled {formatDate(e.enrolledAt)} · {e.trips.last30Days} trip{e.trips.last30Days === 1 ? "" : "s"} ({e.trips.distanceKm30Days} km) in the last 30 days · {e.trips.total} in total{e.trips.lastTripAt ? ` · last trip ${formatDateTime(e.trips.lastTripAt)}` : ""}</p>
              </div>
            </div>
            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
              {(Object.keys(TELEMATICS_FACTOR_LABEL) as TelematicsFactor[]).map((k) => (
                <div key={k} className="rounded-card border border-line p-3">
                  <dt className="flex items-center justify-between text-sm"><span className="font-medium text-ink">{TELEMATICS_FACTOR_LABEL[k]}</span><span className="tabular-nums text-ink">{factors[k]?.score ?? "—"}<span className="text-muted">/100</span></span></dt>
                  <dd className="mt-1 text-[13px] text-muted">{factors[k]?.detail ?? "No trips yet"} · weight {Math.round(data.scoring.weights[k] * 100)}%</dd>
                </div>
              ))}
            </dl>
            {e.months.length > 0 && (
              <div className="mt-5">
                <h3 className="text-sm font-semibold text-ink">Monthly scores</h3>
                <ul className="mt-2 divide-y divide-line rounded-card border border-line text-sm">
                  {e.months.map((m) => (
                    <li key={m.period} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span className="text-ink">{formatDate(m.period)}{m.final ? "" : " (provisional)"} · {m.trips} trip{m.trips === 1 ? "" : "s"}, {m.distanceKm} km</span>
                      <span className="tabular-nums font-semibold text-ink">{m.score === null ? "Not enough trips" : m.score}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <WithdrawForm enrolmentId={e.id} />
              <Link href="/account/loyalty" className={buttonClass("ghost", "sm")}><Gauge aria-hidden className="size-4" /> See renewal perks</Link>
            </div>
          </Card>
        );
      })}

      {data.policies.filter((p) => !p.enrolment || p.enrolment.status !== "active").map((p) => (
        <Card key={p.id} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-muted">{p.insurerName} · Policy {p.policyNumber}</p>
              <h2 className="text-lg font-semibold text-ink">{p.label}</h2>
            </div>
            {p.enrolment?.status === "withdrawn" && <Pill>Stopped {p.enrolment.withdrawnAt ? formatDate(p.enrolment.withdrawnAt) : ""}</Pill>}
          </div>
          <p className="mt-2 text-sm text-ink-2">
            {p.enrolment?.status === "withdrawn" ? "You stopped driving scoring on this policy. You can start again with a fresh consent." : "Not enrolled. Read what is collected and agree below to start."}
          </p>
          <details className="mt-3" open={data.policies.length === 1 && !p.enrolment}>
            <summary className="cursor-pointer text-sm font-semibold text-brand">Start driving scoring for this policy</summary>
            <div className="mt-3"><EnrolForm policyId={p.id} policyLabel={p.label} /></div>
          </details>
        </Card>
      ))}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Consent" value={data.consent.granted ? "Given" : "Not given"} hint={data.consent.at ? `${data.consent.granted ? "Given" : "Withdrawn"} ${formatDate(data.consent.at)}` : "Recorded when you enrol"} />
        <StatCard label="How your score is worked out" value="Same rules for everyone" hint="Speed, harsh braking, night driving and phone use, weighted the same way for every driver" />
        <StatCard label="Stored" value="Summaries only" hint="No GPS trace, ever" />
      </div>
      <p className="flex items-start gap-2 text-[13px] text-muted"><ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" /> Your insurer sees monthly scores for the policy it insures, never trips. Your broker sees neither. A discount at renewal is the insurer&apos;s decision and is shown line by line on the renewal quote.</p>
    </div>
  );
}
