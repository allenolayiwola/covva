/**
 * Campaign tags attached to a lead (renewal reminders, referrals, waitlist, diaspora groups…).
 * `public.leads` has no dedicated column yet, so tags and small metadata are stored inside the
 * `utm` jsonb bag (`utm.tags`, `utm.metadata`) by `submitLead` and echoed in the message so the
 * admin inbox shows them. Plain data: safe to import from client components and Server Actions.
 */
export const LEAD_TAGS = ["renewal_reminder", "referral", "diaspora_group", "waitlist", "launch_partner", "embedded", "group_plan"] as const;
export type LeadTag = (typeof LEAD_TAGS)[number];
