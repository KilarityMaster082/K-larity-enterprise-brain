// Owner task: EB-93 Settings: connected sources and members — /settings is the first settings tab. Old ?tab= links keep working.
import { redirect } from "next/navigation";

export default async function SettingsIndex({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  redirect(tab === "members" ? "/settings/members" : tab === "audit" || tab === "data" ? "/settings/security" : "/settings/sources");
}
