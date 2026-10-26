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
