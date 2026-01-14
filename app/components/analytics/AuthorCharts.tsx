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
const STUDENT_TYPE_COLORS: Record<string, string> = {
  Undergrad: "#2563eb",  // Blue
  Grad: "#8b5cf6",       // Purple
  Alumni: "#059669",     // Green
  Other: "#d97706",      // Orange
  Unknown: "#94a3b8",    // Gray
};

interface TopAuthor {
  authorId?: string;
  name: string;
  authorType: string | null;
  totalEarnings: number;
  articleCount: number;
}

interface TopEarnersChartProps {
  data: TopAuthor[];
  onBarClick?: (authorId: string) => void;
}

export function TopEarnersChart({ data, onBarClick }: TopEarnersChartProps) {
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

  const handleClick = (data: any) => {
    if (onBarClick && data?.authorId) {
      onBarClick(data.authorId);
    }
  };

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
            formatter={(value, name, entry) => [
              `${formatCents(Number(value) || 0)} (${entry.payload.articleCount} articles)`,
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
          <Bar
            dataKey="totalEarnings"
            fill="#2563eb"
            radius={[0, 4, 4, 0]}
            onClick={handleClick}
            style={{ cursor: onBarClick ? "pointer" : "default" }}
          />
        </BarChart>
      </ResponsiveContainer>
      {onBarClick && (
        <div className="text-xs text-center mt-1" style={{ color: "var(--fg-faint)" }}>
          Click an author to see their articles
        </div>
      )}
    </div>
  );
}

interface AuthorTypeData {
  authorType: string | null;
  totalEarnings: number;
  articleCount: number;
}

interface AuthorTypeChartProps {
  data: AuthorTypeData[];
  onSliceClick?: (authorType: string) => void;
}

export function AuthorTypeChart({ data, onSliceClick }: AuthorTypeChartProps) {
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

  const handleClick = (data: any) => {
    if (onSliceClick && data?.name) {
      onSliceClick(data.name);
    }
  };

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
              (percent ?? 0) > 0.05 ? `${name} ${((percent ?? 0) * 100).toFixed(0)}%` : ""
            }
            labelLine={false}
            onClick={handleClick}
            style={{ cursor: onSliceClick ? "pointer" : "default" }}
          >
            {chartData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name, entry) => [
              `${formatCents(Number(value) || 0)} (${entry.payload.articleCount} articles)`,
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
      {onSliceClick && (
        <div className="text-xs text-center mt-1" style={{ color: "var(--fg-faint)" }}>
          Click a slice to see authors
        </div>
      )}
    </div>
  );
}

interface StudentTypeData {
  studentType: string | null;
  totalEarnings: number;
  articleCount: number;
}

interface StudentTypeChartProps {
  data: StudentTypeData[];
  onSliceClick?: (studentType: string) => void;
}

export function StudentTypeChart({ data, onSliceClick }: StudentTypeChartProps) {
  if (data.length === 0 || data.every((d) => d.totalEarnings === 0)) {
    return (
      <div className="h-72 flex items-center justify-center" style={{ color: "var(--fg-muted)" }}>
        No student type data available
      </div>
    );
  }

  const chartData = data.map((d) => ({
    name: d.studentType || "Unknown",
    value: d.totalEarnings,
    articleCount: d.articleCount,
  }));

  const handleClick = (data: any) => {
    if (onSliceClick && data?.name) {
      onSliceClick(data.name);
    }
  };

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
              (percent ?? 0) > 0.05 ? `${name} ${((percent ?? 0) * 100).toFixed(0)}%` : ""
            }
            labelLine={false}
            onClick={handleClick}
            style={{ cursor: onSliceClick ? "pointer" : "default" }}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={STUDENT_TYPE_COLORS[entry.name] || COLORS[index % COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name, entry) => [
              `${formatCents(Number(value) || 0)} (${entry.payload.articleCount} articles)`,
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
      {onSliceClick && (
        <div className="text-xs text-center mt-1" style={{ color: "var(--fg-faint)" }}>
          Click a slice to see students
        </div>
      )}
    </div>
  );
}
