import { notFound } from "next/navigation";

/**
 * Branded 404 for URLs that match no route. Since the Payload admin got its own root layout, the
 * site's root layout lives in app/(site) and a top-level `not-found.tsx` is no longer possible;
 * this catch-all (every real route is more specific and wins) throws `notFound()` before anything
 * streams, so `(site)/not-found.tsx` renders with a real 404 status, as before.
 */
export default function CatchAllNotFound(): never {
  notFound();
}
