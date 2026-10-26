import "server-only";
import type { Enum } from "@im/db";

/** Evidence the insurer typically needs, by category and incident. Shown as a checklist; the insurer decides. */
export interface EvidenceItem { key: string; label: string; documentKind?: Enum<"document_kind">; optional?: boolean }

const BASE: EvidenceItem[] = [{ key: "description", label: "A clear description of what happened, when and where" }];

const BY_CATEGORY: Record<string, EvidenceItem[]> = {
  motor: [
    { key: "photos", label: "Photos of the damage and the scene", documentKind: "photo" },
    { key: "drivers_licence", label: "Driver's licence of the person driving", documentKind: "drivers_licence" },
    { key: "vehicle_registration", label: "Vehicle registration document", documentKind: "vehicle_registration" },
    { key: "repair_estimate", label: "Repair estimate or invoice", documentKind: "invoice" },
  ],
  travel: [
    { key: "medical_report", label: "Medical report or receipts", documentKind: "medical" },
    { key: "receipts", label: "Receipts for costs you are claiming", documentKind: "receipt" },
    { key: "id", label: "Passport or ID", documentKind: "id_document" },
  ],
  "personal-accident": [
    { key: "medical_report", label: "Medical report from the treating doctor or hospital", documentKind: "medical" },
    { key: "hospital_bills", label: "Hospital bills and receipts", documentKind: "receipt" },
    { key: "id", label: "Ghana Card or other ID", documentKind: "id_document" },
  ],
  home: [
    { key: "photos", label: "Photos of the damage or the point of entry", documentKind: "photo" },
    { key: "proof_of_ownership", label: "Receipts or proof of ownership for items claimed", documentKind: "receipt" },
    { key: "repair_quote", label: "Repair or replacement quotation", documentKind: "invoice" },
  ],
  health: [
    { key: "medical_report", label: "Medical report and diagnosis", documentKind: "medical" },
    { key: "bills", label: "Itemised hospital bills", documentKind: "invoice" },
  ],
  "life-funeral": [
    { key: "death_certificate", label: "Death certificate", documentKind: "other" },
    { key: "claimant_id", label: "Claimant's Ghana Card or ID", documentKind: "id_document" },
    { key: "burial_permit", label: "Burial permit (if available)", documentKind: "other", optional: true },
  ],
  "sme-property": [
    { key: "photos", label: "Photos of the damage or loss", documentKind: "photo" },
    { key: "stock_records", label: "Stock records or invoices for items lost", documentKind: "invoice" },
    { key: "repair_quote", label: "Repair or replacement quotation", documentKind: "invoice" },
  ],
  liability: [
    { key: "claim_letter", label: "The letter or claim you received from the third party", documentKind: "other" },
    { key: "correspondence", label: "Any correspondence about the incident", documentKind: "other", optional: true },
  ],
  "marine-cargo": [
    { key: "bill_of_lading", label: "Bill of lading or waybill", documentKind: "other" },
    { key: "commercial_invoice", label: "Commercial invoice", documentKind: "invoice" },
    { key: "survey_report", label: "Survey report or photos of the damaged goods", documentKind: "photo" },
  ],
};

const POLICE_INCIDENTS = /theft|burglar|stolen|robbery|accident|collision|hit|fire|vandal|break.?in/i;

export function requiredEvidence(categorySlug: string, incidentType: string): EvidenceItem[] {
  const items = [...BASE, ...(BY_CATEGORY[categorySlug] ?? [{ key: "supporting", label: "Supporting documents or photos", documentKind: "claim_evidence" as const }])];
  if (POLICE_INCIDENTS.test(incidentType)) {
    items.push({ key: "police_report", label: "Police report or extract", documentKind: "police_report", optional: /accident|collision/i.test(incidentType) && categorySlug !== "motor" });
  }
  return items;
}
