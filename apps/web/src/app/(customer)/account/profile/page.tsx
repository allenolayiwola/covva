import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronRight, Download, FileText, LogOut, Megaphone, Shield } from "lucide-react";
import { formatDate, formatDateTime } from "@im/core";
import type { Enum } from "@im/db";
import { Card, PageHeader, Pill, buttonClass } from "@im/ui";
import { getProfile } from "@/lib/auth";
import { getSetting } from "@/lib/catalog";
import { signOut } from "@/app/(auth)/actions";
import { PageSkeleton } from "@/components/customer/skeletons";
import { account } from "../_lib/data";
import { ConsentToggle, NotificationsForm, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "Profile" };

const CONSENT_LABEL: Record<Enum<"consent_type">, { title: string; body: string; optional: boolean }> = {
  terms: { title: "Terms of use", body: "Needed to use the platform.", optional: false },
  privacy: { title: "Privacy notice", body: "How we handle your information.", optional: false },
  data_sharing_broker: { title: "Sharing with your broker of record", body: "Needed to request and service cover.", optional: false },
  data_sharing_insurer: { title: "Sharing with insurers you ask for quotes from", body: "Needed to quote, issue and handle claims.", optional: false },
  marketing: { title: "Tips and offers", body: "Occasional emails or texts. Unsubscribe any time.", optional: true },
  ai_assistance: { title: "AI-assisted help", body: "Lets the AI assistant explain your cover. It never decides suitability or claims.", optional: true },
};

export default function ProfilePage() {
  return (
    <>
      <PageHeader title="Profile" description="Your details, how we contact you and the consents you've given." />
      <Suspense fallback={<PageSkeleton rows={6} />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  const { user, supabase } = await account("/account/profile");
  const [profile, { data: consents }, brand] = await Promise.all([
    getProfile(),
    supabase.from("consents").select("id, type, version, granted, context, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
    getSetting<{ support_email?: string }>("brand"),
  ]);
  const latest = new Map<string, NonNullable<typeof consents>[number]>();
  for (const c of consents ?? []) if (!latest.has(c.type)) latest.set(c.type, c);
  const support = brand?.support_email ?? "support@covva.com.gh";
  const prefs = (profile?.notification_prefs ?? {}) as Record<string, boolean>;
  const exportSubject = encodeURIComponent("Privacy request");
  const exportBody = encodeURIComponent(`I'd like to make a privacy request about my personal data:\n\n\n\nAccount email: ${user.email ?? ""}\nAccount ID: ${user.id}`);

  return (
    <div className="space-y-10">
      <nav aria-label="More account pages" className="grid gap-2 sm:grid-cols-3 lg:hidden">
        {[
          { href: "/account/policies", label: "My policies", icon: Shield },
          { href: "/account/documents", label: "Documents", icon: FileText },
          { href: "/account/complaints", label: "Complaints", icon: Megaphone },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="flex items-center gap-3 rounded-card border border-line px-4 py-3 text-sm font-medium text-ink hover:bg-mist">
            <l.icon aria-hidden className="size-4 text-brand" /> {l.label}
            <ChevronRight aria-hidden className="ml-auto size-4 text-subtle" />
          </Link>
        ))}
      </nav>

      <section aria-labelledby="details">
        <h2 id="details" className="mb-4 text-lg font-semibold text-ink">Personal details</h2>
        <ProfileForm
          values={{
            full_name: profile?.full_name ?? "",
            preferred_name: profile?.preferred_name ?? "",
            email: profile?.email ?? user.email ?? "",
            phone: profile?.phone ?? "",
            region: profile?.region ?? "",
            city: profile?.city ?? "",
            date_of_birth: profile?.date_of_birth ?? "",
            account_type: profile?.account_type ?? "individual",
            business_name: profile?.business_name ?? "",
            ghana_card: profile?.ghana_card_number ?? "",
            kyc_status: profile?.kyc_status ?? "unverified",
            country_code: profile?.country_code ?? "GH",
            preferred_currency: profile?.preferred_currency ?? "GHS",
            timezone: profile?.timezone ?? "",
          }}
        />
      </section>

      <section aria-labelledby="notif">
        <h2 id="notif" className="mb-1 text-lg font-semibold text-ink">Notifications</h2>
        <p className="mb-4 text-sm text-muted">Choose how we let you know about quotes, documents, renewals and claims.</p>
        <NotificationsForm prefs={prefs} />
      </section>

      <section aria-labelledby="consents">
        <h2 id="consents" className="mb-1 text-lg font-semibold text-ink">Your consents</h2>
        <p className="mb-4 text-sm text-muted">Required consents keep your cover working. To withdraw them, contact support — we&apos;ll explain what it means for your policies.</p>
        <ul className="divide-y divide-line rounded-card border border-line">
          {(Object.keys(CONSENT_LABEL) as Enum<"consent_type">[]).map((t) => {
            const c = latest.get(t);
            const meta = CONSENT_LABEL[t];
            return (
              <li key={t} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{meta.title}</p>
                  <p className="text-sm text-muted">
                    {meta.body}
                    {c ? ` · ${c.granted ? "Given" : "Withdrawn"} ${formatDate(c.created_at)} (v${c.version})` : ""}
                  </p>
                </div>
                {c?.granted ? <Pill tone="ok">Given</Pill> : <Pill tone="neutral">Not given</Pill>}
                {meta.optional && <ConsentToggle type={t as "marketing" | "ai_assistance"} granted={!!c?.granted} />}
              </li>
            );
          })}
        </ul>
        {(consents?.length ?? 0) > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium text-brand">Consent history</summary>
            <ul className="mt-2 space-y-1 text-muted">
              {(consents ?? []).map((c) => (
                <li key={c.id}>
                  {formatDateTime(c.created_at)} · {CONSENT_LABEL[c.type].title} · {c.granted ? "given" : "withdrawn"} · v{c.version}
                  {c.context ? ` · ${c.context}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section aria-labelledby="data">
        <h2 id="data" className="mb-1 text-lg font-semibold text-ink">Your data</h2>
        <Card className="p-5">
          <p className="text-sm text-ink-2">
            Under Ghana&apos;s Data Protection Act you can ask for a copy of your data, ask us to correct it, object to how we use it, stop marketing, or ask
            us to delete it where we don&apos;t need to keep it by law. Insurers and brokers keep their own records of policies they issued or arranged.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link href="/account/privacy" className={buttonClass("secondary", "sm", "min-h-10")}>
              <Download aria-hidden className="size-4" /> Privacy &amp; your data
            </Link>
            <a href={`mailto:${support}?subject=${exportSubject}&body=${exportBody}`} className="inline-flex min-h-10 items-center text-sm font-medium text-brand hover:underline">
              Or email support
            </a>
          </div>
        </Card>
      </section>

      <form action={signOut}>
        <button type="submit" className={buttonClass("outline")}>
          <LogOut aria-hidden className="size-4" /> Sign out
        </button>
      </form>
    </div>
  );
}
