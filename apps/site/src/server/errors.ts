/** Business-rule errors shared by the site's server modules (the app keeps these in server/requests.ts). */
export class BusinessRuleError extends Error {
  constructor(message: string, public code = "business_rule") {
    super(message);
  }
}

/** Map Postgres trigger (P0001) errors to readable messages. */
export function ruleMessage(err: { code?: string; message?: string } | null | undefined, fallback = "Something went wrong") {
  if (!err) return fallback;
  if (err.code === "P0001" && err.message) return err.message;
  if (err.code === "23505") return "This has already been submitted.";
  return fallback;
}
