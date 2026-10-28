import Link from "next/link";
import { ArrowRight, CircleHelp, Compass, Layers } from "lucide-react";
import { Container, Eyebrow, buttonClass } from "@im/ui";

export default function MarketingNotFound() {
  const links = [
    { href: "/explore", icon: Layers, title: "Explore cover", body: "Every category, what it covers and how available it is." },
    { href: "/get-started", icon: Compass, title: "Help me choose", body: "A few questions to find the cover worth considering." },
    { href: "/support", icon: CircleHelp, title: "Help centre", body: "Answers about quotes, payments, policies and claims." },
  ];
  return (
    <div className="bg-gradient-to-b from-mist to-white">
      <Container className="py-20 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>Page not found</Eyebrow>
          <h1 className="mt-4 text-[38px] font-bold leading-tight tracking-[-0.035em] text-ink sm:text-[52px]">We couldn’t find that page.</h1>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">It may have moved, or the link may be incomplete. These might help:</p>
        </div>
        <ul className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-3">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="group flex h-full flex-col rounded-card border border-line bg-white p-6 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                <l.icon aria-hidden className="size-6 text-brand" />
                <span className="mt-4 flex items-center justify-between font-semibold text-ink">
                  {l.title}
                  <ArrowRight aria-hidden className="size-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-brand motion-reduce:transition-none" />
                </span>
                <span className="mt-1 text-sm leading-relaxed text-muted">{l.body}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-10 text-center">
          <Link href="/" className={buttonClass("primary", "lg")}>Back to home</Link>
        </div>
      </Container>
    </div>
  );
}
