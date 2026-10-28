import { cmsDisabledReason } from "@/cms/env";

/** Full document shown at /cms when the CMS has no database or secret configured. */
export function CmsDisabled() {
  const reason = cmsDisabledReason() ?? "not configured";
  return (
    <html lang="en-GH">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>Covva CMS is not configured</title>
      </head>
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "48px 16px", background: "#F6F8F7", color: "#0F1B1A" }}>
        <main style={{ maxWidth: 560, margin: "0 auto", background: "#fff", border: "1px solid #DCE4E1", borderRadius: 16, padding: 24, fontSize: 15, lineHeight: 1.5 }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Covva CMS is not configured</h1>
          <p style={{ margin: 0 }}>
            This deployment runs the marketing site with its built-in content. The CMS is off because <code>{reason}</code>. Set <code>DATABASE_URI</code>,{" "}
            <code>PAYLOAD_SECRET</code> and the media storage variables, run <code>payload migrate</code>, then redeploy (see <code>docs/CMS.md</code>).
          </p>
        </main>
      </body>
    </html>
  );
}
