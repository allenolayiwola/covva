import type { AnchorHTMLAttributes, ComponentProps } from "react";
import Link from "next/link";

/** Paths served by the app (covva-app), not this site. Mirrors APP_PATHS in src/proxy.ts. */
const APP_PATHS = [
  "/account", "/partner", "/onboarding", "/sign-in", "/sign-up", "/sign-out", "/auth", "/forgot-password", "/reset-password",
  "/invite", "/quote", "/q", "/consent", "/embed",
];

export function isAppHref(href: string): boolean {
  const path = href.split(/[?#]/)[0]!;
  return APP_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Link to a page in the app (sign-in, account, partner workspace, quote flow). A plain anchor on purpose: the
 * browser does a full navigation to this site's path, and the site proxy forwards it to the app with the
 * visitor's referral code. Next's <Link> would try to prefetch it as a page of this site.
 */
export function AppLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} />;
}

/** Next <Link> for site pages, <AppLink> for app pages: for hrefs that come from data. */
export function SmartLink({ href, prefetch, scroll, replace, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  if (isAppHref(href)) return <AppLink href={href} {...(props as AnchorHTMLAttributes<HTMLAnchorElement>)} />;
  return <Link href={href} prefetch={prefetch} scroll={scroll} replace={replace} {...props} />;
}
