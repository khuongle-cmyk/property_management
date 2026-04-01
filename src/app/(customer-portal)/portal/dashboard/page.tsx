import { redirect } from "next/navigation";

/** Alias: dashboard lives at /portal */
export default function CustomerPortalDashboardAliasPage() {
  redirect("/portal");
}
