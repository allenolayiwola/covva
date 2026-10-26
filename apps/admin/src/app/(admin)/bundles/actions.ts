"use server";
import { z } from "zod";
import { parseBundleItems } from "@im/core";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const Bundle = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  slug: z.string().trim().regex(/^[a-z0-9-]{3,80}$/, "Slug: lowercase letters, numbers and dashes"),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).optional(),
  audience: z.enum(["diaspora", "sme", "individual"]),
  items: z.string().trim().min(2, "Items JSON is required"),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  status: z.enum(["draft", "published"]),
});

/** Create or update a product bundle (catalogue staff). Items: JSON array of { category_slug, product_code?, required }. */
export async function saveBundle(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("catalogue");
  if (!auth.ok) return fail(auth.error);
  const parsed = Bundle.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const d = parsed.data;
  let raw: unknown;
  try {
    raw = JSON.parse(d.items);
  } catch {
    return fail("Items must be valid JSON, e.g. [{\"category_slug\":\"health\",\"required\":true}].");
  }
  const items = parseBundleItems(raw);
  if (!items.length) return fail("Add at least one item with a category_slug.");
  const { data: cats } = await auth.supabase.from("product_categories").select("slug").in("slug", items.map((i) => i.category_slug));
  const known = new Set((cats ?? []).map((c) => c.slug));
  const unknown = items.filter((i) => !known.has(i.category_slug)).map((i) => i.category_slug);
  if (unknown.length) return fail(`Unknown category slug(s): ${unknown.join(", ")}.`);
  const row = { slug: d.slug, name: d.name, description: d.description || null, audience: d.audience, items, discount_pct: d.discountPct, status: d.status };
  const { error } = d.id ? await auth.supabase.from("product_bundles").update(row).eq("id", d.id) : await auth.supabase.from("product_bundles").insert(row);
  if (error) return fail(dbMessage(error));
  return done(`Bundle “${d.name}” ${d.id ? "updated" : "created"} (${d.status}). The marketing page refreshes within the hour.`);
}
