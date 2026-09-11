import { Dashboard } from "@/components/dashboard";
export default function DashboardPage(){ return <Dashboard githubAppSlug={process.env.GITHUB_APP_SLUG ?? ""}/>; }
