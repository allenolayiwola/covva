import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock3, FileCheck2, HeartHandshake, MessageSquareText, ShieldCheck, Star } from "lucide-react";
import { COMPONENT_WEIGHTS, SCORECARD_MIN_REVIEWS, SCORECARD_MIN_SAMPLES } from "@im/core";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, FeatureCard, Section, SectionHeading } from "@/components/marketing/section";
import { textLinkClass } from "@/components/marketing/ui-classes";

export const metadata: Metadata = {
  title: "How we calculate broker scores",
  description: "What goes into a broker's rating and response-time band on Covva, how reviews are checked, and what we never show.",
  alternates: { canonical: "/partners/how-we-score" },
};

const COMPONENTS = [
  { icon: <Clock3 className="size-5" />, title: "First response", weight: COMPONENT_WEIGHTS.response, body: "How long it takes the broker to send a first message, task or estimate after you submit a request. Measured as a median, so one slow day does not swing it." },
  { icon: <FileCheck2 className="size-5" />, title: "Quote fulfilment", weight: COMPONENT_WEIGHTS.fulfilment, body: "The share of requests that reach a binding quote, and how quickly. Requests you cancel are not held against the broker." },
  { icon: <ShieldCheck className="size-5" />, title: "Policy issuance", weight: COMPONENT_WEIGHTS.issuance, body: "Time from your confirmed payment to the insurer issuing the policy. The broker chases the insurer; the insurer issues." },
  { icon: <HeartHandshake className="size-5" />, title: "Claims support", weight: COMPONENT_WEIGHTS.claims, body: "How quickly claims the broker supports are acknowledged and settled. Decisions are always the insurer's." },
  { icon: <MessageSquareText className="size-5" />, title: "Service levels", weight: COMPONENT_WEIGHTS.sla, body: "The share of requests handled within the agreed response targets." },
  { icon: <Star className="size-5" />, title: "Customer ratings", weight: COMPONENT_WEIGHTS.ratings, body: `Star ratings from verified customers after a completed request or a settled claim. Shown from ${SCORECARD_MIN_REVIEWS} approved reviews.` },
];

export default function HowWeScorePage() {
  return (
    <>
      <PageHero
        breadcrumb={[{ label: "Participating partners", href: "/partners" }, { label: "How we calculate broker scores" }]}
        eyebrow="Broker scorecards"
        title="How we calculate this"
        lede="Every broker on Covva has a scorecard built from what actually happened on the platform: how fast they replied, whether quotes arrived, how claims went, and what verified customers said. Here is exactly what goes in and what you see."
      />

      <Section labelledBy="what-you-see">
        <SectionHeading id="what-you-see" title="What you see next to a broker" description="Three things, and only three." />
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <FeatureCard icon={<Star className="size-5" />} title="Average rating">
            The average of approved customer ratings (1 to 5 stars). It appears once a broker has {SCORECARD_MIN_REVIEWS} approved reviews; before that we show how many reviews exist.
          </FeatureCard>
          <FeatureCard icon={<MessageSquareText className="size-5" />} title="Number of reviews">
            How many approved reviews the rating is based on. More reviews, more reliable.
          </FeatureCard>
          <FeatureCard icon={<Clock3 className="size-5" />} title="Response-time band">
            “Usually replies within an hour”, “the same day”, “within a day” or “can take more than a day”, from the median first response over the last 90 days (from {SCORECARD_MIN_SAMPLES} measured requests).
          </FeatureCard>
        </div>
      </Section>

      <Section tone="mist" labelledBy="components">
        <SectionHeading id="components" title="What goes into the full scorecard" description="Brokers see a 0–100 score made of six parts. Each part has a weight; parts without enough history are left out and their weight is shared by the rest, so a new broker is never penalised for being new." />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {COMPONENTS.map((c) => (
            <FeatureCard key={c.title} icon={c.icon} title={<>{c.title} <span className="text-sm font-normal text-muted">· weight {c.weight}</span></>}>{c.body}</FeatureCard>
          ))}
        </div>
      </Section>

      <Section labelledBy="reviews">
        <SectionHeading id="reviews" title="How reviews work" />
        <CheckList
          className="mt-8 max-w-3xl"
          items={[
            <>Only the customer on a completed request or a settled claim can rate the broker of record, once per request or claim.</>,
            <>Every review is checked by Covva before it is shown. We hide reviews that contain personal details, abuse or claims we cannot verify, and we record the reason.</>,
            <>Reviews are shown with the customer&apos;s first name and initial (“Ama K.”) or as “Verified customer”. We never show contact details, policy numbers or claim details.</>,
            <>A broker can reply once to each review. Replies are public and are checked the same way.</>,
            <>Ratings and review text cannot be edited by anyone after they are sent. A hidden review still counts in the broker&apos;s private scorecard.</>,
          ]}
        />
      </Section>

      <Section tone="mist" labelledBy="routing">
        <SectionHeading id="routing" title="How scores affect who gets your request" />
        <div className="mt-8 max-w-3xl space-y-4 text-[15px] leading-relaxed text-muted">
          <p>
            When you don&apos;t choose a broker yourself, Covva offers your request to licensed brokers who hold a verified appointment with the insurer for your type of cover. Their order is decided first by category, licence, insurer appointments, location and capacity.
          </p>
          <p>
            The 90-day scorecard then nudges that order within a small, fixed limit: an excellent score can move a broker up by at most a few places, a poor one down by the same. It never overrides licence or appointment rules, and brokers without a score yet are treated as neutral. Nobody can pay Covva to rank higher.
          </p>
          <p>
            Covva is a technology provider. We are not an insurer or a broker, and scores are indicators of service, not advice.
          </p>
        </div>
        <Link href="/partners" className={`${textLinkClass} mt-8`}>Back to participating partners <ArrowRight aria-hidden className="size-4" /></Link>
      </Section>
    </>
  );
}
