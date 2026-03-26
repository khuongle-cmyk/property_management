export function bookingStatusStyle(status: string): {
  bg: string;
  fg: string;
  bd: string;
} {
  switch ((status ?? "").toLowerCase()) {
    case "confirmed":
      return { bg: "#e6f6ea", fg: "#1b5e20", bd: "#b7e1bf" };
    case "pending":
      return { bg: "#fff8e1", fg: "#7a5a00", bd: "#ffe69c" };
    case "rejected":
      return { bg: "#fbe8ea", fg: "#b00020", bd: "#f3b7be" };
    case "cancelled":
      return { bg: "#f1f3f5", fg: "#495057", bd: "#dee2e6" };
    default:
      return { bg: "#f1f3f5", fg: "#495057", bd: "#dee2e6" };
  }
}

export { spaceTypeLabel } from "@/lib/rooms/labels";
