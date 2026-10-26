import { PartnerRenewalsQuery } from "@im/core";
import { parseQuery, withApi } from "@/server/api-auth";
import { renewals } from "@/server/partner-analytics";
import { resolvePartnerOrg } from "@/server/partner-mobile";

/**
 * GET /api/v1/partner/renewals?days=30 — active policies ending within N days (soonest first), with the
 * customer's display name, contact-permission flags and whether a renewal request already exists.
 * Brokers (broker of record) see full names and contact details; insurer users (web only) see
 * first name + initial and no contact details. Keys: scope policies:read.
 */
export const GET = withApi(
  async ({ auth, req, client }) => {
    const q = parseQuery(req, PartnerRenewalsQuery);
    const p = await resolvePartnerOrg(auth, req, client, { orgId: q.orgId });
    const rows = await renewals(p.db, p.orgId, q.days);
    return {
      windowDays: q.days,
      count: rows.length,
      items: rows.map((r) => ({
        policyId: r.policy_id,
        reference: r.internal_reference,
        policyNumber: r.policy_number,
        category: { id: r.category_id, name: r.category_name },
        coverEnd: r.cover_end,
        daysLeft: r.days_left,
        premium: r.premium,
        currency: r.currency,
        status: r.status,
        customer: { id: r.customer_id, name: r.customer_name, email: r.customer_email, phone: r.customer_phone },
        contactAllowed: r.contact_allowed,
        marketingAllowed: r.marketing_allowed,
        renewalRequest: r.renewal_request_id ? { id: r.renewal_request_id, status: r.renewal_status } : null,
        remindersSent: r.reminders_sent,
      })),
      note: "Any renewal price is an estimate until the insurer confirms it. Contact the customer only where contactAllowed is true.",
    };
  },
  { auth: "either", scopes: ["policies:read"] },
);
