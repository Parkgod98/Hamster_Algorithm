import { Dashboard } from "@/components/dashboard";
import { AccountGate } from "@/components/account-gate";
import { PushNotificationControl } from "@/components/push-notification-control";

export default function DashboardPage(){
  return <AccountGate><PushNotificationControl/><Dashboard githubAppSlug={process.env.GITHUB_APP_SLUG ?? ""}/></AccountGate>;
}
