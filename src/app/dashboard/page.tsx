import { Dashboard } from "@/components/dashboard";
import { PushNotificationControl } from "@/components/push-notification-control";

export default function DashboardPage(){
  return <><PushNotificationControl/><Dashboard githubAppSlug={process.env.GITHUB_APP_SLUG ?? ""}/></>;
}
