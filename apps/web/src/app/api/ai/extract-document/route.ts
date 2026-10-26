import { ExtractDocumentInput } from "@im/core";
import { RATE_LIMITS, parseJson, withApi } from "@/server/api-auth";
import { extractDocument } from "@/server/ai/extract";

export const maxDuration = 60;

/** POST /api/ai/extract-document — AI field extraction for human review. Never verifies a document. */
export const POST = withApi(
  async ({ auth, req }) => {
    const { documentId } = await parseJson(req, ExtractDocumentInput);
    return extractDocument(auth, documentId);
  },
  { auth: "user", rateLimit: RATE_LIMITS.ai },
);
