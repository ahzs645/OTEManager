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
  Legend,
} from "recharts";

// Format cents to dollars
function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

// Chart colors
const COLORS = {
  primary: "#2563eb",
  success: "#059669",
  warning: "#d97706",
  muted: "#94a3b8",
};

const PIE_COLORS = ["#2563eb", "#94a3b8"];

interface PaymentStatusData {
  paid: { count: number; amount: number };
  unpaid: { count: number; amount: number };
}

export function PaymentStatusChart({ data }: { data: PaymentStatusData }) {
  const chartData = [
    { name: "Paid", value: data.paid.count, amount: data.paid.amount },
    { name: "Unpaid", value: data.unpaid.count, amount: data.unpaid.amount },
  ];

  const total = data.paid.count + data.unpaid.count;

  if (total === 0) {
    return (
      <div className="h-64 flex items-center justify-center" style={{ color: "var(--fg-muted)" }}>
        No payment data available
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "256px", minWidth: "200px" }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            labelLine={false}
          >
            {chartData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={PIE_COLORS[index]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number, name: string, entry: any) => [
              `${value} articles (${formatCents(entry.payload.amount)})`,
              name,
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

interface TierData {
  tier: string;
  tierLabel: string;
  articleCount: number;
  totalPayment: number;
  avgPayment: number;
}

export function TierDistributionChart({ data }: { data: TierData[] }) {
  if (data.length === 0 || data.every((d) => d.articleCount === 0)) {
    return (
      <div className="h-64 flex items-center justify-center" style={{ color: "var(--fg-muted)" }}>
        No tier data available
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "256px", minWidth: "200px" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
          <XAxis
            dataKey="tierLabel"
            tick={{ fill: "var(--fg-muted)", fontSize: 12 }}
            axisLine={{ stroke: "var(--border-default)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "var(--fg-muted)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value) => formatCents(value)}
          />
          <Tooltip
            formatter={(value: number) => [formatCents(value), "Avg Payment"]}
            contentStyle={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: "6px",
              fontSize: "12px",
            }}
            labelFormatter={(label) => `${label}`}
          />
          <Bar dataKey="avgPayment" fill={COLORS.primary} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TierArticleCountChart({ data }: { data: TierData[] }) {
  if (data.length === 0 || data.every((d) => d.articleCount === 0)) {
    return (
      <div className="h-64 flex items-center justify-center" style={{ color: "var(--fg-muted)" }}>
        No tier data available
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "256px", minWidth: "200px" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
          <XAxis
            dataKey="tierLabel"
            tick={{ fill: "var(--fg-muted)", fontSize: 12 }}
            axisLine={{ stroke: "var(--border-default)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "var(--fg-muted)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: number) => [value, "Articles"]}
            contentStyle={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: "6px",
              fontSize: "12px",
            }}
          />
          <Bar dataKey="articleCount" fill={COLORS.success} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
