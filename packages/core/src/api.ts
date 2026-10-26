import { z } from "zod";

/**
 * Request/response contracts for /api/v1. Shared by the web server routes and the
 * mobile app so both sides validate the same shapes.
 */
export const uuid = z.string().uuid();

export const CreateRequestInput = z.object({
  categorySlug: z.string().min(1),
  type: z.enum(["new_cover", "renewal", "switch", "endorsement", "service"]).default("new_cover"),
  risk: z.record(z.string(), z.unknown()),
  relatedPolicyId: uuid.optional(),
  needsAssessmentId: uuid.optional(),
  source: z.enum(["web", "mobile", "whatsapp", "call_centre", "admin", "api"]).default("web"),
  submit: z.boolean().default(true),
});
export type CreateRequestInput = z.infer<typeof CreateRequestInput>;

export const AcknowledgeDisclosureInput = z.object({ requestId: uuid, stage: z.enum(["before_advice", "before_application", "broker_change"]).default("before_application") });

export const SendMessageInput = z.object({ requestId: uuid, body: z.string().trim().min(1).max(4000), attachments: z.array(z.object({ documentId: uuid, name: z.string() })).default([]) });

export const ApplyInput = z.object({
  quoteId: uuid,
  declarations: z.record(z.string(), z.union([z.boolean(), z.string()])),
  selectedBenefits: z.array(z.string()).default([]),
  acceptTerms: z.literal(true, { error: "You must accept the terms and declarations" }),
});

export const InitPaymentInput = z.object({ applicationId: uuid, channel: z.enum(["mobile_money", "card", "bank_transfer"]).default("mobile_money"), callbackUrl: z.string().url().optional() });

export const ReportClaimInput = z.object({
  policyId: uuid,
  incidentType: z.string().min(1),
  incidentAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)),
  location: z.string().max(300).optional(),
  description: z.string().min(10).max(5000),
  amountClaimed: z.coerce.number().positive().optional(),
});

export const FileComplaintInput = z.object({
  subject: z.string().min(3).max(200),
  description: z.string().min(10).max(5000),
  category: z.enum(["advice", "service", "claims", "payment", "data_privacy", "technology", "other"]),
  againstParty: z.enum(["broker", "insurer", "platform"]).default("broker"),
  requestId: uuid.optional(),
  policyId: uuid.optional(),
  claimId: uuid.optional(),
  desiredOutcome: z.string().max(2000).optional(),
});

export const RegisterDeviceInput = z.object({
  token: z.string().min(10),
  platform: z.enum(["ios", "android", "web"]),
  provider: z.enum(["expo", "fcm", "apns", "webpush"]).default("expo"),
  appVersion: z.string().optional(),
});

export const BrokerQuoteInput = z.object({
  requestId: uuid,
  insurerOrgId: uuid,
  productVersionId: uuid.optional(),
  status: z.enum(["estimate", "awaiting_underwriting", "ready_to_accept"]),
  premium: z.coerce.number().nonnegative(),
  excess: z.coerce.number().nonnegative().optional(),
  sumInsured: z.coerce.number().nonnegative().optional(),
  keyExclusion: z.string().optional(),
  validUntil: z.string().optional(),
  brokerNote: z.string().max(2000).optional(),
});

export const IssuePolicyInput = z.object({
  policyId: uuid,
  policyNumber: z.string().min(3).max(60),
  coverStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coverEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Standard API envelope. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

export const ApiErrorCodes = {
  unauthorised: "unauthorised",
  forbidden: "forbidden",
  not_found: "not_found",
  invalid: "invalid_input",
  rule: "business_rule",
  conflict: "conflict",
  rate_limited: "rate_limited",
  internal: "internal_error",
} as const;

// ---------------------------------------------------------------------------
// Additional /api/v1 contracts (Backend stream). Additive only.
// ---------------------------------------------------------------------------

/** `POST /payments` body: InitPaymentInput plus an optional direct mobile-money prompt. */
export const InitPaymentRequest = InitPaymentInput.extend({
  momo: z
    .object({
      phone: z.string().regex(/^\+?\d{9,15}$/, "Enter a valid mobile money number"),
      provider: z.enum(["mtn", "vod", "atl"]),
    })
    .optional(),
});
export type InitPaymentRequest = z.infer<typeof InitPaymentRequest>;

export const UpdateProfileInput = z
  .object({
    fullName: z.string().trim().min(1).max(200),
    preferredName: z.string().trim().max(100).nullable(),
    phone: z.string().trim().regex(/^\+?\d{9,15}$/, "Enter a valid phone number").nullable(),
    accountType: z.enum(["individual", "business"]),
    businessName: z.string().trim().max(200).nullable(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    ghanaCardNumber: z.string().trim().regex(/^GHA-\d{9}-\d$/i, "Ghana Card numbers look like GHA-123456789-0").nullable(),
    region: z.string().max(100).nullable(),
    city: z.string().max(100).nullable(),
    locale: z.string().max(10),
    avatarUrl: z.string().url().nullable(),
    notificationPrefs: z.object({ email: z.boolean(), sms: z.boolean(), push: z.boolean(), whatsapp: z.boolean() }).partial(),
    onboarded: z.literal(true),
  })
  .partial();
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

export const RecordConsentsInput = z.object({
  consents: z
    .array(
      z.object({
        type: z.enum(["terms", "privacy", "marketing", "data_sharing_broker", "data_sharing_insurer", "ai_assistance"]),
        granted: z.boolean(),
        version: z.string().max(40).optional(),
        context: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(10),
});

export const NeedsAssessmentInput = z.object({
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.boolean()])),
  anonymousId: z.string().max(100).optional(),
});

export const CancelRequestInput = z.object({ reason: z.string().trim().max(500).optional() });

export const DisclosureAckInput = z.object({
  stage: z.enum(["before_advice", "before_application", "broker_change"]).default("before_application"),
  method: z.enum(["in_app", "sms", "email", "call"]).default("in_app"),
});

export const PostMessageInput = SendMessageInput.omit({ requestId: true });

export const CompleteTaskInput = z.object({ documentId: uuid.optional(), note: z.string().trim().max(1000).optional() });

export const DocumentScope = z.enum(["requests", "policies", "claims", "profile"]);
export const DocumentKind = z.enum([
  "id_document", "vehicle_registration", "drivers_licence", "photo", "proof_of_address", "medical",
  "policy_schedule", "certificate", "policy_wording", "receipt", "endorsement", "claim_evidence",
  "police_report", "invoice", "other",
]);
export const ALLOWED_UPLOAD_MIME = [
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const documentLinks = {
  requestId: uuid.optional(),
  policyId: uuid.optional(),
  claimId: uuid.optional(),
  taskId: uuid.optional(),
};

export const UploadUrlInput = z.object({
  scope: DocumentScope,
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(ALLOWED_UPLOAD_MIME),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  kind: DocumentKind.default("other"),
  ...documentLinks,
});
export type UploadUrlInput = z.infer<typeof UploadUrlInput>;

export const ConfirmUploadInput = z.object({
  path: z.string().min(3).max(400),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(ALLOWED_UPLOAD_MIME),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  kind: DocumentKind.default("other"),
  checksum: z.string().max(128).optional(),
  ...documentLinks,
});
export type ConfirmUploadInput = z.infer<typeof ConfirmUploadInput>;

export const UpdatePolicyInput = z.object({ nickname: z.string().trim().max(60).nullable() });

export const AddExternalPolicyInput = z.object({
  categorySlug: z.string().min(1),
  insurerOrgId: uuid,
  policyNumber: z.string().trim().min(3).max(60),
  coverStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coverEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  premium: z.coerce.number().nonnegative().optional(),
  sumInsured: z.coerce.number().nonnegative().optional(),
  nickname: z.string().trim().max(60).optional(),
  documentId: uuid.optional(),
});

export const RenewalInput = z.object({
  risk: z.record(z.string(), z.unknown()).optional(),
  changes: z.string().trim().max(2000).optional(),
});

export const WithdrawClaimInput = z.object({ reason: z.string().trim().max(500).optional() });

export const MarkNotificationsReadInput = z
  .object({ ids: z.array(uuid).max(200).optional(), all: z.boolean().optional() })
  .refine((v) => v.all || (v.ids && v.ids.length > 0), { message: "Pass ids or all: true" });

export const AssistantRequest = z.object({
  messages: z.array(z.looseObject({ id: z.string().optional(), role: z.enum(["system", "user", "assistant"]), parts: z.array(z.unknown()) })).min(1).max(60),
  requestId: uuid.optional(),
  policyId: uuid.optional(),
  threadId: uuid.optional(),
});

export const ExtractDocumentInput = z.object({ documentId: uuid });
export const ClaimCompletenessInput = z.object({ claimId: uuid });
export const QuoteSummaryInput = z
  .object({ quoteId: uuid.optional(), productVersionId: uuid.optional() })
  .refine((v) => !!v.quoteId !== !!v.productVersionId, { message: "Pass exactly one of quoteId or productVersionId" });
export const BrokerCopilotInput = z.object({ requestId: uuid });

/** Partner API: insurer posts a claim status change. Only insurers decide claims. */
export const PartnerClaimStatusInput = z.object({
  status: z.enum(["acknowledged", "under_assessment", "info_requested", "approved", "partially_approved", "rejected", "paid", "closed"]),
  note: z.string().trim().max(2000).optional(),
  insurerReference: z.string().trim().max(100).optional(),
  decisionAmount: z.coerce.number().nonnegative().optional(),
  visibleToCustomer: z.boolean().default(true),
});

export const IssuePolicyBody = IssuePolicyInput.omit({ policyId: true });

/** Scopes for partner API keys (`x-api-key`). `*` grants all. */
export const API_KEY_SCOPES = ["requests:read", "quotes:write", "policies:issue", "claims:write"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

// ---------------------------------------------------------------------------
// Deep links (web path → mobile app). Shared by push notifications and the app.
// ---------------------------------------------------------------------------
export const DEEP_LINK_SCHEME = "insurancemarketplace";

/**
 * Maps a customer web path (as stored in notifications.link) to the mobile deep link.
 * `/account/requests/123/quotes` → `insurancemarketplace://requests/123/quotes`.
 * Partner/admin paths have no mobile screen and fall back to the notifications inbox.
 */
export function webPathToDeepLink(path: string | null | undefined): { url: string; path: string } {
  const fallback = { url: `${DEEP_LINK_SCHEME}://notifications`, path: "/notifications" };
  if (!path) return fallback;
  let p = path;
  try {
    if (/^https?:\/\//.test(p)) p = new URL(p).pathname + new URL(p).search;
  } catch {
    return fallback;
  }
  if (p === "/account" || p === "/account/") return { url: `${DEEP_LINK_SCHEME}://home`, path: "/home" };
  if (!p.startsWith("/account/")) return fallback;
  let rest = p.slice("/account".length);
  rest = rest.replace(/^\/requests\/([^/?]+)\/confirmation/, "/requests/$1");
  return { url: `${DEEP_LINK_SCHEME}:/${rest}`, path: rest };
}
