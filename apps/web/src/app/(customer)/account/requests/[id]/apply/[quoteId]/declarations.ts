/** Category-appropriate declarations shown before an application (pure; used by page and action). */
export interface Declaration {
  key: string;
  text: string;
}

export function declarationsFor(
  categorySlug: string | undefined,
  ctx: { insurer: string; keyExclusion?: string | null; risk: Record<string, unknown> },
): Declaration[] {
  const list: Declaration[] = [
    { key: "true_complete", text: "The information I've given is true and complete to the best of my knowledge. I understand that wrong or missing information can mean a claim isn't paid." },
  ];
  switch (categorySlug) {
    case "motor": {
      const use = ctx.risk.use === "commercial" ? "commercial / ride-hailing" : "private";
      list.push(
        { key: "no_undisclosed_claims", text: "I've told my broker about every accident, claim and motoring conviction in the last 3 years for anyone who will drive the vehicle." },
        { key: "vehicle_use", text: `The vehicle is used only as I declared (${use} use) and is roadworthy.` },
      );
      break;
    }
    case "health":
    case "life-funeral":
    case "personal-accident":
      list.push(
        { key: "no_undisclosed_claims", text: "I've disclosed all pre-existing medical conditions and previous claims for everyone covered." },
        { key: "waiting_periods", text: "I understand waiting periods apply before some benefits can be claimed." },
      );
      break;
    case "travel":
      list.push(
        { key: "no_undisclosed_claims", text: "I've disclosed any pre-existing medical conditions of the travellers." },
        { key: "travel_advice", text: "I'm not travelling against government travel advice and haven't already started the trip." },
      );
      break;
    case "home":
    case "sme-property":
      list.push(
        { key: "no_undisclosed_claims", text: "I've told my broker about all losses and claims at this property in the last 3 years." },
        { key: "property_condition", text: "The property is in a good state of repair, secured as described and not left unoccupied for long periods." },
      );
      break;
    default:
      list.push({ key: "no_undisclosed_claims", text: "I've told my broker about all claims and losses in the last 5 years." });
  }
  list.push(
    {
      key: "read_exclusions",
      text: ctx.keyExclusion
        ? `I've read the key exclusions, including: “${ctx.keyExclusion}”, and understand the full policy wording applies.`
        : "I've read the key exclusions and understand the full policy wording applies.",
    },
    { key: "consent_share", text: `I agree my broker and ${ctx.insurer} may use my information to underwrite, issue and service this policy.` },
  );
  return list;
}
