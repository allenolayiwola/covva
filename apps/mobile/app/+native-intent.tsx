import { mapIncomingLink } from '../src/lib/deep-links';

// Rewrites universal / app links (https://<our domain>/account/...) to app routes.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return mapIncomingLink(path);
  } catch {
    return '/';
  }
}
