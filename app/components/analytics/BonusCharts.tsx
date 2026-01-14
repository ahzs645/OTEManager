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

interface BonusFrequencyChartProps {
  data: BonusData[];
  totalArticles: number;
  onBarClick?: (bonusName: string) => void;
}

export function BonusFrequencyChart({ data, totalArticles, onBarClick }: BonusFrequencyChartProps) {
  // Sort by count descending
  const sortedData = [...data].sort((a, b) => b.count - a.count);

  if (sortedData.every((d) => d.count === 0)) {
    return (
      <div className="h-64 flex items-center justify-center" style={{ color: "var(--fg-muted)" }}>
        No bonus data available
      </div>
    );
  }

  const handleClick = (data: any) => {
    if (onBarClick && data?.name) {
      onBarClick(data.name);
    }
  };

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
            formatter={(value, name, entry) => [
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
          <Bar
            dataKey="count"
            radius={[0, 4, 4, 0]}
            onClick={handleClick}
            style={{ cursor: onBarClick ? "pointer" : "default" }}
          >
            {sortedData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-between text-xs mt-2" style={{ color: "var(--fg-muted)" }}>
        <span>Based on {totalArticles} total articles</span>
        {onBarClick && <span style={{ color: "var(--fg-faint)" }}>Click a bar to see articles</span>}
      </div>
    </div>
  );
}
