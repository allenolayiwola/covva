/**
 * Android App Links. Env: ANDROID_PACKAGE_NAME, ANDROID_SHA256_CERT_FINGERPRINTS (comma-separated,
 * include both the upload key and the Play App Signing key). Static — redeploy after changes.
 */
export function GET() {
  const fingerprints = (process.env.ANDROID_SHA256_CERT_FINGERPRINTS ?? "00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return Response.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
        target: { namespace: "android_app", package_name: process.env.ANDROID_PACKAGE_NAME ?? "com.covva.app", sha256_cert_fingerprints: fingerprints },
      },
    ],
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
