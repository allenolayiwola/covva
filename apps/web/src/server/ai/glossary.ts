/** Plain-language glossary used by the assistant's `explainTerm` tool. */
export const GLOSSARY: Record<string, { term: string; meaning: string; example?: string }> = {
  excess: { term: "Excess", meaning: "The part of each claim you pay yourself. The insurer pays the rest, up to the policy limits. A higher excess usually means a lower premium.", example: "With a GH₵ 1,000 excess and a GH₵ 6,000 repair, the insurer pays up to GH₵ 5,000." },
  deductible: { term: "Deductible", meaning: "Another word for excess: the amount you pay towards a claim before the insurer pays." },
  sum_insured: { term: "Sum insured", meaning: "The maximum amount the insurer will pay for the item or benefit covered. If it is set too low you may be under-insured and receive less after a loss." },
  premium: { term: "Premium", meaning: "The price you pay for the cover, usually per year or per month. Payments go to the insurer through an authorised payment provider." },
  exclusions: { term: "Exclusions", meaning: "Situations the policy does not cover. Always read the key exclusion shown on each quote — it is often the most important difference between policies." },
  waiting_period: { term: "Waiting period", meaning: "Time after the policy starts during which you cannot claim for some or all benefits. Common in health, life and funeral cover." },
  no_claims_discount: { term: "No-claims discount", meaning: "A reduction in your premium for years in which you made no claims. Making a claim can reduce it at renewal." },
  third_party: { term: "Third party", meaning: "Someone other than you and the insurer — for example another driver, a pedestrian or a neighbour whose property is damaged. Third-party motor cover is compulsory in Ghana." },
  comprehensive: { term: "Comprehensive cover", meaning: "Motor cover for damage to other people and their property, plus fire, theft and accidental damage to your own vehicle." },
  third_party_fire_theft: { term: "Third party, fire and theft", meaning: "Motor cover for other people and their property, plus your own vehicle if it is stolen or damaged by fire — but not accidental damage to it." },
  limit_of_indemnity: { term: "Limit of indemnity", meaning: "The most the insurer will pay for a claim or for all claims in a period under a liability policy." },
  pre_existing_condition: { term: "Pre-existing condition", meaning: "A medical condition you had before the policy started. Many health and travel policies exclude these or cover them only after a waiting period or if declared." },
  estimate: { term: "Estimate", meaning: "An indicative price calculated from the insurer's approved rates. It is not an offer and can change after underwriting." },
  awaiting_underwriting: { term: "Awaiting underwriting", meaning: "The insurer is reviewing the details before confirming a price. The price may change." },
  ready_to_accept: { term: "Ready to accept", meaning: "A binding offer from the insurer that you can accept and pay for until its expiry date." },
  underwriting: { term: "Underwriting", meaning: "The insurer's assessment of a risk to decide whether to cover it, on what terms and at what price." },
  broker_of_record: { term: "Broker of record", meaning: "The licensed broker named on your request. They advise you, arrange the cover and help with renewals, complaints and claims." },
  policy_schedule: { term: "Policy schedule", meaning: "The document that lists your specific cover: who and what is insured, the period, limits, excesses and premium." },
  endorsement: { term: "Endorsement", meaning: "A formal change to an existing policy, such as adding a driver or changing the vehicle." },
  renewal: { term: "Renewal", meaning: "Continuing your cover for another period. The insurer may change the price or terms, so check what has changed." },
  lapse: { term: "Lapse", meaning: "When a policy stops because the premium was not paid. You are not covered while a policy has lapsed." },
  claim: { term: "Claim", meaning: "A request to the insurer to pay for a loss covered by your policy. Reporting a claim does not mean it is approved — the insurer assesses it and decides." },
  indemnity: { term: "Indemnity", meaning: "Putting you back in the financial position you were in just before the loss — no better and no worse." },
  sum_assured: { term: "Sum assured", meaning: "In life and funeral cover, the amount paid out when a valid claim is made." },
  beneficiary: { term: "Beneficiary", meaning: "The person you name to receive the payout from a life or funeral policy." },
};

export function lookupTerm(input: string) {
  const key = input.trim().toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, "_");
  if (GLOSSARY[key]) return GLOSSARY[key];
  const hit = Object.entries(GLOSSARY).find(([k, v]) => k.includes(key) || key.includes(k) || v.term.toLowerCase() === input.trim().toLowerCase());
  return hit?.[1] ?? null;
}
