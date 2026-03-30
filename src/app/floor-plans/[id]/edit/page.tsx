"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

const BG_UPLOAD_WARNING_KEY = "floor_plan_bg_upload_warning";
const DETECTED_SCALE_KEY = "floor_plan_detected_scale";
const PDF_SCALE_UNKNOWN_KEY = "floor_plan_pdf_scale_unknown";

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
  const [bgUploadWarning, setBgUploadWarning] = useState<string | null>(null);
  const [detectedScale, setDetectedScale] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    try {
      const msg = sessionStorage.getItem(BG_UPLOAD_WARNING_KEY);
      if (msg) {
        sessionStorage.removeItem(BG_UPLOAD_WARNING_KEY);
        setBgUploadWarning(msg);
      }
      const scaleRaw = sessionStorage.getItem(DETECTED_SCALE_KEY);
      const unknownRaw = sessionStorage.getItem(PDF_SCALE_UNKNOWN_KEY);
      if (scaleRaw != null) sessionStorage.removeItem(DETECTED_SCALE_KEY);
      if (unknownRaw != null) sessionStorage.removeItem(PDF_SCALE_UNKNOWN_KEY);

      let next: number | null | undefined = undefined;
      if (scaleRaw != null) {
        const n = parseInt(scaleRaw, 10);
        if (Number.isFinite(n) && n > 0) next = n;
      }
      if (next === undefined && unknownRaw != null) {
        next = null;
      }
      setDetectedScale(next);
    } catch {
      /* ignore */
    }
  }, []);

  if (!id) return <main style={{ padding: 24 }}>Invalid plan.</main>;
  return (
    <>
      {bgUploadWarning ? (
        <div
          role="alert"
          style={{
            margin: 0,
            padding: "12px 16px",
            background: "#fffbeb",
            color: "#92400e",
            borderBottom: "1px solid #fcd34d",
            fontSize: 14,
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}
        >
          {bgUploadWarning}
        </div>
      ) : null}
      <FloorPlanEditorInner floorPlanId={id} detectedScale={detectedScale} />
    </>
  );
}
