import { AccountGate } from "@/components/account-gate";
import { StudyBrowser } from "@/components/study-browser";

export default function StudiesPage() {
  return <AccountGate><StudyBrowser /></AccountGate>;
}
