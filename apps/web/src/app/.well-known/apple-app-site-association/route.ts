/**
 * iOS Universal Links + shared web credentials. Env: APPLE_TEAM_ID, IOS_BUNDLE_ID.
 * Static (prerendered at build) — redeploy after changing the env vars.
 */
export function GET() {
  const appId = `${process.env.APPLE_TEAM_ID ?? "TEAMID_PLACEHOLDER"}.${process.env.IOS_BUNDLE_ID ?? "com.insurancemarketplace.app"}`;
  return Response.json(
    {
      applinks: {
        details: [
          {
            appIDs: [appId],
            components: [
              { "/": "/account", comment: "Customer home" },
              { "/": "/account/*", comment: "Requests, quotes, policies, claims, complaints, notifications" },
              { "/": "/auth/callback*", comment: "Magic link / OAuth return" },
              { "/": "/partner/*", exclude: true, comment: "Partner workspace is web only" },
            ],
          },
        ],
      },
      webcredentials: { apps: [appId] },
    },
    { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } },
  );
}
