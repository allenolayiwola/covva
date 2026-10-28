import { redirect } from "next/navigation";

/** `?t=<link or code>` from the "Have an invitation link?" box → the join page for that token. */
export default async function JoinRedirect({ searchParams }: PageProps<"/account/groups/join">) {
  const sp = await searchParams;
  const raw = (Array.isArray(sp.t) ? sp.t[0] : sp.t) ?? "";
  const m = /join\/([a-z0-9]{8,80})/i.exec(raw);
  const token = (m ? m[1] : raw.trim()).replace(/[^a-z0-9]/gi, "").slice(0, 80);
  redirect(token.length >= 8 ? `/account/groups/join/${encodeURIComponent(token)}` : "/account/groups");
}
