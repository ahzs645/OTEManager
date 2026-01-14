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

// Format cents to dollars
function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Semester colors
const SEMESTER_COLORS: Record<string, string> = {
  Fall: "#dc2626",    // Red/orange for fall leaves
  Winter: "#2563eb",  // Blue for winter
  Summer: "#059669",  // Green for summer
};

interface SemesterData {
  label: string;
  semester: string;
  year: number;
  totalSpent: number;
  articleCount: number;
}

interface SemesterBreakdownChartProps {
  data: SemesterData[];
  onBarClick?: (semester: string, year: number) => void;
}

export function SemesterBreakdownChart({ data, onBarClick }: SemesterBreakdownChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center" style={{ color: "var(--fg-muted)" }}>
        No semester data available
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "280px", minWidth: "200px" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--fg-muted)", fontSize: 11 }}
            axisLine={{ stroke: "var(--border-default)" }}
            tickLine={false}
            angle={-45}
            textAnchor="end"
            height={60}
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
              "Total Spent",
            ]}
            contentStyle={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: "6px",
              fontSize: "12px",
            }}
          />
          <Bar
            dataKey="totalSpent"
            radius={[4, 4, 0, 0]}
            onClick={(data: any) => {
              if (onBarClick && data?.semester && data?.year) {
                onBarClick(data.semester, data.year);
              }
            }}
            style={{ cursor: onBarClick ? "pointer" : "default" }}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={SEMESTER_COLORS[entry.semester] || "#94a3b8"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ background: SEMESTER_COLORS.Fall }} />
          <span className="text-xs" style={{ color: "var(--fg-muted)" }}>Fall (Sep-Dec)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ background: SEMESTER_COLORS.Winter }} />
          <span className="text-xs" style={{ color: "var(--fg-muted)" }}>Winter (Jan-Apr)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ background: SEMESTER_COLORS.Summer }} />
          <span className="text-xs" style={{ color: "var(--fg-muted)" }}>Summer (May-Aug)</span>
        </div>
      </div>
    </div>
  );
}
