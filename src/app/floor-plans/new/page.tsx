"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";

type PropertyRow = { id: string; name: string | null; tenant_id?: string | null };

function NewFloorPlanForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preProperty = searchParams.get("propertyId")?.trim() ?? "";

  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState(preProperty);
  const [name, setName] = useState("");
  const [floorNumber, setFloorNumber] = useState(1);
  const [widthM, setWidthM] = useState(20);
  const [heightM, setHeightM] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bgFile, setBgFile] = useState<File | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/floor-plans/properties-for-new");
      const json = (await res.json()) as { properties?: PropertyRow[]; error?: string };
      if (cancelled) return;
      if (!res.ok) {
        setLoadErr(json.error ?? "Could not load properties");
        return;
      }
      setProperties(json.properties ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!propertyId) {
      setError("Select a property");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/floor-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          name: name.trim() || "Untitled floor plan",
          floorNumber,
          widthMeters: widthM,
          heightMeters: heightM,
        }),
      });
      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) {
        setError(json.error ?? "Create failed");
        return;
      }
      if (!json.id) {
        setError("Create failed: no id");
        return;
      }

      if (bgFile) {
        const fd = new FormData();
        fd.append("file", bgFile);
        const bgRes = await fetch(`/api/floor-plans/${encodeURIComponent(json.id)}/background`, {
          method: "POST",
          body: fd,
        });
        let bgJson: { fallback?: boolean; error?: string; detected_scale?: number | null } = {};
        try {
          bgJson = (await bgRes.json()) as { fallback?: boolean; error?: string; detected_scale?: number | null };
        } catch {
          /* non-JSON body */
        }
        const isPdf = (bgFile.name ?? "").toLowerCase().endsWith(".pdf");
        if (bgRes.ok && isPdf) {
          try {
            if (typeof bgJson.detected_scale === "number" && Number.isFinite(bgJson.detected_scale) && bgJson.detected_scale > 0) {
              sessionStorage.setItem("floor_plan_detected_scale", String(Math.round(bgJson.detected_scale)));
              sessionStorage.removeItem("floor_plan_pdf_scale_unknown");
            } else {
              sessionStorage.setItem("floor_plan_pdf_scale_unknown", "1");
              sessionStorage.removeItem("floor_plan_detected_scale");
            }
          } catch {
            /* storage unavailable */
          }
        }
        if (!bgRes.ok || bgJson.fallback === true) {
          try {
            sessionStorage.setItem(
              "floor_plan_bg_upload_warning",
              "Background upload failed — please upload a PNG or JPG image instead.",
            );
          } catch {
            /* storage unavailable */
          }
        }
      }

      router.push(`/floor-plans/${json.id}/edit`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: "24px 16px" }}>
      <Link href="/floor-plans" style={{ fontSize: 14 }}>
        ← Floor planner
      </Link>
      <h1 style={{ marginTop: 16 }}>New floor plan</h1>
      <p style={{ color: "#555" }}>Choose property and dimensions. You can add a background before opening the editor.</p>

      {loadErr ? <p style={{ color: "#b00020" }}>{loadErr}</p> : null}
      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 14, marginTop: 20 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Property</span>
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            required
            style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
          >
            <option value="">{properties.length ? "Select…" : "Loading properties…"}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.id}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Erottaja2 — Floor 1" style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc" }} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Floor number</span>
          <input
            type="number"
            value={floorNumber}
            onChange={(e) => setFloorNumber(Number(e.target.value))}
            style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
          />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Width (meters)</span>
          <input type="number" min={1} step={0.1} value={widthM} onChange={(e) => setWidthM(Number(e.target.value))} style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc" }} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Depth (meters)</span>
          <input type="number" min={1} step={0.1} value={heightM} onChange={(e) => setHeightM(Number(e.target.value))} style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc" }} />
        </label>

        <div
          style={{
            border: "1px dashed #cbd5e1",
            borderRadius: 10,
            padding: 14,
            background: "#f8fafc",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Background floor plan (optional)</div>
          <label
            style={{
              display: "inline-block",
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #94a3b8",
              cursor: "pointer",
              background: "#fff",
              fontSize: 14,
            }}
          >
            Upload PDF or image
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.svg,.webp,application/pdf,image/png,image/jpeg,image/svg+xml"
              hidden
              onChange={(e) => setBgFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {bgFile ? (
            <p style={{ margin: "10px 0 0", fontSize: 13, color: "#334155" }}>
              Selected: <strong>{bgFile.name}</strong>
            </p>
          ) : null}
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
            Accepted: .pdf, .png, .jpg, .svg, .webp
            <br />
            Have a DWG file? Convert to PDF first at{" "}
            <a href="https://convertio.co" target="_blank" rel="noreferrer">
              convertio.co
            </a>
            .
          </p>
        </div>

        <button
          type="submit"
          disabled={busy}
          style={{
            padding: "12px 18px",
            background: busy ? "#9ca3af" : "#1a4a4a",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Creating…" : "Open editor"}
        </button>
      </form>
    </main>
  );
}

export default function NewFloorPlanPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading…</p>}>
      <NewFloorPlanForm />
    </Suspense>
  );
}
