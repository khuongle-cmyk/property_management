"use client";

import { useEffect, useRef } from "react";
import type { Chart } from "chart.js";

const CHANNEL_DEFS = [
  { label: "Website", color: "#1a5c50" },
  { label: "Referral", color: "#5DCAA5" },
  { label: "Walk-in", color: "#B4B2A9" },
  { label: "Other", color: "#D3D1C7" },
] as const;

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CHART_TICK = "rgba(0,0,0,0.45)";
const CHART_GRID = "rgba(0,0,0,0.06)";

function last6MonthLabels(endYyyyMm: string): string[] {
  const parts = endYyyyMm.split("-").map(Number);
  const y = parts[0] ?? new Date().getUTCFullYear();
  const m = parts[1] ?? 1;
  const labels: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    labels.push(SHORT_MONTHS[d.getUTCMonth()] ?? "");
  }
  return labels;
}

function mapSourceToBucket(source: string): (typeof CHANNEL_DEFS)[number]["label"] {
  const s = source.toLowerCase();
  if (s.includes("website") || s === "web" || s.includes("online")) return "Website";
  if (s.includes("referral") || s.includes("refer")) return "Referral";
  if (s.includes("walk")) return "Walk-in";
  return "Other";
}

function aggregateByBucket(channels: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { Website: 0, Referral: 0, "Walk-in": 0, Other: 0 };
  for (const [key, raw] of Object.entries(channels)) {
    const v = Number(raw) || 0;
    if (v === 0) continue;
    const b = mapSourceToBucket(key);
    out[b] = (out[b] ?? 0) + v;
  }
  return out;
}

type RevenueByChannelProps = {
  channels?: Record<string, number>;
  /** Selected dashboard month (YYYY-MM); drives the 6-month window (last month = selected). */
  monthKey?: string;
};

export default function RevenueByChannel({ channels = {}, monthKey }: RevenueByChannelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  const mk = monthKey && /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : currentMonthYyyyMm();
  const months = last6MonthLabels(mk);
  const buckets = aggregateByBucket(channels);
  const dataKey = JSON.stringify({ buckets, months: months.join(",") });

  useEffect(() => {
    let mounted = true;

    const loadChart = async () => {
      const { Chart: ChartJS, registerables } = await import("chart.js");
      ChartJS.register(...registerables);

      if (!mounted || !canvasRef.current) return;

      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }

      const dataFor = (label: (typeof CHANNEL_DEFS)[number]["label"]) =>
        months.map((_, i) => (i === months.length - 1 ? buckets[label] ?? 0 : 0));

      chartRef.current = new ChartJS(canvasRef.current, {
        type: "bar",
        data: {
          labels: months,
          datasets: CHANNEL_DEFS.map((ch) => ({
            label: ch.label,
            data: dataFor(ch.label),
            backgroundColor: ch.color,
            borderRadius: 3,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label(ctx) {
                  const n = Number(ctx.raw);
                  if (n === 0) return `${ctx.dataset.label}: —`;
                  return `${ctx.dataset.label}: €${Math.round(n).toLocaleString()}`;
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              grid: { display: false },
              ticks: { color: CHART_TICK, font: { size: 11 } },
            },
            y: {
              stacked: true,
              grid: { color: CHART_GRID },
              ticks: {
                color: CHART_TICK,
                font: { size: 11 },
                callback(v) {
                  return `€${Number(v).toLocaleString()}`;
                },
              },
              border: { display: false },
            },
          },
        },
      });
    };

    void loadChart();

    return () => {
      mounted = false;
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [dataKey]);

  const total = Object.values(buckets).reduce((a, b) => a + b, 0);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-4 text-sm font-medium text-gray-900">Revenue by channel</h3>
      <div className="mb-3 flex flex-wrap gap-4">
        {CHANNEL_DEFS.map((ch) => (
          <span key={ch.label} className="flex items-center gap-1.5 text-[12px] text-gray-500">
            <span className="h-[10px] w-[10px] shrink-0 rounded-sm" style={{ backgroundColor: ch.color }} />
            {ch.label}
          </span>
        ))}
      </div>
      <div className="relative h-[200px] w-full">
        <canvas ref={canvasRef} />
      </div>
      {total === 0 ? (
        <p className="mt-2 text-center text-xs text-gray-400">No channel revenue for this period</p>
      ) : null}
    </div>
  );
}

function currentMonthYyyyMm(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
