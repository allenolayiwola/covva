import { redirect } from "next/navigation";

/** /account/payments → the sponsor subscriptions list (saved cards live under /methods). */
export default function PaymentsIndex() {
  redirect("/account/payments/subscriptions");
}
