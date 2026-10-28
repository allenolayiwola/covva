/**
 * CMS environment. Read at call time so the Next build (CI has no secrets) and the Payload CLI both
 * work. With `DATABASE_URI` unset the CMS is *disabled*: the admin shows a notice, the API answers
 * 503 and every site read falls back to the typed content in `components/marketing/*`.
 *
 * No `server-only` import here: the Payload CLI (`payload migrate`, `cms:seed`) loads this file
 * outside Next.
 */
export interface CmsEnv {
  databaseUri: string | null;
  secret: string | null;
  siteUrl: string;
  storage: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; publicUrl: string } | null;
}

export function cmsEnv(): CmsEnv {
  const databaseUri = process.env.DATABASE_URI?.trim() || null;
  const secret = process.env.PAYLOAD_SECRET?.trim() || null;
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const endpoint = process.env.CMS_S3_ENDPOINT?.trim();
  const bucket = process.env.CMS_S3_BUCKET?.trim() || "cms-media";
  const accessKeyId = process.env.CMS_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.CMS_S3_SECRET_ACCESS_KEY?.trim();
  const region = process.env.CMS_S3_REGION?.trim() || "eu-west-2";
  const publicUrl = process.env.CMS_MEDIA_PUBLIC_URL?.trim().replace(/\/$/, "") || "";
  const storage = endpoint && accessKeyId && secretAccessKey && publicUrl ? { endpoint, region, bucket, accessKeyId, secretAccessKey, publicUrl } : null;
  return { databaseUri, secret, siteUrl, storage };
}

/** True when Payload can start: a database and a secret are configured. */
export function cmsConfigured(): boolean {
  const env = cmsEnv();
  return Boolean(env.databaseUri && env.secret);
}

/** Why the CMS is off, for the admin notice and logs. */
export function cmsDisabledReason(): string | null {
  const env = cmsEnv();
  if (!env.databaseUri) return "DATABASE_URI is not set";
  if (!env.secret) return "PAYLOAD_SECRET is not set";
  return null;
}
