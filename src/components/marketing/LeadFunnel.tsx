"use client";

type LeadFunnelProps = {
  visitors?: number;
  leads?: number;
  tours?: number;
  tenants?: number;
};

export default function LeadFunnel({ visitors = 0, leads = 0, tours = 0, tenants = 0 }: LeadFunnelProps) {
  const funnelStages = [
    { label: "Visitors", value: visitors, color: "bg-[#1a5c50]" },
    { label: "Leads", value: leads, color: "bg-[#5DCAA5]" },
    { label: "Tours", value: tours, color: "bg-[#9FE1CB]" },
    { label: "Tenants", value: tenants, color: "bg-[#D3D1C7]" },
  ];

  const maxValue = Math.max(...funnelStages.map((s) => s.value), 1);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-4 text-sm font-medium text-gray-900">Lead funnel</h3>
      <div className="flex flex-col gap-3">
        {funnelStages.map((stage) => {
          const width = stage.value > 0 ? (stage.value / maxValue) * 100 : 0;
          return (
            <div key={stage.label}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-gray-500">{stage.label}</span>
                <span className="text-gray-400">{stage.value}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full ${stage.color} rounded-full transition-all duration-500`}
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
