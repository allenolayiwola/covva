/** Demo partner names carry a "(Demo)" suffix in the DB; we show a DemoBadge instead. Pure, safe for client components. */
export function displayOrgName(name: string): string {
  return name.replace(/\s*\(demo\)\s*$/i, "").trim();
}
