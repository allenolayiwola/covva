import { createClient } from "@/lib/supabase/server";
import { schemeForRequest } from "@/server/business";
import { SchemeCensus, SchemeMemberTable } from "./scheme-members";

/**
 * Group scheme census + members behind a policy's request, for the insurer issuing it (RLS: the scheme's insurer
 * and broker only). Renders nothing for non-group policies. Reads cookies — render inside <Suspense>.
 */
export async function SchemeMembersSection({ requestId }: { requestId: string }) {
  const supabase = await createClient();
  const found = await schemeForRequest(supabase, requestId);
  if (!found) return null;
  return (
    <details className="mt-4 rounded-xl border border-line p-3">
      <summary className="cursor-pointer text-sm font-semibold text-brand">Group scheme {found.scheme.name} · {found.census.lives} lives — census and members</summary>
      <div className="mt-3 space-y-3">
        <SchemeCensus census={found.census} />
        <SchemeMemberTable members={found.members} />
      </div>
    </details>
  );
}
