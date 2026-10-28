"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { parseClientImportCsv } from "@im/core";
import { importBrokerClients } from "@/server/onboarding";
import { ROLES, actionContext, run, type ActionState } from "../../../_lib/context";

const MAX_BYTES = 900 * 1024; // Server Action body limit is 1 MB

/**
 * Broker bulk import of existing clients (Addendum 2 C5 / Addendum 3 C4). Owner/admin only.
 * `mode=preview` validates and reports without writing; `mode=import` creates accounts,
 * assignments and external policies through the service client (after this role check).
 */
export async function importClients(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "broker", roles: ROLES.orgAdmin });
    const mode = fd.get("mode") === "import" ? "import" : "preview";
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a CSV file to upload." };
    if (file.size > MAX_BYTES) return { ok: false, error: "The file is larger than 900 KB. Split it into smaller files." };
    const text = await file.text();
    const parsed = parseClientImportCsv(text);
    const managerRaw = fd.get("accountManagerId");
    const manager = z.string().uuid().safeParse(managerRaw);
    let accountManagerId: string | null = null;
    if (manager.success) {
      const { data: m } = await ctx.supabase.from("memberships").select("user_id").eq("org_id", ctx.orgId).eq("user_id", manager.data).eq("active", true).maybeSingle();
      if (!m) return { ok: false, error: "The account manager must be an active member of your organisation." };
      accountManagerId = m.user_id;
    }

    if (mode === "preview" || !parsed.rows.length) {
      return {
        ok: true,
        message: parsed.rows.length ? `${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"} ready to import, ${parsed.errors.length} with problems. Review below, then import.` : "No valid rows found. Fix the problems below and try again.",
        data: { mode: "preview", valid: parsed.rows.length, errors: JSON.stringify(parsed.errors), preview: JSON.stringify(parsed.rows.slice(0, 200)) },
      };
    }

    const summary = await importBrokerClients({ brokerOrgId: ctx.orgId, brokerName: ctx.orgName, actorUserId: ctx.userId, accountManagerId, rows: parsed.rows });
    refresh();
    return {
      ok: true,
      message: `Imported: ${summary.created} account${summary.created === 1 ? "" : "s"} created, ${summary.linked} existing linked, ${summary.policies} polic${summary.policies === 1 ? "y" : "ies"} recorded, ${summary.skipped} skipped, ${parsed.errors.length} invalid rows.`,
      data: { mode: "import", created: summary.created, linked: summary.linked, skipped: summary.skipped, policies: summary.policies, errors: JSON.stringify(parsed.errors), outcomes: JSON.stringify(summary.outcomes) },
    };
  });
}
