/** The configured admin origin; never derive recovery links from the browser host. */
export function adminSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_ADMIN_URL?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "development") return "http://localhost:3001";
    throw new Error("NEXT_PUBLIC_ADMIN_URL is required for admin recovery links");
  }
  const url = new URL(configured);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("NEXT_PUBLIC_ADMIN_URL must be an HTTP(S) URL without credentials");
  }
  return url.origin;
}

export function adminPasswordResetUrl(): string {
  return new URL("/reset-password", adminSiteUrl()).toString();
}
