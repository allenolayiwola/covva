/**
 * The email sent to the payment provider. Paystack requires one and rejects reserved test domains
 * (RFC 2606/6761: .example, .test, .invalid, .localhost, example.com/net/org), which demo and test
 * accounts use; phone-only customers have none. Both get a stable stand-in on Covva's payments domain.
 */
export function payerEmail(email: string | null | undefined, localPart: string): string {
  const e = (email ?? "").trim().toLowerCase();
  const domain = e.includes("@") ? e.split("@").pop()! : "";
  const reserved = !domain || /(^|\.)(example|test|invalid|localhost)$/.test(domain) || /^example\.(com|net|org)$/.test(domain);
  return reserved ? `${localPart}@payments.covva.com.gh` : e;
}
