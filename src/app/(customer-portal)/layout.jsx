import CustomerPortalShell from "@/components/customer-portal/CustomerPortalShell";

/** Customer portal — URLs under /portal/* (separate from admin dashboard). */
export default function CustomerPortalRouteGroupLayout({ children }) {
  return <CustomerPortalShell>{children}</CustomerPortalShell>;
}
