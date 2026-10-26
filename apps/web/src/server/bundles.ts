import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { parseBundleItems, type BundleItem } from "@im/core";
import type { Json, Row } from "@im/db";
import { createPublicClient, createServiceClient } from "@/lib/supabase/server";
import { log } from "@/server/log";

/**
 * Product bundles ("Parents' Care Pack"). A bundle is a set of cover types requested together:
 * the primary request (the category the customer filled in) is tagged with `bundle_id`, and the
 * other items are created as DRAFT requests for the same customer so a broker can quote the pack
 * as one — each item is still its own request / quote / policy with its insurer.
 */
export type Bundle = Row<"product_bundles"> & { parsedItems: BundleItem[] };

function withItems(row: Row<"product_bundles">): Bundle {
  return { ...row, parsedItems: parseBundleItems(row.items) };
}

export async function getPublishedBundle(slug: string): Promise<Bundle | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("bundles", `bundle:${slug}`);
  const { data } = await createPublicClient().from("product_bundles").select("*").eq("slug", slug).eq("status", "published").maybeSingle();
  return data ? withItems(data) : null;
}

export async function listPublishedBundles(): Promise<Bundle[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("bundles");
  const { data } = await createPublicClient().from("product_bundles").select("*").eq("status", "published").order("name");
  return (data ?? []).map(withItems);
}

/**
 * Tag the primary request with the bundle and create one draft request per remaining item (same
 * customer, shared location fields copied over). Service client: `bundle_id` is not a customer-
 * editable column and drafts skip risk validation until the customer completes them. Never throws
 * into the request flow — a bundle that can't be attached just leaves a plain request.
 */
export async function attachBundleRequests(args: { bundleSlug: string; primaryRequestId: string; customerId: string; primaryCategorySlug: string; sharedRisk: Record<string, unknown> }): Promise<{ bundleId: string | null; created: string[] }> {
  const svc = createServiceClient();
  try {
    const { data: bundle } = await svc.from("product_bundles").select("*").eq("slug", args.bundleSlug).eq("status", "published").maybeSingle();
    if (!bundle) return { bundleId: null, created: [] };
    const items = parseBundleItems(bundle.items);
    await svc.from("requests").update({ bundle_id: bundle.id }).eq("id", args.primaryRequestId).eq("customer_id", args.customerId);
    const siblings = items.filter((it) => it.category_slug !== args.primaryCategorySlug);
    if (!siblings.length) return { bundleId: bundle.id, created: [] };
    const { data: categories } = await svc.from("product_categories").select("id, slug, name, availability").in("slug", siblings.map((s) => s.category_slug));
    const shared: Record<string, unknown> = {};
    for (const k of ["region", "city", "address", "location"]) if (args.sharedRisk[k] !== undefined) shared[k] = args.sharedRisk[k];
    const created: string[] = [];
    for (const s of siblings) {
      const cat = categories?.find((c) => c.slug === s.category_slug);
      if (!cat || cat.availability === "planned") continue;
      const { data: row, error } = await svc
        .from("requests")
        .insert({
          customer_id: args.customerId,
          category_id: cat.id,
          type: "new_cover",
          status: "draft",
          source: "web",
          title: `${bundle.name}: ${cat.name}`,
          risk_data: shared as Json,
          bundle_id: bundle.id,
          next_step: `Part of your ${bundle.name}. Add the ${cat.name.toLowerCase()} details to get this part quoted${s.required ? "" : " — or leave it out"}.`,
        })
        .select("id")
        .single();
      if (error) log.warn("bundle.sibling_failed", { bundle: bundle.slug, category: cat.slug, err: error });
      else if (row) {
        created.push(row.id);
        await svc.from("request_events").insert({ request_id: row.id, actor_id: args.customerId, actor_party: "customer", event: "bundle_created", note: `Created as part of the ${bundle.name} bundle.`, data: { bundle_id: bundle.id, primary_request_id: args.primaryRequestId } as Json });
      }
    }
    await svc.from("request_events").insert({ request_id: args.primaryRequestId, actor_id: args.customerId, actor_party: "customer", event: "bundle_created", note: `${bundle.name}: ${created.length} further item${created.length === 1 ? "" : "s"} saved as drafts.`, data: { bundle_id: bundle.id, sibling_request_ids: created } as Json });
    return { bundleId: bundle.id, created };
  } catch (err) {
    log.error("bundle.attach_failed", { bundle: args.bundleSlug, requestId: args.primaryRequestId, err });
    return { bundleId: null, created: [] };
  }
}
