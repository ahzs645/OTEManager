import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

// Format cents to dollars
function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

const COLORS = ["#2563eb", "#059669", "#d97706", "#dc2626", "#8b5cf6"];

interface TopAuthor {
  name: string;
  authorType: string | null;
  totalEarnings: number;
  articleCount: number;
}

export function TopEarnersChart({ data }: { data: TopAuthor[] }) {
  if (data.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center" style={{ color: "var(--fg-muted)" }}>
        No author earnings data available
      </div>
    );
  }

  // Truncate long names
  const chartData = data.map((d) => ({
    ...d,
    displayName: d.name.length > 15 ? d.name.slice(0, 15) + "..." : d.name,
  }));

  return (
    <div style={{ width: "100%", height: "288px", minWidth: "200px" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 10, right: 30, left: 100, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: "var(--fg-muted)", fontSize: 12 }}
            axisLine={{ stroke: "var(--border-default)" }}
            tickLine={false}
            tickFormatter={(value) => formatCents(value)}
          />
          <YAxis
            type="category"
            dataKey="displayName"
            tick={{ fill: "var(--fg-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={95}
          />
          <Tooltip
            formatter={(value: number, name: string, entry: any) => [
              `${formatCents(value)} (${entry.payload.articleCount} articles)`,
              "Earnings",
            ]}
            labelFormatter={(label, payload) => payload[0]?.payload?.name || label}
            contentStyle={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: "6px",
              fontSize: "12px",
            }}
          />
          <Bar dataKey="totalEarnings" fill="#2563eb" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface AuthorTypeData {
  authorType: string | null;
  totalEarnings: number;
  articleCount: number;
}

export function AuthorTypeChart({ data }: { data: AuthorTypeData[] }) {
  if (data.length === 0 || data.every((d) => d.totalEarnings === 0)) {
    return (
      <div className="h-72 flex items-center justify-center" style={{ color: "var(--fg-muted)" }}>
        No author type data available
      </div>
    );
  }

  const chartData = data.map((d) => ({
    name: d.authorType || "Unknown",
    value: d.totalEarnings,
    articleCount: d.articleCount,
  }));

  return (
    <div style={{ width: "100%", height: "288px", minWidth: "200px" }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={45}
            outerRadius={75}
            paddingAngle={2}
            dataKey="value"
            label={({ name, percent }) =>
              percent > 0.05 ? `${name} ${(percent * 100).toFixed(0)}%` : ""
            }
            labelLine={false}
          >
            {chartData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number, name: string, entry: any) => [
              `${formatCents(value)} (${entry.payload.articleCount} articles)`,
              entry.payload.name,
            ]}
            contentStyle={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: "6px",
              fontSize: "12px",
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
