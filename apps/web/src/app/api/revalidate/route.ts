import { revalidateTag } from "next/cache";
import { z } from "zod";
import { secretMatches } from "@/server/env";
import { log } from "@/server/log";

const Body = z.object({ tags: z.array(z.string().min(1).max(200)).min(1).max(50) });

/** POST /api/revalidate — admin app invalidates cached catalogue/settings tags. Header: x-revalidate-secret. */
export async function POST(req: Request) {
  if (!secretMatches(req.headers.get("x-revalidate-secret"), process.env.REVALIDATE_SECRET)) {
    return Response.json({ ok: false, error: { code: "unauthorised", message: "Invalid revalidation secret" } }, { status: 401 });
  }
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: { code: "invalid_input", message: "Body must be { tags: string[] }" } }, { status: 400 });
  }
  for (const tag of body.tags) revalidateTag(tag, "max");
  log.info("revalidate", { tags: body.tags });
  return Response.json({ ok: true, data: { revalidated: body.tags, at: new Date().toISOString() } });
}
