import { AuthFrame } from "@/components/shell/AuthFrame";
import { ResetPasswordForm } from "./ResetPasswordForm";

export default function ResetPasswordPage() {
  return <AuthFrame title="Choose a new password" subtitle="Multi-factor authentication is still required for admin access."><ResetPasswordForm /></AuthFrame>;
}
