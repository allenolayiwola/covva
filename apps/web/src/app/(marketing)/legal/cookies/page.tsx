import type { Metadata } from "next";
import Link from "next/link";
import { getBrand } from "@/components/marketing/brand";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Cookies",
  description: "The cookies and similar technologies Covva uses and how to control them. Draft — subject to legal review.",
  alternates: { canonical: "/legal/cookies" },
};

export default async function CookiesPage() {
  const brand = await getBrand();
  const rows = [
    { name: "sb-…-auth-token", purpose: "Keeps you signed in securely", type: "Strictly necessary", duration: "Session / up to 1 week" },
    { name: "Session storage: im:needs:v1", purpose: "Remembers your Help me choose answers in this tab", type: "Functional (stays on your device)", duration: "Until you close the tab" },
    { name: "Form drafts", purpose: "Saves request forms so you can resume on a slow connection", type: "Functional", duration: "Until submitted or [90] days" },
    { name: "covva_consent", purpose: "Remembers your cookie choice (analytics or essential only)", type: "Strictly necessary", duration: "180 days" },
    { name: "covva_lang", purpose: "Remembers your preferred language on the Learn pages", type: "Functional", duration: "1 year" },
    { name: "Session storage: covva:app-banner:dismissed", purpose: "Remembers that you closed the Android app banner", type: "Functional (stays on your device)", duration: "Until you close the browser" },
    { name: "_ga, _ga_*", purpose: "Google Analytics 4 — only after you accept analytics in the consent banner; IP addresses anonymised", type: "Analytics (consent required)", duration: "Up to 2 years" },
  ];

  return (
    <LegalPage
      current="/legal/cookies"
      title="Cookies"
      summary={<>We use as few cookies as possible: what is needed to keep you signed in, to save your progress and to remember your choices. Analytics loads only after you accept it in the consent banner. We do not use advertising cookies or tracking pixels.</>}
      sections={[
        {
          id: "what",
          title: "What cookies are",
          body: <p>Cookies are small files stored by your browser. Similar technologies, such as local and session storage, keep information on your device. We refer to all of these as “cookies”.</p>,
        },
        {
          id: "which",
          title: "Cookies we use",
          body: (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-mist text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Name</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Purpose</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Type</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.name} className="border-t border-line align-top">
                      <td className="px-4 py-3 font-mono text-[13px] text-ink">{r.name}</td>
                      <td className="px-4 py-3">{r.purpose}</td>
                      <td className="px-4 py-3">{r.type}</td>
                      <td className="px-4 py-3">{r.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
        {
          id: "analytics",
          title: "Analytics",
          body: <p>Where analytics is configured we use Google Analytics 4 with IP anonymisation. It loads only after you choose “Accept analytics” in the consent banner, in line with the Data Protection Act, 2012 (Act 843). Choosing “Essential only” keeps analytics off. You can change your mind by clearing the <code>covva_consent</code> cookie in your browser, after which the banner appears again.</p>,
        },
        {
          id: "control",
          title: "How to control cookies",
          body: <p>You can block or delete cookies in your browser settings. If you block strictly necessary cookies you will not be able to sign in. Closing the browser tab clears session storage.</p>,
        },
        {
          id: "contact",
          title: "Questions",
          body: <p>See our <Link href="/legal/privacy">privacy notice</Link> or email <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.</p>,
        },
      ]}
    />
  );
}
