import { redirect } from "next/navigation";

/** Pure redirect — allowed to block (no UI to stream). */
export const instant = false;

/** Notification links point here; complaints are handled in Service & claims. */
export default async function ComplaintRedirect({ params }: PageProps<"/partner/complaints/[id]">) {
  const { id } = await params;
  redirect(`/partner/service?complaint=${encodeURIComponent(id)}`);
}
