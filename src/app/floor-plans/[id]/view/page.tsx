"use client";

import dynamic from "next/dynamic";

const FloorPlanViewerInner = dynamic(() => import("@/components/floor-plans/FloorPlanViewerInner"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: "var(--font-dm-sans), sans-serif",
        color: "#64748b",
      }}
    >
      Loading viewer…
    </div>
  ),
});

export default function FloorPlanViewPage() {
  return <FloorPlanViewerInner />;
}
