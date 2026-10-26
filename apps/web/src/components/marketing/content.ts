/**
 * Long-form marketing copy shared between pages (FAQ, help centre, home preview).
 * Plain strings only so it can be passed to client components and JSON-LD.
 */
export interface FaqItem { id: string; q: string; a: string }
export interface FaqGroup { id: string; title: string; items: FaqItem[] }

export const FAQ_GROUPS: FaqGroup[] = [
  {
    id: "quotes",
    title: "Getting quotes",
    items: [
      {
        id: "what-is",
        q: "What is COVVA?",
        a: "We are a technology platform that helps you explore, compare and manage insurance in Ghana. Licensed brokers advise you and arrange your cover, and licensed insurers underwrite and issue your policy. We are not an insurer or a broker, we do not give insurance advice in our own name, and we never hold your premium.",
      },
      {
        id: "cost",
        q: "Does it cost anything to use?",
        a: "Exploring cover, using Help me choose and requesting quotes are free. You pay the premium the insurer sets. Your broker is paid commission by the insurer, and we show you how that works before you apply.",
      },
      {
        id: "how-many",
        q: "Do you compare every insurer in Ghana?",
        a: "No. We compare products from participating insurers only, and every comparison tells you how many insurers and products were included. We never claim to cover the whole market.",
      },
      {
        id: "quote-states",
        q: "What do “Estimate”, “Awaiting underwriting” and “Ready to accept” mean?",
        a: "An estimate is an indicative price from approved rates — it is not an offer. Awaiting underwriting means the insurer is reviewing your details and the price may change. Ready to accept is a binding offer you can apply for until the date shown. Only “Ready to accept” quotes can be applied for.",
      },
      {
        id: "broker",
        q: "Who is my broker and why do I need one?",
        a: "Every request has one named broker of record, licensed by the National Insurance Commission. We tell you who it is before any advice or application. Your broker checks your needs, prepares quotes with insurers, and helps with renewals, complaints and claims.",
      },
      {
        id: "how-long",
        q: "How long do quotes take?",
        a: "Some categories show estimates straight away. Binding quotes depend on the insurer and the details they need — your broker gives you a realistic time and you can track progress in your account. We never promise instant cover.",
      },
    ],
  },
  {
    id: "paying",
    title: "Paying",
    items: [
      {
        id: "methods",
        q: "How can I pay?",
        a: "You can pay by mobile money or card through an authorised payment provider. Payment goes directly to the insurer — we never hold your premium.",
      },
      {
        id: "paid-active",
        q: "I’ve paid. Am I covered now?",
        a: "Not yet. Payment confirmation alone never makes a policy active. Your cover starts when the insurer confirms acceptance and issues your policy. You will see the status change in your account and receive your documents.",
      },
      {
        id: "price-changed",
        q: "Why did the price change at checkout?",
        a: "Quotes are checked again at checkout. If a quote has expired or the insurer has updated it, we show you the new position before you pay — you are never charged a price you did not see.",
      },
      {
        id: "refunds",
        q: "What if the insurer declines after I pay?",
        a: "If an insurer does not accept the risk, your broker will explain why and the payment is refunded to the original method according to the insurer’s and payment provider’s procedures.",
      },
    ],
  },
  {
    id: "policies",
    title: "Policies & documents",
    items: [
      {
        id: "wallet",
        q: "Where are my policy documents?",
        a: "Every policy you arrange through us appears in your cover wallet with the schedule, certificate and wording issued by the insurer. You can download them at any time, including on a slow connection.",
      },
      {
        id: "add-existing",
        q: "Can I add a policy I bought elsewhere?",
        a: "Not yet. For now the wallet shows policies arranged through participating brokers. We plan to let you add other policies for reminders in a later release.",
      },
      {
        id: "changes",
        q: "How do I change my policy?",
        a: "Send a service request from your account or message your broker. Changes are confirmed by the insurer and may affect your premium.",
      },
    ],
  },
  {
    id: "renewals",
    title: "Renewals",
    items: [
      {
        id: "reminders",
        q: "Will you remind me before my cover ends?",
        a: "Yes. We send reminders 45, 30, 14, 7 and 1 day before your cover ends, and your broker reviews whether anything has changed.",
      },
      {
        id: "renewal-price",
        q: "Is the renewal price fixed?",
        a: "No. Renewal price ranges are always labelled as estimates until the insurer confirms the renewal terms.",
      },
      {
        id: "switch",
        q: "Can I switch insurer at renewal?",
        a: "Yes. A switch request starts a review. Your existing cover is never cancelled until the replacement has been accepted, the start date is confirmed and payment has gone through.",
      },
    ],
  },
  {
    id: "claims",
    title: "Claims",
    items: [
      {
        id: "how-claim",
        q: "How do I make a claim?",
        a: "Report it from your cover wallet as soon as you can. Your broker helps you collect the right evidence and submits it to the insurer. You can follow every step in your account.",
      },
      {
        id: "who-decides",
        q: "Who decides my claim?",
        a: "The insurer. Reporting a claim does not mean it is approved, and uploading documents does not mean the insurer has received them until delivery is confirmed. We show you each of these steps clearly.",
      },
      {
        id: "declined",
        q: "What if my claim is declined?",
        a: "Ask your broker to explain the decision and the policy terms it relies on. If you are not satisfied, you can raise a complaint, and escalate it to the National Insurance Commission if needed.",
      },
    ],
  },
  {
    id: "complaints",
    title: "Complaints",
    items: [
      {
        id: "raise",
        q: "How do I complain?",
        a: "Raise a complaint from your account, by email or through the contact form. We route it to the right party — your broker, the insurer or our own team — acknowledge it promptly and aim to resolve it within 14 days.",
      },
      {
        id: "escalate",
        q: "Can I escalate to the regulator?",
        a: "Yes. If your complaint is not resolved to your satisfaction, you can contact the Complaints Bureau of the National Insurance Commission (NIC). We explain how in our complaints procedure.",
      },
    ],
  },
  {
    id: "account",
    title: "Account & privacy",
    items: [
      {
        id: "data",
        q: "What do you do with my data?",
        a: "We use your information to arrange and service your insurance, and share it only with your broker, the insurers you ask for quotes and the payment provider. We process it under Ghana’s Data Protection Act, 2012 (Act 843). We do not sell your data.",
      },
      {
        id: "same-risk",
        q: "Will my details be sent to lots of insurers?",
        a: "No. Your broker approaches only the insurers relevant to your request, and our systems prevent the same risk from being submitted to the same insurer twice.",
      },
      {
        id: "delete",
        q: "Can I delete my account?",
        a: "Yes. You can ask us to close your account and delete your data. Some records must be kept for a period by law or by the insurer — we tell you which and for how long.",
      },
      {
        id: "ai",
        q: "Do you use AI?",
        a: "We use AI to explain, summarise and draft — for example to explain a policy term in plain language. AI never decides what cover is suitable for you or whether a claim is paid, and AI-assisted content is labelled.",
      },
    ],
  },
];

export const HOME_FAQ_IDS = ["what-is", "how-many", "paid-active", "who-decides", "cost"];

export function findFaq(ids: string[]): FaqItem[] {
  const all = FAQ_GROUPS.flatMap((g) => g.items);
  return ids.map((id) => all.find((i) => i.id === id)).filter((x): x is FaqItem => !!x);
}

export const REGULATION = {
  nic: { name: "National Insurance Commission (NIC)", url: "https://nic.gov.gh" },
  act1061: "Insurance Act, 2021 (Act 1061)",
  act843: "Data Protection Act, 2012 (Act 843)",
  dpc: { name: "Data Protection Commission", url: "https://dataprotection.org.gh" },
};
