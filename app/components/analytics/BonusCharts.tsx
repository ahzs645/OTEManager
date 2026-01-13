import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const COLORS = ["#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe"];

interface BonusData {
  name: string;
  count: number;
  percentage: number;
}

export function BonusFrequencyChart({ data, totalArticles }: { data: BonusData[]; totalArticles: number }) {
  // Sort by count descending
  const sortedData = [...data].sort((a, b) => b.count - a.count);

  if (sortedData.every((d) => d.count === 0)) {
    return (
      <div className="h-64 flex items-center justify-center" style={{ color: "var(--fg-muted)" }}>
        No bonus data available
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "256px", minWidth: "200px" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={sortedData}
          layout="vertical"
          margin={{ top: 10, right: 30, left: 80, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: "var(--fg-muted)", fontSize: 12 }}
            axisLine={{ stroke: "var(--border-default)" }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: "var(--fg-muted)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={75}
          />
          <Tooltip
            formatter={(value: number, name: string, entry: any) => [
              `${value} articles (${entry.payload.percentage}%)`,
              "Count",
            ]}
            contentStyle={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: "6px",
              fontSize: "12px",
            }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {sortedData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="text-xs text-center mt-2" style={{ color: "var(--fg-muted)" }}>
        Based on {totalArticles} total articles
      </div>
    </div>
  );
}
