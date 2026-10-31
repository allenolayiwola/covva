/** Directory status is authoritative; a CMS logo or licence number alone is not verification. */
export function isVerifiedPartner(org: {
  status: string;
  licence_status: string;
  licence_verified_at: string | null;
  settings: unknown;
}): boolean {
  const demo = !!org.settings && typeof org.settings === "object" && (org.settings as { demo?: unknown }).demo === true;
  return org.status === "active" && org.licence_status === "verified" && !!org.licence_verified_at && !demo;
}
