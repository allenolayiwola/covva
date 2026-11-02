// Public micro products API (GET /api/v1/micro/products). It moved here from the marketing site's tests when
// the web app was split: the site's /micro page lists the same products, but only covva-app serves the API.
import { test, expect } from "playwright/test";

const AUDIENCES = ["okada", "trotro", "ride_hailing", "trader", "artisan", "event"];

test.describe("micro products API", () => {
  test("lists published micro products without signing in", async ({ request }) => {
    const res = await request.get("/api/v1/micro/products");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.items)).toBe(true);
    for (const item of body.data.items) {
      expect(item.micro).toBe(true);
      expect(item.versionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(typeof item.productName).toBe("string");
      expect(typeof item.insurerName).toBe("string");
      expect(Array.isArray(item.periods)).toBe(true);
      expect(Array.isArray(item.audienceTags)).toBe(true);
    }
  });

  test("filters by every supported audience", async ({ request }) => {
    for (const audience of AUDIENCES) {
      const res = await request.get(`/api/v1/micro/products?audience=${audience}`);
      expect(res.status(), audience).toBe(200);
      const body = await res.json();
      expect(body.ok, audience).toBe(true);
      expect(Array.isArray(body.data.items), audience).toBe(true);
    }
  });

  test("rejects an unknown audience with a 400 and a field-level error", async ({ request }) => {
    const res = await request.get("/api/v1/micro/products?audience=not-an-audience");
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("invalid_input");
    expect(body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: "audience" })]));
  });
});
