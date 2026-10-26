import { uuidParam, withApi } from "@/server/api-auth";
import { revealGift } from "@/server/diaspora";

type Route = { params: Promise<{ id: string }> };

/** POST /api/v1/family/sponsorships/{id}/reveal — the beneficiary (linked account) opens a gift and reads the message. */
export const POST = withApi<"user", Route>(
  async ({ auth }, { params }) => {
    const id = uuidParam((await params).id);
    return revealGift(auth.supabase, id);
  },
  { auth: "user" },
);
