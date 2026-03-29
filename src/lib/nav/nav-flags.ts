export type AppNavVisibilityFlags = {
  isSuperAdmin: boolean;
  showManageBookings: boolean;
  showOwnerDashboard: boolean;
  showRoomsNav: boolean;
  showCrmNav: boolean;
  showReportsNav: boolean;
  showMarketingNav: boolean;
};

export type AppNavInitialState = AppNavVisibilityFlags & {
  loggedIn: boolean;
  displayName: string;
  email: string;
};

export const LOGGED_OUT_APP_NAV_INITIAL: AppNavInitialState = {
  loggedIn: false,
  displayName: "User",
  email: "",
  isSuperAdmin: false,
  showManageBookings: false,
  showOwnerDashboard: false,
  showRoomsNav: false,
  showCrmNav: false,
  showReportsNav: false,
  showMarketingNav: false,
};

function canSeeManageBookingsNav(role: string): boolean {
  return ["owner", "manager", "customer_service"].includes(role);
}

export function computeAppNavFlagsFromRoles(roles: string[]): AppNavVisibilityFlags {
  return {
    isSuperAdmin: roles.includes("super_admin"),
    showReportsNav: roles.some((r) =>
      ["super_admin", "owner", "manager", "accounting", "viewer"].includes(r),
    ),
    showManageBookings: roles.some(canSeeManageBookingsNav),
    showOwnerDashboard: roles.some((r) => ["owner", "super_admin"].includes(r)),
    showRoomsNav: roles.some((r) =>
      [
        "super_admin",
        "owner",
        "manager",
        "viewer",
        "customer_service",
        "accounting",
        "maintenance",
        "tenant",
      ].includes(r),
    ),
    showCrmNav: roles.some((r) =>
      ["super_admin", "owner", "manager", "customer_service", "agent", "viewer"].includes(r),
    ),
    showMarketingNav: roles.some((r) =>
      [
        "super_admin",
        "owner",
        "manager",
        "customer_service",
        "accounting",
        "viewer",
        "agent",
      ].includes(r),
    ),
  };
}
