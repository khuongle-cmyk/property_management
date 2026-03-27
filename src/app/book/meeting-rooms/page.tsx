"use client";

import PublicProductBookingPage from "@/components/PublicProductBookingPage";

export default function PublicMeetingRoomsPage() {
  return <PublicProductBookingPage title="Book meeting rooms" allowedTypes={["conference_room"]} />;
}

