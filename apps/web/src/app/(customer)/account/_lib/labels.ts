/** Customer-facing labels shared across account pages (pure, safe on server and client). */
export const REQUEST_TYPE_LABEL: Record<string, string> = {
  new_cover: "New cover",
  renewal: "Renewal",
  switch: "Switch insurer",
  endorsement: "Policy change",
  service: "Service",
};

export const COMPLAINT_CATEGORY_LABEL: Record<string, string> = {
  advice: "Advice I was given",
  service: "Service or delays",
  claims: "A claim",
  payment: "Payment or refund",
  data_privacy: "My data or privacy",
  technology: "The app or website",
  other: "Something else",
};

export const PARTY_LABEL: Record<string, string> = {
  customer: "You",
  broker: "Your broker",
  insurer: "Insurer",
  platform: "Platform support",
  system: "Update",
  ai: "AI assistant",
};

/** Incident types offered when reporting a claim, by category (mobile-claim-report.jpg). */
export const INCIDENT_TYPES: Record<string, { value: string; label: string; icon: string }[]> = {
  motor: [
    { value: "accident", label: "Accident", icon: "car" },
    { value: "theft", label: "Theft", icon: "shield" },
    { value: "windscreen", label: "Windscreen", icon: "grid" },
    { value: "other", label: "Something else", icon: "info" },
  ],
  home: [
    { value: "burglary", label: "Burglary", icon: "shield" },
    { value: "fire", label: "Fire", icon: "flame" },
    { value: "flood", label: "Flood or storm", icon: "droplets" },
    { value: "other", label: "Something else", icon: "info" },
  ],
  travel: [
    { value: "medical", label: "Medical emergency", icon: "heart" },
    { value: "baggage", label: "Lost or delayed baggage", icon: "luggage" },
    { value: "cancellation", label: "Trip cancelled", icon: "plane" },
    { value: "other", label: "Something else", icon: "info" },
  ],
  health: [
    { value: "inpatient", label: "Hospital stay", icon: "heart" },
    { value: "outpatient", label: "Outpatient treatment", icon: "stethoscope" },
    { value: "other", label: "Something else", icon: "info" },
  ],
  "personal-accident": [
    { value: "injury", label: "Accidental injury", icon: "heart" },
    { value: "hospital", label: "Hospital stay", icon: "stethoscope" },
    { value: "other", label: "Something else", icon: "info" },
  ],
  "life-funeral": [
    { value: "death", label: "Bereavement", icon: "heart" },
    { value: "other", label: "Something else", icon: "info" },
  ],
  "sme-property": [
    { value: "fire", label: "Fire", icon: "flame" },
    { value: "burglary", label: "Burglary", icon: "shield" },
    { value: "interruption", label: "Business interruption", icon: "store" },
    { value: "other", label: "Something else", icon: "info" },
  ],
  liability: [
    { value: "third_party_claim", label: "Claim against me", icon: "scale" },
    { value: "other", label: "Something else", icon: "info" },
  ],
  "marine-cargo": [
    { value: "damage", label: "Goods damaged", icon: "ship" },
    { value: "loss", label: "Goods lost", icon: "shield" },
    { value: "other", label: "Something else", icon: "info" },
  ],
};

export const DEFAULT_INCIDENTS = [
  { value: "damage", label: "Loss or damage", icon: "shield" },
  { value: "theft", label: "Theft", icon: "shield" },
  { value: "other", label: "Something else", icon: "info" },
];

/** Evidence typically needed for an incident type (checklist on the claim page). */
export function requiredEvidence(category: string | undefined, incident: string): { key: string; label: string; kind: string }[] {
  const photos = { key: "photos", label: "Photos of the damage or loss", kind: "photo" };
  const police = { key: "police_report", label: "Police report or extract", kind: "police_report" };
  const invoice = { key: "invoice", label: "Repair estimate, invoice or receipts", kind: "invoice" };
  const id = { key: "id", label: "Your Ghana Card", kind: "id_document" };
  if (category === "motor") {
    if (incident === "accident") return [photos, police, { key: "licence", label: "Driver's licence of the driver", kind: "drivers_licence" }, invoice];
    if (incident === "theft") return [police, { key: "registration", label: "Vehicle registration document", kind: "vehicle_registration" }];
    if (incident === "windscreen") return [photos, invoice];
  }
  if (incident === "theft" || incident === "burglary" || incident === "loss") return [police, photos, invoice];
  if (incident === "medical" || incident === "inpatient" || incident === "outpatient" || incident === "hospital" || incident === "injury")
    return [{ key: "medical", label: "Medical report or discharge summary", kind: "medical" }, invoice];
  if (incident === "death") return [{ key: "death_certificate", label: "Death certificate", kind: "other" }, id];
  return [photos, invoice];
}
