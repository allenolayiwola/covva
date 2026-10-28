import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Notice, PageHeader, Pill, Table, Tabs, Td, Th, THead, buttonClass } from "@im/ui";
import { formatDateTime } from "@im/core";
import { partnerMfaRequired } from "@/lib/auth";
import { ROLES, can, getPartnerContext } from "../../../_lib/context";
import { ActionForm } from "@/components/partner/action-form";
import { Empty, KV, PageSkeleton, Section } from "@/components/partner/ui";
import { removeDevice, revokeSession, setRequireMfa, signOutEverywhere } from "./actions";

export const metadata: Metadata = { title: "Security" };

/**
 * Security settings for partner accounts (Addendum 4): two-step verification status, the
 * user's active sessions with remote sign-out, "sign out everywhere", and registered mobile devices.
 */
export default function SecurityPage() {
  return (
    <>
      <PageHeader title="Security" description="Two-step verification, where you're signed in, and the devices linked to your account." />
      <Suspense fallback={<PageSkeleton stats={0} />}>
        <Security />
      </Suspense>
    </>
  );
}

interface SessionRow {
  id: string;
  created_at: string;
  updated_at: string | null;
  user_agent: string | null;
  ip: string | null;
  aal: string | null;
  not_after: string | null;
}

/** "Chrome on Windows", "Safari on iPhone", "Covva mobile app" … from a user-agent string. */
function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const s = ua.toLowerCase();
  if (/covva|expo|okhttp|cfnetwork|darwin/.test(s) && !/mozilla/.test(s)) return "Covva mobile app";
  const os = /iphone/.test(s) ? "iPhone" : /ipad/.test(s) ? "iPad" : /android/.test(s) ? "Android" : /windows/.test(s) ? "Windows" : /mac os|macintosh/.test(s) ? "Mac" : /linux/.test(s) ? "Linux" : /cros/.test(s) ? "ChromeOS" : null;
  const browser = /edg\//.test(s) ? "Edge" : /opr\/|opera/.test(s) ? "Opera" : /firefox|fxios/.test(s) ? "Firefox" : /chrome|crios/.test(s) ? "Chrome" : /safari/.test(s) ? "Safari" : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}

async function Security() {
  const ctx = await getPartnerContext();
  const admin = can(ctx, ROLES.orgAdmin);
  const [{ data: claims }, factors, sessionsRes, devicesRes, orgRes] = await Promise.all([
    ctx.supabase.auth.getClaims(),
    ctx.supabase.auth.mfa.listFactors(),
    ctx.supabase.rpc("list_my_sessions"),
    ctx.supabase.from("device_tokens").select("id, platform, provider, app_version, last_seen_at, created_at").eq("user_id", ctx.userId).order("last_seen_at", { ascending: false }),
    ctx.supabase.from("organizations").select("require_mfa").eq("id", ctx.orgId).maybeSingle(),
  ]);
  const currentSessionId = (claims?.claims as { session_id?: string; aal?: string } | undefined)?.session_id ?? null;
  const currentAal = (claims?.claims as { aal?: string } | undefined)?.aal ?? null;
  const verifiedFactors = factors.data?.totp.filter((f) => f.status === "verified") ?? [];
  // revoke_my_session expires a session (not_after = now()) rather than deleting it; hide ended ones.
  const sessions = ((sessionsRes.data ?? []) as SessionRow[]).filter((s) => !s.not_after || new Date(s.not_after) > new Date()).sort((a, b) => (a.id === currentSessionId ? -1 : b.id === currentSessionId ? 1 : 0));
  const devices = devicesRes.data ?? [];
  const orgRequires = orgRes.data?.require_mfa !== false;
  const platformRequires = partnerMfaRequired();

  const tabs = [
    { key: "team", label: "Team", href: "/partner/settings?tab=team" },
    { key: "security", label: "Security", href: "/partner/settings/security" },
  ];

  return (
    <div className="space-y-6">
      <Tabs className="w-fit max-w-full" active="security" items={tabs} />

      <Section title="Two-step verification" description="An authenticator app (TOTP) protects broker and insurer accounts in addition to your password.">
        <div className="max-w-2xl">
          <KV label="Status">
            {verifiedFactors.length ? <Pill tone="ok">Enabled · {verifiedFactors.length} authenticator{verifiedFactors.length === 1 ? "" : "s"}</Pill> : <Pill tone="wait">Not set up</Pill>}
          </KV>
          <KV label="This session">{currentAal === "aal2" ? <Pill tone="ok">Verified (AAL2)</Pill> : <Pill>Password only (AAL1)</Pill>}</KV>
          <KV label="Required">
            {platformRequires && orgRequires ? "Yes — for everyone in your organisation" : platformRequires ? "Not enforced for your organisation (admin setting)" : "Not enforced on this environment"}
          </KV>
          <div className="mt-4 flex flex-wrap gap-2">
            {verifiedFactors.length === 0 ? (
              <Link href="/partner/mfa?manage=1&next=%2Fpartner%2Fsettings%2Fsecurity" className={buttonClass("primary", "sm")}>Set up an authenticator app</Link>
            ) : (
              <Link href="/partner/mfa?manage=1&next=%2Fpartner%2Fsettings%2Fsecurity" className={buttonClass("secondary", "sm")}>Add another authenticator</Link>
            )}
          </div>
          {admin && (
            <div className="mt-6 rounded-xl border border-line bg-mist/40 p-4">
              <p className="text-sm font-semibold text-ink">Organisation policy</p>
              <p className="mt-1 text-sm text-muted">
                {orgRequires ? "Everyone in your organisation must verify with an authenticator app before using the workspace." : "Two-step verification is optional for your organisation. We strongly recommend requiring it."}
              </p>
              <ActionForm action={setRequireMfa} submitLabel={orgRequires ? "Stop requiring" : "Require for everyone"} variant={orgRequires ? "outline" : "primary"} inline className="mt-3" confirm={orgRequires ? "Stop requiring two-step verification for your organisation? The platform may still enforce it." : undefined}>
                <input type="hidden" name="require_mfa" value={orgRequires ? "false" : "true"} />
              </ActionForm>
            </div>
          )}
        </div>
      </Section>

      <Section title="Where you're signed in" description="Every active session for your account. Sign out any device you don't recognise.">
        {sessions.length === 0 ? (
          <Empty>We couldn&apos;t list your sessions right now.</Empty>
        ) : (
          <Table>
            <THead><tr><Th>Device</Th><Th>IP address</Th><Th>Signed in</Th><Th>Last active</Th><Th>Verification</Th><Th>Action</Th></tr></THead>
            <tbody>
              {sessions.map((s) => {
                const current = s.id === currentSessionId;
                return (
                  <tr key={s.id}>
                    <Td>
                      <p className="font-medium text-ink">{describeUserAgent(s.user_agent)}{current && <Pill tone="ok" className="ml-2">This device</Pill>}</p>
                      {s.user_agent && <p className="max-w-xs truncate text-xs text-subtle" title={s.user_agent}>{s.user_agent}</p>}
                    </Td>
                    <Td>{s.ip ?? "—"}</Td>
                    <Td>{formatDateTime(s.created_at)}</Td>
                    <Td>{s.updated_at ? formatDateTime(s.updated_at) : "—"}</Td>
                    <Td>{s.aal === "aal2" ? <Pill tone="ok">Verified</Pill> : <Pill>Password only</Pill>}</Td>
                    <Td>
                      <ActionForm action={revokeSession} submitLabel={current ? "Sign out" : "Sign out this device"} variant="ghost" inline confirm={current ? "Sign out of this browser?" : "Sign out this device? It will need to sign in again."}>
                        <input type="hidden" name="sessionId" value={s.id} />
                      </ActionForm>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ActionForm action={signOutEverywhere} submitLabel="Sign out everywhere" variant="outline" inline confirm="Sign out of every other device? This browser stays signed in.">
            <input type="hidden" name="scope" value="others" />
          </ActionForm>
          <p className="text-xs text-muted">Ends every session except this one.</p>
        </div>
      </Section>

      <Section title="Mobile devices" description="Phones that receive push notifications from the Covva app for this account.">
        {devices.length === 0 ? (
          <Empty>No mobile devices registered.</Empty>
        ) : (
          <Table>
            <THead><tr><Th>Device</Th><Th>App version</Th><Th>Registered</Th><Th>Last seen</Th><Th>Action</Th></tr></THead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <Td><span className="font-medium capitalize text-ink">{d.platform}</span> <span className="text-xs text-muted">· {d.provider}</span></Td>
                  <Td>{d.app_version ?? "—"}</Td>
                  <Td>{formatDateTime(d.created_at)}</Td>
                  <Td>{formatDateTime(d.last_seen_at)}</Td>
                  <Td>
                    <ActionForm action={removeDevice} submitLabel="Remove" variant="ghost" inline confirm="Remove this device? It stops receiving push notifications until the app registers again.">
                      <input type="hidden" name="deviceId" value={d.id} />
                    </ActionForm>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {ctx.kind === "insurer" && <Notice tone="info" className="mt-4">Insurer accounts use the web portal only. The mobile app is for customers and brokers; an insurer user who signs in there is shown a message pointing to this portal.</Notice>}
      </Section>
    </div>
  );
}

