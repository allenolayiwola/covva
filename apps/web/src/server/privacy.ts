import "server-only";
import { normaliseRetentionConfig, retentionDryRun, retentionPlan } from "@im/core";
import { STORAGE_BUCKETS, type Json } from "@im/db";
import type { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/server/log";

/**
 * Act 843 retention job (cron `privacy-retention`, see apps/web/vercel.json and docs/PRIVACY_REQUESTS.md).
 *
 *   1. Expired personal-data exports: the file is removed from Storage, then the request is closed through
 *      public.privacy_request_action(…, 'expire_export') (audited, idempotent).
 *   2. Retention rules: the plan (data class + cutoff) is computed by @im/core from
 *      platform_settings.privacy_retention and applied by public.run_privacy_retention(), which logs the run in
 *      privacy_retention_runs. E2E / demo data is excluded by the database.
 *
 * Dry run (nothing changes, counts only) when the URL has ?dry_run=1 OR the setting's mode is not "enforce" — the
 * default until the retention periods are confirmed with counsel.
 */
type Svc = ReturnType<typeof createServiceClient>;

export interface RetentionOptions {
  /** `dry_run` query parameter of the cron URL. */
  dryRun?: string | null;
  now?: Date;
}

export async function runPrivacyRetention(svc: Svc, opts: RetentionOptions = {}): Promise<Record<string, unknown>> {
  const now = opts.now ?? new Date();
  const { data: setting } = await svc.from("platform_settings").select("value").eq("key", "privacy_retention").maybeSingle();
  const config = normaliseRetentionConfig(setting?.value);
  const dryRun = retentionDryRun(config, opts.dryRun);
  const plan = retentionPlan(config, now);

  const exports = await expirePrivacyExports(svc, { dryRun, now });

  const { data, error } = await svc.rpc("run_privacy_retention", {
    p_plan: plan.map((p) => ({ class: p.class, cutoff: p.cutoff })) as unknown as Json,
    p_dry_run: dryRun,
    p_triggered_by: "cron",
  });
  if (error) throw error;
  const result = (data ?? {}) as { ok?: boolean; run_id?: string; results?: Record<string, unknown> };
  log.info("privacy.retention", { dryRun, mode: config.mode, warnings: config.warnings, runId: result.run_id, results: result.results, exports });
  if (result.ok === false) log.warn("privacy.retention_partial", { runId: result.run_id, results: result.results });
  return {
    dry_run: dryRun,
    mode: config.mode,
    warnings: config.warnings,
    run_id: result.run_id ?? null,
    ok: result.ok ?? true,
    results: result.results ?? {},
    exports,
  };
}

/** Deletes export files whose download window has ended and closes their requests. Safe to re-run. */
export async function expirePrivacyExports(svc: Svc, { dryRun, now = new Date() }: { dryRun: boolean; now?: Date }) {
  const { data: due, error } = await svc
    .from("privacy_requests")
    .select("id, export_path")
    .not("export_path", "is", null)
    .lt("export_expires_at", now.toISOString())
    .limit(200);
  if (error) throw error;
  const rows = due ?? [];
  if (dryRun || !rows.length) return { due: rows.length, expired: 0 };
  const paths = rows.map((r) => r.export_path!).filter(Boolean);
  const { error: rmError } = await svc.storage.from(STORAGE_BUCKETS.documents).remove(paths);
  if (rmError) {
    // Keep the rows pointing at the files so the next run retries; never claim a deletion that did not happen.
    log.warn("privacy.export_remove_failed", { count: paths.length, err: rmError });
    return { due: rows.length, expired: 0, error: rmError.message };
  }
  let expired = 0;
  for (const r of rows) {
    const { error: e } = await svc.rpc("privacy_request_action", { p_id: r.id, p_action: "expire_export" });
    if (e) log.warn("privacy.export_expire_failed", { requestId: r.id, err: e });
    else expired++;
  }
  return { due: rows.length, expired };
}
