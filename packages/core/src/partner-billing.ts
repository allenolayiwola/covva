/** Partner platform-fee invoices, independent of premium payments and commission. */
export type PartnerInvoiceStatus = "draft" | "issued" | "paid" | "void";

export function canTransitionPartnerInvoice(from: string, to: string): boolean {
  return (from === "draft" && (to === "issued" || to === "paid" || to === "void")) ||
    (from === "issued" && (to === "paid" || to === "void"));
}

export function transitionPartnerInvoice(from: string, to: string): PartnerInvoiceStatus {
  if (!canTransitionPartnerInvoice(from, to)) throw new Error(`Cannot move an invoice from ${from} to ${to}.`);
  return to as PartnerInvoiceStatus;
}
