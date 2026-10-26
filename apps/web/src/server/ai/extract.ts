import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { Enum, Json } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { ApiError, invalid, notFound, type UserAuth } from "@/server/api-auth";
import { getModels, requireAiFeature } from "./config";
import { BASE_INSTRUCTIONS } from "./guardrails";
import { logAiUsage } from "./usage";

/**
 * Structured extraction from an uploaded document for human review.
 * The output is stored on `documents.ai_extraction`; it NEVER sets `verified`.
 */
const conf = z.number().min(0).max(1).describe("Your confidence from 0 to 1");
const str = z.string().nullable();

const COMMON = {
  confidence: conf.describe("Overall confidence that the fields were read correctly (0–1)"),
  legible: z.boolean().describe("Whether the document is legible enough to read"),
  documentLooksLike: z.string().describe("What kind of document this appears to be"),
  warnings: z.array(z.string()).describe("Problems a human reviewer should check, e.g. blurred, expired, mismatched type"),
};

const SCHEMAS = {
  vehicle_registration: z.object({
    ...COMMON,
    fields: z.object({
      registrationNumber: str, make: str, model: str, yearOfManufacture: str, colour: str, chassisNumber: str,
      engineNumber: str, ownerName: str, registrationDate: str.describe("YYYY-MM-DD if shown"), useType: str,
    }),
  }),
  drivers_licence: z.object({
    ...COMMON,
    fields: z.object({ licenceNumber: str, fullName: str, dateOfBirth: str, issueDate: str, expiryDate: str, classes: z.array(z.string()), issuingAuthority: str }),
  }),
  id_document: z.object({
    ...COMMON,
    fields: z.object({ idType: str.describe("e.g. Ghana Card, passport"), idNumber: str, fullName: str, dateOfBirth: str, sex: str, nationality: str, issueDate: str, expiryDate: str }),
  }),
  invoice: z.object({
    ...COMMON,
    fields: z.object({
      supplier: str, invoiceNumber: str, invoiceDate: str, currency: str, total: z.number().nullable(), tax: z.number().nullable(),
      lineItems: z.array(z.object({ description: z.string(), quantity: z.number().nullable(), amount: z.number().nullable() })),
    }),
  }),
  police_report: z.object({
    ...COMMON,
    fields: z.object({ reportNumber: str, station: str, reportDate: str, incidentDate: str, incidentLocation: str, incidentSummary: str, vehiclesInvolved: z.array(z.string()), officerName: str }),
  }),
  other: z.object({
    ...COMMON,
    fields: z.object({ title: str, issuer: str, date: str, reference: str, summary: str.describe("One or two sentences on what the document says") }),
  }),
} as const;

type ExtractKind = keyof typeof SCHEMAS;

function kindFor(docKind: Enum<"document_kind">): ExtractKind {
  switch (docKind) {
    case "vehicle_registration":
    case "drivers_licence":
    case "id_document":
    case "invoice":
    case "police_report":
      return docKind;
    case "receipt":
      return "invoice";
    default:
      return "other";
  }
}

const SUPPORTED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024;

export async function extractDocument(auth: UserAuth, documentId: string) {
  await requireAiFeature("ai_document_extraction");
  // Access check through RLS: the caller must be able to read the document row.
  const { data: doc } = await auth.supabase
    .from("documents")
    .select("id, kind, storage_path, mime_type, size_bytes, file_name, owner_id, request_id, claim_id, policy_id")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) throw notFound("Document not found.");
  if (!doc.mime_type || !SUPPORTED.has(doc.mime_type)) throw invalid("This file type can't be read automatically. Upload a PDF, JPEG, PNG or WebP.");
  if (doc.size_bytes && doc.size_bytes > MAX_BYTES) throw invalid("This file is too large to read automatically (10 MB limit).");

  // Signed URL as the caller (storage RLS applies), then fetch the bytes server-side.
  const { data: signed } = await auth.supabase.storage.from("documents").createSignedUrl(doc.storage_path, 120);
  if (!signed?.signedUrl) throw notFound("The file could not be found in storage.");
  const res = await fetch(signed.signedUrl, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new ApiError("internal_error", "The file could not be downloaded.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw invalid("This file is too large to read automatically (10 MB limit).");

  const kind = kindFor(doc.kind);
  const models = await getModels();
  const started = Date.now();
  try {
    const { output, usage } = await generateText({
      model: models.vision,
      instructions: `${BASE_INSTRUCTIONS}

Task: read the attached document and extract the requested fields exactly as printed. Use null for anything missing or unreadable — never guess. Dates as YYYY-MM-DD where possible. Add a warning if the document type doesn't match "${kind.replace(/_/g, " ")}", if it looks expired, altered or blurred. A human will review your output; you do not verify documents.`,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Extract the fields for a ${kind.replace(/_/g, " ")} (uploaded as "${doc.kind.replace(/_/g, " ")}").` },
            { type: "file", data: bytes, mediaType: doc.mime_type },
          ],
        },
      ],
      output: Output.object({ schema: SCHEMAS[kind] as (typeof SCHEMAS)["other"] }),
    });
    await logAiUsage({ feature: "document_extraction", model: models.vision, usage, latencyMs: Date.now() - started, success: true, userId: auth.userId });

    const needsReview = true; // Always reviewed by a person; confidence only orders the review queue.
    const extraction = {
      kind,
      model: models.vision,
      extracted_at: new Date().toISOString(),
      fields: output.fields,
      confidence: output.confidence,
      legible: output.legible,
      document_looks_like: output.documentLooksLike,
      warnings: output.warnings,
      needs_human_review: needsReview,
      low_confidence: output.confidence < 0.8 || !output.legible,
      label: "AI-extracted — check against the original document. Not verified.",
    };
    // Service client: documents UPDATE is limited to servicing staff by RLS, but the caller's
    // read access was verified above and we only write the AI field (never `verified`).
    await createServiceClient().from("documents").update({ ai_extraction: extraction as unknown as Json }).eq("id", doc.id);
    return { documentId: doc.id, extraction };
  } catch (err) {
    await logAiUsage({ feature: "document_extraction", model: models.vision, latencyMs: Date.now() - started, success: false, userId: auth.userId });
    if (err instanceof ApiError) throw err;
    throw new ApiError("internal_error", "We couldn't read this document automatically. Your broker will review it.");
  }
}
