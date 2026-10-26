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
  /** "Talk to an expert": route to a broker whatever the insurer's integration (Addendum 2 D3). */
  talkToExpert: z.boolean().default(false),
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
  unavailable: "unavailable",
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
  /** Diaspora: show the amount in this currency (indicative); the insurer is still paid in GHS. */
  displayCurrency: z.enum(["GHS", "GBP", "USD", "EUR", "CAD"]).optional(),
  /** Card only: keep the PSP authorisation token (never the card number) for sponsor subscriptions. */
  saveMethod: z.boolean().optional(),
  /** Sponsor abroad: start a recurring collection after this first payment (card only). */
  sponsorSubscription: z.object({ cadence: z.enum(["monthly", "quarterly", "annual"]), beneficiaryId: uuid.optional() }).optional(),
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

export const AddExternalPolicyInput = z
  .object({
    categorySlug: z.string().min(1),
    /** An insurer from GET /catalog/insurers. Omit and give `insurerName` when the insurer is not on the platform. */
    insurerOrgId: uuid.optional(),
    /** Name of the insurer as printed on the policy, for insurers not listed on the platform. */
    insurerName: z.string().trim().min(2).max(120).optional(),
    policyNumber: z.string().trim().min(3).max(60),
    coverStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    coverEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    premium: z.coerce.number().nonnegative().optional(),
    sumInsured: z.coerce.number().nonnegative().optional(),
    nickname: z.string().trim().max(60).optional(),
    documentId: uuid.optional(),
  })
  .refine((v) => !!v.insurerOrgId || !!v.insurerName, { message: "Give the insurer (insurerOrgId) or its name (insurerName)", path: ["insurerOrgId"] });

export const RenewalInput = z.object({
  risk: z.record(z.string(), z.unknown()).optional(),
  changes: z.string().trim().max(2000).optional(),
});

/** POST /lookups/vehicle — prefill a motor quote from a Ghana registration number. */
export const VehicleLookupInput = z.object({ registration: z.string().trim().min(4, "Enter the registration number").max(20) });

/** POST /requests/{id}/share — save & share a comparison (link, WhatsApp or email). */
export const ShareQuotesInput = z.object({
  channel: z.enum(["link", "whatsapp", "email"]).default("link"),
  /** Required for `email` unless the account email should be used. */
  email: z.string().trim().email().optional(),
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
export const API_KEY_SCOPES = ["requests:read", "quotes:write", "policies:issue", "claims:write", "policies:read", "claims:read", "finance:read"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

// ---------------------------------------------------------------------------
// Deep links (web path → mobile app). Shared by push notifications and the app.
// ---------------------------------------------------------------------------
export const DEEP_LINK_SCHEME = "covva";

/**
 * Maps a customer web path (as stored in notifications.link) to the mobile deep link.
 * `/account/requests/123/quotes` → `covva://requests/123/quotes`.
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
  // Broker offers (Addendum 2 E): the only partner screens with a mobile equivalent.
  // `/partner/offers` → `covva://offers`; `/partner/offers/accept/{token}` → `covva://offers/accept/{token}`.
  if (p === "/partner/offers" || p.startsWith("/partner/offers/") || p.startsWith("/partner/offers?")) {
    const rest = p.slice("/partner".length);
    return { url: `${DEEP_LINK_SCHEME}:/${rest}`, path: rest };
  }
  if (!p.startsWith("/account/")) return fallback;
  let rest = p.slice("/account".length);
  rest = rest.replace(/^\/requests\/([^/?]+)\/confirmation/, "/requests/$1");
  return { url: `${DEEP_LINK_SCHEME}:/${rest}`, path: rest };
}

// ---------------------------------------------------------------------------
// Broker workspace on mobile (Addendum 4 §2) — `/api/v1/partner/*` contracts.
// ---------------------------------------------------------------------------
/** Organisation selector for dual-membership users: `?orgId=` / `X-Covva-Org`; falls back to `profiles.active_workspace`. */
export const PartnerOrgQuery = z.object({ orgId: uuid.optional() });

export const PartnerDashboardQuery = PartnerOrgQuery.extend({ days: z.coerce.number().int().min(7).max(90).default(30) });

export const PartnerRenewalsQuery = PartnerOrgQuery.extend({ days: z.coerce.number().int().min(1).max(365).default(30) });

export const PartnerCommissionQuery = PartnerOrgQuery.extend({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must look like YYYY-MM").optional(),
});

export const PartnerClaimsQuery = PartnerOrgQuery.extend({
  status: z.enum(["draft", "reported", "delivered_to_insurer", "acknowledged", "under_assessment", "info_requested", "approved", "partially_approved", "rejected", "paid", "closed", "withdrawn"]).optional(),
  /** open = not draft/paid/closed/withdrawn/rejected. */
  view: z.enum(["open", "decided", "all"]).default("open"),
  policyId: uuid.optional(),
  customerId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  before: z.string().datetime({ offset: true }).optional(),
});

/**
 * Broker claim update: a status step the broker may record while the insurer hasn't acted
 * (deliver / acknowledge / assess / request info) or a plain note on the claim timeline.
 * Decisions (approve / reject / pay) are insurer-only and are never accepted here.
 */
export const PartnerClaimUpdateInput = z
  .object({
    status: z.enum(["delivered_to_insurer", "acknowledged", "under_assessment", "info_requested"]).optional(),
    note: z.string().trim().max(2000).optional(),
    visibleToCustomer: z.boolean().default(true),
  })
  .refine((v) => !!v.status || !!v.note, { message: "Give a status or a note", path: ["note"] });
export type PartnerClaimUpdateInput = z.infer<typeof PartnerClaimUpdateInput>;

export const PartnerCustomersQuery = PartnerOrgQuery.extend({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const PartnerMessagesQuery = PartnerOrgQuery.extend({
  request_id: uuid,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime({ offset: true }).optional(),
});

/** `POST /partner/messages` — a message on a request thread; `internal` notes are hidden from the customer. */
export const PartnerMessageInput = z.object({
  requestId: uuid,
  body: z.string().trim().min(1).max(4000),
  attachments: z.array(z.object({ documentId: uuid, name: z.string().max(200) })).max(10).default([]),
  internal: z.boolean().default(false),
});
export type PartnerMessageInput = z.infer<typeof PartnerMessageInput>;

/**
 * `POST /partner/documents` (JSON): a file captured on the phone, base64-encoded, linked to a
 * request, policy or claim the organisation services. Multipart form-data with a `file` part and the
 * same field names is accepted too.
 */
export const PartnerDocumentUploadInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(ALLOWED_UPLOAD_MIME),
  kind: DocumentKind.default("other"),
  /** Base64 (plain or data: URL) file contents. */
  content: z.string().min(1),
  requestId: uuid.optional(),
  policyId: uuid.optional(),
  claimId: uuid.optional(),
  taskId: uuid.optional(),
  /** Mark the upload as already delivered to the insurer (policy schedules/certificates the broker holds). */
  deliveredToInsurer: z.boolean().default(false),
}).refine((v) => !!v.requestId || !!v.policyId || !!v.claimId, { message: "Link the document to a request, policy or claim", path: ["requestId"] });
export type PartnerDocumentUploadInput = z.infer<typeof PartnerDocumentUploadInput>;

/** `PATCH /partner/profile` — contact fields only (owner/admin). Licence and legal details change through registration/admin. */
export const UpdatePartnerProfileInput = z
  .object({
    contactEmail: z.string().trim().email().max(200).nullable(),
    contactPhone: z.string().trim().regex(/^\+?\d{9,15}$/, "Enter a valid phone number").nullable(),
    website: z.string().trim().url().max(200).nullable(),
    address: z.string().trim().max(400).nullable(),
    region: z.string().trim().max(100).nullable(),
    description: z.string().trim().max(2000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type UpdatePartnerProfileInput = z.infer<typeof UpdatePartnerProfileInput>;

/** Push notification kinds the broker app must handle (see docs/MOBILE_INTEGRATION.md §15). */
export const BROKER_PUSH_KINDS = ["offer.new", "message.new", "claim.status", "claim.reported", "claim.delivered", "renewal.due", "document.uploaded", "request.created"] as const;
export type BrokerPushKind = (typeof BROKER_PUSH_KINDS)[number];

// ---------------------------------------------------------------------------
// Claims completion (Phase 2): thread, info requests, video, partner network, jobs
// ---------------------------------------------------------------------------
/** `POST /claims/{id}/messages` — a message in the claim thread. `internal` is partner/staff only (the server rejects it for customers). */
export const ClaimMessageInput = z.object({
  body: z.string().trim().min(1).max(4000),
  attachments: z.array(z.object({ documentId: uuid.optional(), storagePath: z.string().max(400).optional(), name: z.string().trim().min(1).max(200) })).max(10).default([]),
  internal: z.boolean().default(false),
});
export type ClaimMessageInput = z.infer<typeof ClaimMessageInput>;

export const ClaimMessagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime({ offset: true }).optional(),
});

/** `POST /partner/claims/{id}/info-requests` — ask the customer (or the broker) for a document, information or an inspection slot. */
export const ClaimInfoRequestInput = z.object({
  kind: z.enum(["document", "information", "inspection"]).default("document"),
  requestedParty: z.enum(["customer", "broker"]).default("customer"),
  message: z.string().trim().min(3).max(2000),
  dueAt: z.string().datetime({ offset: true }).optional(),
  /** Insurers may move the claim to `info_requested` in the same call. */
  setStatus: z.boolean().default(false),
});
export type ClaimInfoRequestInput = z.infer<typeof ClaimInfoRequestInput>;

/** `POST /claims/{id}/info-requests/{reqId}/fulfil` — link a document and/or answer in writing. */
export const FulfilInfoRequestInput = z
  .object({ documentId: uuid.optional(), response: z.string().trim().max(2000).optional() })
  .refine((v) => !!v.documentId || !!v.response, { message: "Attach a document or write a response", path: ["response"] });
export type FulfilInfoRequestInput = z.infer<typeof FulfilInfoRequestInput>;

export const VIDEO_UPLOAD_MIME = ["video/mp4", "video/webm", "video/quicktime"] as const;
/** `POST /claims/{id}/video` (JSON, base64) — or multipart with a `file` part and the same field names. */
export const ClaimVideoUploadInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(VIDEO_UPLOAD_MIME),
  /** Measured on the device; the server rejects anything over 90 seconds. */
  durationSeconds: z.coerce.number().int().min(0).max(3600).optional(),
  /** Base64 (plain or data: URL) video contents. */
  content: z.string().min(1),
  caption: z.string().trim().max(300).optional(),
});
export type ClaimVideoUploadInput = z.infer<typeof ClaimVideoUploadInput>;

export const ServicePartnerKindEnum = z.enum(["garage", "towing", "hospital", "clinic", "pharmacy", "assessor"]);
/** `GET /service-partners?kind=&region=&insurerOrgId=` — approved post-claim partners (public directory). */
export const ServicePartnersQuery = z.object({
  kind: ServicePartnerKindEnum.optional(),
  region: z.string().trim().max(100).optional(),
  /** Only partners that direct-bill this insurer. */
  insurerOrgId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ServicePartnersQuery = z.infer<typeof ServicePartnersQuery>;

export const ClaimJobKindEnum = z.enum(["repair", "towing", "treatment", "assessment", "replacement", "other"]);
export const ClaimJobStatusEnum = z.enum(["requested", "accepted", "in_progress", "completed", "cancelled"]);
/** `POST /partner/claims/{id}/jobs` — assign a service partner to the claim. */
export const ClaimJobInput = z.object({
  servicePartnerId: uuid,
  kind: ClaimJobKindEnum.default("repair"),
  directBilling: z.boolean().default(false),
  estimate: z.coerce.number().nonnegative().optional(),
  scheduledFor: z.string().datetime({ offset: true }).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type ClaimJobInput = z.infer<typeof ClaimJobInput>;

/** `PATCH /partner/claims/{id}/jobs` with `jobId` (or the web action) — track the job. */
export const UpdateClaimJobInput = z
  .object({
    jobId: uuid,
    status: ClaimJobStatusEnum.optional(),
    estimate: z.coerce.number().nonnegative().optional(),
    invoiceDocumentId: uuid.optional(),
    scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
    directBilling: z.boolean().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "Nothing to update", path: ["status"] });
export type UpdateClaimJobInput = z.infer<typeof UpdateClaimJobInput>;

/** Insurer/staff review of a fraud flag. */
export const ReviewFraudFlagInput = z.object({ flagId: uuid, status: z.enum(["cleared", "confirmed", "open"]), note: z.string().trim().max(1000).optional() });
export type ReviewFraudFlagInput = z.infer<typeof ReviewFraudFlagInput>;

// ---------------------------------------------------------------------------
// Diaspora payments: FX display, sponsor subscriptions, bundles, property cover.
// ---------------------------------------------------------------------------
export const DisplayCurrencySchema = z.enum(["GHS", "GBP", "USD", "EUR", "CAD"]);

/** `GET /fx?currency=&amount=` — indicative rates and the disclosure text. */
export const FxQuery = z.object({
  currency: z.string().trim().toUpperCase().pipe(DisplayCurrencySchema).default("GHS"),
  /** Optional GHS amount to convert (indicative). */
  amount: z.coerce.number().positive().max(1_000_000_000).optional(),
});
export type FxQuery = z.infer<typeof FxQuery>;

/** `POST /subscriptions` — a sponsor's recurring premium collection for a policy they pay for. */
export const CreateSubscriptionInput = z
  .object({
    policyId: uuid.optional(),
    applicationId: uuid.optional(),
    cadence: z.enum(["monthly", "quarterly", "annual"]).default("monthly"),
    displayCurrency: DisplayCurrencySchema.default("GHS"),
    /** A saved payment method (`GET /subscriptions` lists them); defaults to the sponsor's default method. */
    paymentMethodId: uuid.optional(),
    beneficiaryId: uuid.optional(),
  })
  .refine((v) => !!v.policyId || !!v.applicationId, { message: "Give the policy (or application) the subscription pays for", path: ["policyId"] });
export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionInput>;

/** `POST /property/{policyId}/updates` — a construction / site photo already uploaded to the documents bucket. */
export const PropertyUpdateInput = z.object({
  storagePath: z.string().trim().min(3).max(500),
  caption: z.string().trim().max(500).optional(),
  takenAt: z.string().datetime({ offset: true }).optional(),
});
export type PropertyUpdateInput = z.infer<typeof PropertyUpdateInput>;

/** `POST /property/{policyId}/inspections` — ask for a partner site inspection. */
export const RequestInspectionInput = z.object({
  address: z.string().trim().min(5).max(500),
  gps: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type RequestInspectionInput = z.infer<typeof RequestInspectionInput>;
