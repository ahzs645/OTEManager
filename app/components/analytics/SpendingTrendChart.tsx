import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";

// Format cents to dollars
function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

interface TrendData {
  month: string | null;
  monthLabel: string;
  totalSpent: number;
  articleCount: number;
}

export function SpendingTrendChart({ data }: { data: TrendData[] }) {
  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center" style={{ color: "var(--fg-muted)" }}>
        No spending trend data available
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "256px", minWidth: "200px" }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorSpent" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
          <XAxis
            dataKey="monthLabel"
            tick={{ fill: "var(--fg-muted)", fontSize: 11 }}
            axisLine={{ stroke: "var(--border-default)" }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: "var(--fg-muted)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value) => formatCents(value)}
          />
          <Tooltip
            formatter={(value, name, entry) => [
              `${formatCents(Number(value) || 0)} (${entry.payload.articleCount} articles)`,
              "Spent",
            ]}
            labelFormatter={(label) => label}
            contentStyle={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: "6px",
              fontSize: "12px",
            }}
          />
          <Area
            type="monotone"
            dataKey="totalSpent"
            stroke="#2563eb"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorSpent)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
