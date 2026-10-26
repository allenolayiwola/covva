import "server-only";

/**
 * Notification fan-out (owner: Backend stream): in-app row + email + SMS + push
 * according to the user's notification_prefs. Foundation stub; Backend implements.
 */
export interface NotifyInput {
  userId: string;
  kind: string;            // e.g. "quote.ready", "policy.issued", "claim.status"
  title: string;
  body?: string;
  link?: string;           // web path; mobile maps it to a deep link
  data?: Record<string, unknown>;
  channels?: ("in_app" | "email" | "sms" | "push")[];
}

export async function notify(_input: NotifyInput | NotifyInput[]): Promise<void> {
  // Backend replaces this with real delivery. Keep a no-op so callers work during development.
}

/** Notify every active member of an organisation (optionally filtered by role). */
export async function notifyOrg(_orgId: string, _input: Omit<NotifyInput, "userId">, _roles?: string[]): Promise<void> {}
