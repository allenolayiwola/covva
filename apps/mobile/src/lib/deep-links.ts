/**
 * Universal / App Links. The same hosts must be listed in app.json
 * (ios.associatedDomains, android.intentFilters) and serve covva-app's
 * /.well-known files. Keep the Vercel host until app.covva.com.gh is live.
 */
export const LINK_DOMAINS = ['insurance-marketplace-tau.vercel.app', 'app.covva.com.gh'] as const;

/** Web paths the app claims. Mirrors apps/web/.well-known/apple-app-site-association. */
export const LINK_PATH_PREFIXES = ['/account', '/auth/callback'] as const;

/**
 * Maps a web URL on one of our domains to an app route. Anything else
 * (covva:// links, app paths, other hosts) is returned unchanged.
 */
export function mapIncomingLink(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input;
  }
  if (url.protocol !== 'https:' || !(LINK_DOMAINS as readonly string[]).includes(url.hostname)) return input;

  // Path segments arrive percent-encoded; decode so ids are re-encoded exactly once.
  const parts = url.pathname.split('/').filter(Boolean).map(safeDecode);
  if (parts[0] !== 'account') return '/';

  const [, section, id] = parts;
  if (section === 'policies' && id && id !== 'new') return `/policies/${encodeURIComponent(id)}`;
  if (section === 'policies') return '/policies';
  if (section === 'requests') return '/requests';
  if (section === 'profile') return '/account';
  return '/';
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
