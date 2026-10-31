import Link from "next/link";
import { CirclePlus, FileText, LockKeyhole, Scale } from "lucide-react";
import { Container } from "@im/ui";

/** Role explanations only: no partner logos, endorsement badges or unverified claims. */
export function TrustBar({ tone = "white" }: { tone?: "white" | "mist" } = {}) {
  return (
    <section aria-labelledby="trust-bar-title" className={tone === "mist" ? "bg-mist" : "bg-white"}>
      <Container className="py-12">
        <h2 id="trust-bar-title" className="sr-only">How trust works at Covva</h2>
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {[
            { Icon: CirclePlus, title: "A technology platform", body: "Covva compares and manages. It is not an insurer or broker.", href: "/trust#roles" },
            { Icon: Scale, title: "NIC-licensed partners", body: "Licensed insurers and brokers sell the policies.", href: "https://nic.gov.gh" },
            { Icon: LockKeyhole, title: "Paystack payments", body: "MoMo or card. Paystack splits each payment.", href: "/trust#payments" },
            { Icon: FileText, title: "Act 843", body: "Your data is handled under Ghana’s Data Protection Act.", href: "/trust#data" },
          ].map(({ Icon, title, body, href }) => (
            <li key={title} className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-white text-brand">
                <Icon aria-hidden className="size-5" />
              </span>
              <div>
                <Link href={href} className="rounded text-[15px] font-semibold text-ink underline-offset-4 hover:underline">{title}</Link>
                <p className="mt-1 text-sm leading-relaxed text-muted [text-wrap:pretty]">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
