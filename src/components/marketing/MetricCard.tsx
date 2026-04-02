interface MetricCardProps {
  label: string;
  value: string;
  change?: string;
  positive?: boolean;
  muted?: boolean;
}

export default function MetricCard({ label, value, change, positive, muted }: MetricCardProps) {
  return (
    <div className="rounded-lg px-4 py-3.5" style={{ backgroundColor: "#f5f5f3" }}>
      <p className="mb-1.5 text-[13px] text-gray-500">{label}</p>
      <p className={`text-2xl font-medium ${muted ? "text-gray-300" : "text-gray-900"}`}>{value}</p>
      {change ? (
        <p className={`mt-1 text-xs ${positive ? "text-[#0F6E56]" : "text-red-500"}`}>{change}</p>
      ) : null}
    </div>
  );
}
