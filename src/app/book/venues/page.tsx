"use client";

import PublicProductBookingPage from "@/components/PublicProductBookingPage";

export default function PublicVenuesPage() {
  return <PublicProductBookingPage title="Book venues" allowedTypes={["venue"]} inquiryDefault />;
}

