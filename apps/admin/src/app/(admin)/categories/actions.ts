"use server";
import { z } from "zod";
import type { Enum, Json } from "@im/db";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { DOCUMENT_KINDS, LAUNCH_CHECKLIST, RiskSchemaSchema } from "@/lib/catalogue";
import { revalidateEverywhere, webCacheNote } from "@/lib/revalidate";

const Category = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  short_description: z.string().trim().max(300).optional(),
  description: z.string().trim().max(4000).optional(),
  icon: z.string().trim().max(40).optional(),
  segment: z.enum(["personal", "business", "specialist"]),
  sort_order: z.coerce.number().int().min(0).max(10000),
  default_sla_hours: z.coerce.number().int().min(1, "SLA must be at least 1 hour").max(24 * 30),
  regulatory_note: z.string().trim().max(2000).optional(),
  availability: z.enum(["integrated", "broker_assisted", "planned"]),
  risk_schema: z.string().min(2, "Risk schema is required"),
});

/**
 * Save a category. Launch gate (spec: "A category becomes available only after
 * approval"): `integrated` requires all seven launch checklist items. The web app
 * caches the catalogue separately, so we also ask it to revalidate the `catalog` tag.
 */
export async function saveCategory(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("catalogue");
  if (!auth.ok) return fail(auth.error);
  const raw = formObject(fd);
  const parsed = Category.safeParse(raw);
  if (!parsed.success) return zodError(parsed.error);
  const d = parsed.data;

  const checklist: Record<string, boolean> = {};
  for (const item of LAUNCH_CHECKLIST) checklist[item.key] = raw[`lc_${item.key}`] === "on";
  const missing = LAUNCH_CHECKLIST.filter((i) => !checklist[i.key]);
  if (d.availability === "integrated" && missing.length) {
    return fail(
      `Launch gate: a category can be set to “integrated” only when all 7 launch items are recorded. Missing: ${missing.map((m) => m.label).join(", ")}. Use “broker assisted” until then.`,
    );
  }

  let schemaJson: unknown;
  try {
    schemaJson = JSON.parse(d.risk_schema);
  } catch {
    return fail("The risk schema is not valid JSON.");
  }
  const schema = RiskSchemaSchema.safeParse(schemaJson);
  if (!schema.success) {
    const i = schema.error.issues[0]!;
    const idx = typeof i.path[0] === "number" ? ` (field ${i.path[0] + 1})` : "";
    return fail(`Risk schema${idx}: ${i.message}`);
  }

  const rawDocs = raw.required_documents;
  const docs = (Array.isArray(rawDocs) ? rawDocs : rawDocs ? [rawDocs] : []).filter((x): x is Enum<"document_kind"> =>
    (DOCUMENT_KINDS as string[]).includes(String(x)),
  );

  const { error } = await auth.supabase
    .from("product_categories")
    .update({
      name: d.name,
      short_description: d.short_description || null,
      description: d.description || null,
      icon: d.icon || null,
      segment: d.segment,
      sort_order: d.sort_order,
      default_sla_hours: d.default_sla_hours,
      regulatory_note: d.regulatory_note || null,
      availability: d.availability,
      launch_checklist: checklist,
      risk_schema: schema.data as unknown as Json,
      required_documents: docs,
    })
    .eq("id", d.categoryId);
  if (error) return fail(dbMessage(error));
  const web = await revalidateEverywhere(["catalog"]);
  return done(`Category saved. ${webCacheNote(web)}`);
}
