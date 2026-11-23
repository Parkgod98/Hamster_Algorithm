import { AccountGate } from "@/components/account-gate";
import { InvitePreview } from "@/components/invite-preview";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <AccountGate><InvitePreview code={code} /></AccountGate>;
}
