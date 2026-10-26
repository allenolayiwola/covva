import { OPENAPI_YAML } from "@/server/openapi-spec";

/** GET /api/v1/openapi — the OpenAPI 3.1 document (static; regenerate with docs/api/build-openapi-ts.mjs). */
export function GET() {
  return new Response(OPENAPI_YAML, {
    headers: { "content-type": "application/yaml; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
  });
}
