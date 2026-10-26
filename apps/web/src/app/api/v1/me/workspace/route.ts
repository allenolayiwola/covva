import { SetActiveWorkspaceInput, accessMessage, workspaceAccess } from "@im/core";
import { check, forbidden, parseJson, siteUrl, withApi } from "@/server/api-auth";
import { buildWorkspaces } from "@/server/workspaces";

/**
 * POST /api/v1/me/workspace — persist the workspace a dual-role user chose
 * (`profiles.active_workspace`). The choice must be one of the user's workspaces and usable from
 * the calling client (an insurer workspace cannot be activated from the mobile app).
 */
export const POST = withApi(
  async ({ auth, req, client }) => {
    const input = await parseJson(req, SetActiveWorkspaceInput);
    const { data: memberships } = await auth.supabase
      .from("memberships")
      .select("id, org_id, role, org:organizations!memberships_org_id_fkey(id, name, type)")
      .eq("user_id", auth.userId)
      .eq("active", true);
    const workspaces = buildWorkspaces(memberships ?? [], client);
    const chosen = workspaces.find((w) => w.type === input.type && (w.type === "customer" || w.orgId === input.orgId));
    if (!chosen) throw forbidden("You don't belong to that workspace.");
    if (!chosen.allowed) {
      const access = workspaceAccess(chosen.type, client);
      throw forbidden(accessMessage(access, siteUrl()) ?? "That workspace isn't available on this client.");
    }
    const activeWorkspace = chosen.type === "customer" ? { type: "customer" as const } : { type: chosen.type, orgId: chosen.orgId! };
    const res = await auth.supabase.from("profiles").update({ active_workspace: activeWorkspace, last_seen_platform: client }).eq("id", auth.userId);
    check(res);
    return { activeWorkspace, workspace: chosen };
  },
  { auth: "user" },
);
