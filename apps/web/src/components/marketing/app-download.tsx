import { BellRing, FileText, QrCode as QrIcon, Wallet } from "lucide-react";
import { Eyebrow } from "@im/ui";
import { Section } from "./section";
import { PhoneMock } from "./phone-mock";
import { StoreBadges } from "./store-badges";
import { QrCode } from "./qr-code";

export const APP_LINK = "https://covva.com.gh/app";

/** App download section: store badges, a QR code to the app link, and the phone illustration. */
export function AppDownload({ insurers }: { insurers: string[] }) {
  return (
    <Section tone="mist" labelledBy="app-title" className="overflow-hidden">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div>
          <Eyebrow className="mb-3">The Covva app</Eyebrow>
          <h2 id="app-title" className="text-balance text-[30px] leading-[1.12] md:text-[42px] text-ink">
            Your policies, claims and renewals — in your pocket.
          </h2>
          <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-muted">
            Buy with MoMo, keep every certificate offline, report a claim with photos and get reminded before anything lapses. iOS and Android.
          </p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { icon: Wallet, title: "Cover wallet", body: "Certificates and wording, available offline." },
              { icon: FileText, title: "Claims with photos", body: "Report in minutes, follow every step." },
              { icon: BellRing, title: "Renewal reminders", body: "From 45 days out, with fresh quotes." },
            ].map((f) => (
              <li key={f.title} className="flex gap-3">
                <f.icon aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
                <div>
                  <p className="font-semibold text-ink">{f.title}</p>
                  <p className="text-[14px] leading-relaxed text-muted">{f.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-center">
            <StoreBadges />
            <div className="flex items-center gap-4 rounded-card border border-line bg-white p-3 pr-5">
              <QrCode value={APP_LINK} size={88} label={`QR code linking to ${APP_LINK}`} className="rounded-md" />
              <p className="text-[13px] leading-relaxed text-muted">
                <QrIcon aria-hidden className="mb-1 size-4 text-brand" />
                Scan with your phone camera to open <span className="font-medium text-ink">covva.com.gh/app</span>
              </p>
            </div>
          </div>
        </div>
        <div className="relative">
          <div aria-hidden className="absolute inset-0 m-auto size-[360px] rounded-full bg-mint-2 blur-2xl" />
          <PhoneMock className="relative" insurers={insurers} />
          <p className="sr-only">Illustration of the My cover screen in the Covva app: an active motor policy, quick actions for documents, claims and calling your broker, and a renewal reminder.</p>
        </div>
      </div>
    </Section>
  );
}
