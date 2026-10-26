import { getPartnerDirectory } from "@/lib/catalog";
import { withApi } from "@/server/api-auth";

/** GET /api/v1/catalog/insurers — public directory of active insurers and brokers. */
export const GET = withApi(
  async () => {
    const { insurers, brokers } = await getPartnerDirectory();
    const demo = (o: { settings: unknown }) => !!(o.settings as { demo?: boolean } | null)?.demo;
    return {
      insurers: insurers.map((o) => ({ ...o, demo: demo(o) })),
      brokers: brokers.map((o) => ({ ...o, demo: demo(o) })),
    };
  },
  { auth: "none" },
);
