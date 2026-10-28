import type { ReactNode } from "react";
import type { CmsBootstrapState } from "@/cms/bootstrap";
import { cmsDisabledReason } from "@/cms/env";

/** A full document (own <html>) shown at /cms instead of Payload's admin. */
function CmsNoticeDocument({ title, children }: { title: string; children: ReactNode }) {
  return (
    <html lang="en-GH">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{title}</title>
      </head>
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "48px 16px", background: "#F6F8F7", color: "#0F1B1A" }}>
        <main style={{ maxWidth: 560, margin: "0 auto", background: "#fff", border: "1px solid #DCE4E1", borderRadius: 16, padding: 24, fontSize: 15, lineHeight: 1.5 }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>{title}</h1>
          {children}
        </main>
      </body>
    </html>
  );
}

/** Shown at /cms when the CMS has no database or secret configured. */
export function CmsDisabled() {
  const reason = cmsDisabledReason() ?? "not configured";
  return (
    <CmsNoticeDocument title="Covva CMS is not configured">
      <p style={{ margin: 0 }}>
        This deployment runs the marketing site with its built-in content. The CMS is off because <code>{reason}</code>. Set <code>DATABASE_URI</code>,{" "}
        <code>PAYLOAD_SECRET</code> and the media storage variables, run <code>payload migrate</code>, then redeploy (see <code>docs/CMS.md</code>).
      </p>
    </CmsNoticeDocument>
  );
}

/**
 * Shown at /cms while the CMS is configured but has no user yet (or its database could not be
 * asked). Payload's public "create first user" screen is never served: the first admin comes from
 * `cms:seed` (docs/CMS.md §5).
 */
export function CmsNotInitialised({ state }: { state: Exclude<CmsBootstrapState, "ready"> }) {
  if (state === "unavailable") {
    return (
      <CmsNoticeDocument title="Covva CMS is unavailable">
        <p style={{ margin: 0 }}>
          The CMS database could not be reached, so the admin stays closed. Check <code>DATABASE_URI</code> and the server log, then try again in a few seconds. The
          marketing site keeps rendering its built-in content.
        </p>
      </CmsNoticeDocument>
    );
  }
  return (
    <CmsNoticeDocument title="Covva CMS is not initialised">
      <p style={{ margin: "0 0 12px" }}>
        The CMS is configured but has no user account yet, so the admin stays closed. Create the first admin with{" "}
        <code>CMS_ADMIN_EMAIL=… CMS_ADMIN_PASSWORD=… pnpm --filter @im/web cms:seed</code> (see <code>docs/CMS.md</code>); the admin opens within a few seconds,
        without a redeploy.
      </p>
      <p style={{ margin: 0, color: "#4B5B58" }}>
        To use Payload&apos;s own first-user screen instead, set <code>CMS_BOOTSTRAP_ALLOW_FIRST_USER=1</code> for one deployment and unset it as soon as the account
        exists.
      </p>
    </CmsNoticeDocument>
  );
}
