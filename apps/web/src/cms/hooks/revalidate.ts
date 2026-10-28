import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from "payload";

/**
 * Publish → site refresh. Every site reader is tagged `cms` plus `cms:<collection>`; a save or
 * delete in the admin invalidates those tags so the next request renders the new content.
 *
 * `revalidateTag` only works inside a Next request (admin UI, REST API). The Payload CLI (migrate,
 * seed) runs outside Next, where the call throws and is ignored.
 */
async function revalidate(tags: string[]) {
  try {
    const { revalidateTag } = await import("next/cache");
    // expire: 0 — editors must see their change on the very next request, not after one stale view.
    for (const tag of tags) revalidateTag(tag, { expire: 0 });
  } catch {
    // Outside a Next request (CLI): nothing to invalidate.
  }
}

export function revalidateCollection(slug: string): { afterChange: CollectionAfterChangeHook[]; afterDelete: CollectionAfterDeleteHook[] } {
  const tags = ["cms", `cms:${slug}`];
  return {
    afterChange: [
      async ({ doc, previousDoc }) => {
        // Autosaved drafts do not change the public site unless the doc was published before.
        const status = (doc as { _status?: string })._status;
        const previous = (previousDoc as { _status?: string } | undefined)?._status;
        if (status === "published" || previous === "published" || (status === undefined && previous === undefined)) await revalidate(tags);
        return doc;
      },
    ],
    afterDelete: [
      async ({ doc }) => {
        await revalidate(tags);
        return doc;
      },
    ],
  };
}
