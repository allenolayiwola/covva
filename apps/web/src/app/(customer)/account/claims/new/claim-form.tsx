"use client";
import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import {
  Car,
  Check,
  Droplets,
  Flame,
  Heart,
  Info,
  LayoutGrid,
  Luggage,
  MapPin,
  Plane,
  Scale,
  ShieldCheck,
  Ship,
  Stethoscope,
  Store,
  type LucideIcon,
} from "lucide-react";
import { CLAIM_DISCLAIMER, appendTranscript } from "@im/core";
import { Button, Field, Input, Notice, Textarea, cn } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { MultiUpload } from "@/components/customer/upload";
import { VideoUpload } from "@/components/customer/video-upload";
import { initialActionState } from "@/components/customer/utils";
import { reportClaim } from "../actions";
import { VoiceRecorder } from "@/components/voice-recorder";
import { useT } from "@/lib/i18n/client";

const ICONS: Record<string, LucideIcon> = {
  car: Car,
  shield: ShieldCheck,
  grid: LayoutGrid,
  info: Info,
  flame: Flame,
  droplets: Droplets,
  heart: Heart,
  luggage: Luggage,
  plane: Plane,
  stethoscope: Stethoscope,
  store: Store,
  scale: Scale,
  ship: Ship,
};

export interface ClaimPolicy {
  id: string;
  label: string;
  subtitle: string;
  categorySlug: string;
  incidents: { value: string; label: string; icon: string }[];
}

export function ClaimForm({ userId, policies, initialPolicyId }: { userId: string; policies: ClaimPolicy[]; initialPolicyId?: string }) {
  const [state, action] = useActionState(reportClaim, initialActionState);
  const [policyId, setPolicyId] = React.useState(initialPolicyId && policies.some((p) => p.id === initialPolicyId) ? initialPolicyId : "");
  const [step, setStep] = React.useState(policyId ? 2 : 1);
  const [incident, setIncident] = React.useState("");
  const [date, setDate] = React.useState("");
  const [time, setTime] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [gps, setGps] = React.useState<{ lat: number; lng: number; accuracy: number | null } | null>(null);
  const [gpsState, setGpsState] = React.useState<"idle" | "busy" | "denied">("idle");
  const [description, setDescription] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [thirdParty, setThirdParty] = React.useState("");
  const [voiceIds, setVoiceIds] = React.useState<string[]>([]);
  const t = useT();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const policy = policies.find((p) => p.id === policyId);
  const fe = { ...state.fieldErrors, ...errors };
  const today = new Date().toISOString().slice(0, 10);

  const [seenState, setSeenState] = React.useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state.fieldErrors?.incidentType || state.fieldErrors?.incidentDate) setStep(2);
    else if (state.fieldErrors?.description || state.fieldErrors?.amountClaimed) setStep(3);
  }

  function next() {
    const e: Record<string, string> = {};
    if (step === 1 && !policyId) e.policyId = "Choose the policy you're claiming on";
    if (step === 2) {
      if (!incident) e.incidentType = "Choose what happened";
      if (!date) e.incidentDate = "Enter the date it happened";
      else if (date > today) e.incidentDate = "The date can't be in the future";
    }
    if (step === 3 && description.trim().length < 10) e.description = "Describe what happened in a few sentences";
    setErrors(e);
    if (!Object.keys(e).length) {
      setStep((s) => Math.min(4, s + 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const incidentLabel = policy?.incidents.find((i) => i.value === incident)?.label;

  return (
    <form action={action} noValidate>
      <input type="hidden" name="policyId" value={policyId} />
      <input type="hidden" name="incidentType" value={incident} />
      <input type="hidden" name="lat" value={gps?.lat ?? ""} />
      <input type="hidden" name="lng" value={gps?.lng ?? ""} />
      {voiceIds.map((id) => (
        <input key={id} type="hidden" name="voiceNoteId" value={id} />
      ))}

      <div className="mb-6 flex items-center justify-between text-sm">
        <Link href={policy ? `/account/policies/${policy.id}` : "/account/claims"} className="font-medium text-brand hover:underline">{t("common.cancel")}</Link>
        <span className="text-muted">{t("claim.step", { step, total: 4 })}</span>
      </div>
      <ol className="mb-8 grid grid-cols-4 gap-2" aria-hidden>
        {[1, 2, 3, 4].map((n) => (
          <li key={n} className={cn("h-1.5 rounded-full", n <= step ? "bg-brand" : "bg-line")} />
        ))}
      </ol>

      {/* Step 1 — which policy */}
      <section hidden={step !== 1} aria-labelledby="s1">
        <h2 id="s1" className="text-[28px] font-bold tracking-tight text-ink">{t("claim.whichPolicy")}</h2>
        <p className="mt-1 text-muted">{t("claim.whichPolicyBody")}</p>
        <div className="mt-5 space-y-2" role="radiogroup" aria-label="Policy">
          {policies.map((p) => (
            <label
              key={p.id}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-card border p-4 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
                policyId === p.id ? "border-brand bg-mint-2/60" : "border-line hover:bg-mist",
              )}
            >
              <input type="radio" name="ui-policy" value={p.id} checked={policyId === p.id} onChange={() => setPolicyId(p.id)} className="sr-only" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">{p.label}</span>
                <span className="block text-sm text-muted">{p.subtitle}</span>
              </span>
              {policyId === p.id && <Check aria-hidden className="size-5 text-brand" />}
            </label>
          ))}
        </div>
        {fe.policyId && <p className="mt-2 text-xs text-danger">{fe.policyId}</p>}
      </section>

      {/* Step 2 — what happened (mobile-claim-report.jpg) */}
      <section hidden={step !== 2} aria-labelledby="s2">
        <h2 id="s2" className="text-[28px] font-bold tracking-tight text-ink">{t("claim.whatHappened")}</h2>
        {policy && <p className="mt-1 text-muted">{policy.subtitle}</p>}
        <div className="mt-5 grid grid-cols-2 gap-3" role="radiogroup" aria-label="What happened">
          {(policy?.incidents ?? []).map((i) => {
            const Icon = ICONS[i.icon] ?? Info;
            const on = incident === i.value;
            return (
              <label
                key={i.value}
                className={cn(
                  "relative flex min-h-28 cursor-pointer flex-col justify-between rounded-card border p-4 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
                  on ? "border-brand bg-mint-2/60 text-brand-deep" : "border-line text-ink hover:bg-mist",
                )}
              >
                <input type="radio" name="ui-incident" value={i.value} checked={on} onChange={() => setIncident(i.value)} className="sr-only" />
                <Icon aria-hidden className="size-6" />
                <span className="mt-3 text-[17px] font-medium">{i.label}</span>
                {on && <Check aria-hidden className="absolute right-4 top-4 size-5 text-brand" />}
              </label>
            );
          })}
        </div>
        {fe.incidentType && <p className="mt-2 text-xs text-danger">{fe.incidentType}</p>}

        <div className="mt-5 divide-y divide-line rounded-card border border-line">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <label htmlFor="incidentDate" className="text-ink">{t("claim.date")}</label>
            <div className="flex gap-2">
              <Input id="incidentDate" name="incidentDate" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className="h-10 w-40" aria-invalid={!!fe.incidentDate} />
              <label htmlFor="incidentTime" className="sr-only">{t("claim.time")}</label>
              <Input id="incidentTime" name="incidentTime" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-10 w-28" />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <label htmlFor="location" className="text-ink">{t("claim.location")}</label>
            <div className="relative w-full sm:w-72">
              <MapPin aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand" />
              <Input id="location" name="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Spintex Road, Accra" className="h-10 pl-9" maxLength={300} />
            </div>
          </div>
        </div>
        {fe.incidentDate && <p className="mt-2 text-xs text-danger">{fe.incidentDate}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-brand hover:underline disabled:opacity-60"
            disabled={gpsState === "busy"}
            onClick={() => {
              if (!("geolocation" in navigator)) return setGpsState("denied");
              setGpsState("busy");
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  setGps({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)), accuracy: pos.coords.accuracy ? Math.round(pos.coords.accuracy) : null });
                  setGpsState("idle");
                },
                () => setGpsState("denied"),
                { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
              );
            }}
          >
            <MapPin aria-hidden className="size-3.5" /> {gpsState === "busy" ? "Finding your location…" : gps ? "Update my location" : "Use my current location"}
          </button>
          {gps && <span>Pinned {gps.lat}, {gps.lng}{gps.accuracy ? ` (±${gps.accuracy} m)` : ""} · <button type="button" className="underline" onClick={() => setGps(null)}>remove</button></span>}
          {gpsState === "denied" && <span>Location not available — type the address instead.</span>}
        </div>

        <div className="mt-6">
          <MultiUpload userId={userId} scope="claims" name="evidence" label="Photos and evidence" tiles max={10} hint="Photos, police report, receipts · PDF, JPG or PNG · up to 10 MB each" />
        </div>
        <div className="mt-5">
          <VideoUpload userId={userId} name="video" />
        </div>
        <Notice tone="neutral" icon={<Info className="size-4" />} className="mt-6">{CLAIM_DISCLAIMER}</Notice>
      </section>

      {/* Step 3 — details */}
      <section hidden={step !== 3} aria-labelledby="s3" className="space-y-5">
        <h2 id="s3" className="text-[28px] font-bold tracking-tight text-ink">{t("claim.tellUsMore")}</h2>
        <Field label={t("claim.descriptionLabel")} htmlFor="description" error={fe.description} hint={t("claim.descriptionHint")}>
          <Textarea id="description" name="description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} className="min-h-40" aria-invalid={!!fe.description} />
        </Field>
        <VoiceRecorder
          purpose="claim_description"
          titleKey="voice.claimTitle"
          onUseTranscript={(text) => setDescription((d) => appendTranscript(d, text).slice(0, 5000))}
          onSaved={(id) => setVoiceIds((ids) => (ids.includes(id) ? ids : [...ids, id].slice(-5)))}
        />
        <Field label={<>{t("claim.amountLabel")} <span className="font-normal text-subtle">{t("claim.ifKnown")}</span></>} htmlFor="amountClaimed" error={fe.amountClaimed}>
          <div className="flex">
            <span className="inline-flex items-center rounded-l-field border border-r-0 border-line bg-mist px-3 text-sm text-muted">GH₵</span>
            <Input id="amountClaimed" name="amountClaimed" type="number" inputMode="decimal" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="rounded-l-none" />
          </div>
        </Field>
        <Field label={<>{t("claim.othersLabel")} <span className="font-normal text-subtle">{t("common.optional")}</span></>} htmlFor="thirdParty" hint={t("claim.othersHint")}>
          <Textarea id="thirdParty" name="thirdParty" value={thirdParty} onChange={(e) => setThirdParty(e.target.value)} maxLength={500} className="min-h-20" />
        </Field>
      </section>

      {/* Step 4 — review */}
      <section hidden={step !== 4} aria-labelledby="s4" className="space-y-5">
        <h2 id="s4" className="text-[28px] font-bold tracking-tight text-ink">{t("claim.checkAndSend")}</h2>
        <dl className="divide-y divide-line rounded-card border border-line px-4 text-sm">
          {[
            ["Policy", policy?.label],
            ["What happened", incidentLabel],
            ["When", date ? `${date}${time ? ` ${time}` : ""}` : "—"],
            ["Where", location || "—"],
            ["Estimated cost", amount ? `GH₵ ${Number(amount).toLocaleString("en-GH")}` : "Not known yet"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-3">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-medium text-ink">{v}</dd>
            </div>
          ))}
          <div className="py-3">
            <dt className="text-muted">Description</dt>
            <dd className="mt-1 whitespace-pre-wrap text-ink">{description}</dd>
          </div>
        </dl>
        <Notice tone="wait" icon={<Info className="size-4" />} title={t("claim.notApproval")}>
          {CLAIM_DISCLAIMER} Your broker checks your report and sends it to the insurer; we&apos;ll show when the insurer has it.
        </Notice>
      </section>

      <FormMessage state={state} className="mt-6" />
      <div className="mt-8 flex gap-3">
        {step > (initialPolicyId ? 2 : 1) && (
          <Button type="button" variant="outline" size="lg" onClick={() => setStep((s) => s - 1)}>{t("common.back")}</Button>
        )}
        {step < 4 ? (
          <Button type="button" size="lg" className="flex-1" onClick={next}>{t("common.continue")}</Button>
        ) : (
          <SubmitButton size="lg" className="flex-1" pendingText={t("common.sending")}>{t("claim.submit")}</SubmitButton>
        )}
      </div>
    </form>
  );
}
