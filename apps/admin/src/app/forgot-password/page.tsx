import { AuthFrame } from "@/components/shell/AuthFrame";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return <AuthFrame title="Reset your password" subtitle="Need help? Contact your Covva platform administrator."><ForgotPasswordForm /></AuthFrame>;
}
