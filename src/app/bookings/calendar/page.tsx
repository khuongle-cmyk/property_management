"use client";

import { Suspense } from "react";
import BookingCalendarView from "@/components/bookings/BookingCalendarView";

export default function BookingsCalendarPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <BookingCalendarView />
    </Suspense>
  );
}
