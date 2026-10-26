import { STORAGE_BUCKETS } from "@im/db";
import { check, forbidden, must, notFound, uuidParam, withApi } from "@/server/api-auth";
import { canSeeMoney, resolvePartnerOrg } from "@/server/partner-mobile";

/**
 * GET /api/v1/partner/statements/{id} — one statement with its ledger lines and, when a PDF has been
 * rendered, a short-lived download link.
 */
export const GET = withApi<"either", RouteContext<"/api/v1/partner/statements/[id]">>(
  async ({ auth, req, client }, route) => {
    const id = uuidParam((await route.params).id, "statement");
    const p = await resolvePartnerOrg(auth, req, client);
    if (!canSeeMoney(auth, p)) throw forbidden("Statements are visible to owners, admins and finance.");
    const statement = must(await p.db.from("settlement_statements").select("*").eq("id", id).maybeSingle(), "Statement not found.");
    if (statement.org_id !== p.orgId) throw notFound("Statement not found.");
    const lines = await p.db.from("settlement_lines").select("id, ledger_entry_id").eq("statement_id", id).limit(5000);
    check(lines);
    const entryIds = (lines.data ?? []).map((l) => l.ledger_entry_id);
    const entries = entryIds.length
      ? await p.db.from("ledger_entries").select("id, entry_type, amount, currency, memo, reference, policy_id, payment_id, created_at").in("id", entryIds).order("created_at")
      : { data: [], error: null };
    check(entries);
    let pdfUrl: string | null = null;
    if (statement.pdf_path) {
      const { data } = await p.db.storage.from(STORAGE_BUCKETS.documents).createSignedUrl(statement.pdf_path, 600);
      pdfUrl = data?.signedUrl ?? null;
    }
    const { pdf_path, ...rest } = statement;
    return { statement: { ...rest, hasPdf: !!pdf_path, pdfUrl }, entries: entries.data ?? [] };
  },
  { auth: "either", scopes: ["finance:read"] },
);
