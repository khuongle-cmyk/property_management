import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  computeAppNavFlagsFromRoles,
  LOGGED_OUT_APP_NAV_INITIAL,
  type AppNavInitialState,
} from "./nav-flags";

export type { AppNavInitialState };

export async function getAppNavInitialState(): Promise<AppNavInitialState> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return LOGGED_OUT_APP_NAV_INITIAL;
    }

    const displayName = String(
      user.user_metadata?.full_name ??
        user.user_metadata?.name ??
        user.email?.split("@")[0] ??
        "User",
    );

    const { data: memberships, error: membershipsError } = await supabase
      .from("memberships")
      .select("role");

    if (membershipsError) {
      return {
        loggedIn: true,
        displayName,
        email: user.email ?? "",
        ...computeAppNavFlagsFromRoles([]),
      };
    }

    const roles = (memberships ?? []).map((m) => (m.role ?? "").toLowerCase());
    return {
      loggedIn: true,
      displayName,
      email: user.email ?? "",
      ...computeAppNavFlagsFromRoles(roles),
    };
  } catch {
    return LOGGED_OUT_APP_NAV_INITIAL;
  }
}
