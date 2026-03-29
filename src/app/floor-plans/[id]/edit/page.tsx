"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

/** Client-only editor (canvas); single dynamic boundary avoids duplicate client bundles. */
const FloorPlanEditorInner = dynamic(() => import("@/components/floor-plans/FloorPlanEditorInner"), {
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
      Loading editor…
    </div>
  ),
});

export default function FloorPlanEditPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  if (!id) return <main style={{ padding: 24 }}>Invalid plan.</main>;
  return <FloorPlanEditorInner floorPlanId={id} />;
}
