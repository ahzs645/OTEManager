import { Calendar } from "lucide-react";

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onStartChange: (date: string) => void;
  onEndChange: (date: string) => void;
  onPresetSelect: (preset: string) => void;
}

const PRESETS = [
  { label: "7D", value: "7d", days: 7 },
  { label: "30D", value: "30d", days: 30 },
  { label: "90D", value: "90d", days: 90 },
  { label: "YTD", value: "ytd", days: 0 },
  { label: "All", value: "all", days: -1 },
];

export function DateRangePicker({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  onPresetSelect,
}: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-3">
      {/* Preset buttons */}
      <div className="flex items-center gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.value}
            onClick={() => onPresetSelect(preset.value)}
            className="btn btn-ghost !px-2 !py-1 text-xs"
            style={{
              background: !startDate && !endDate && preset.value === "all"
                ? "var(--bg-subtle)"
                : undefined,
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Separator */}
      <div
        className="h-5 w-px"
        style={{ background: "var(--border-default)" }}
      />

      {/* Date inputs */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <Calendar
            className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
            style={{ color: "var(--fg-faint)" }}
          />
          <input
            type="date"
            value={startDate}
            onChange={(e) => onStartChange(e.target.value)}
            className="input text-xs !py-1.5 !pl-7 !pr-2"
            style={{ width: "130px" }}
          />
        </div>
        <span className="text-xs" style={{ color: "var(--fg-muted)" }}>to</span>
        <div className="relative">
          <Calendar
            className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
            style={{ color: "var(--fg-faint)" }}
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => onEndChange(e.target.value)}
            className="input text-xs !py-1.5 !pl-7 !pr-2"
            style={{ width: "130px" }}
          />
        </div>
      </div>
    </div>
  );
}

// Helper to calculate date ranges
export function getDateRange(preset: string): { startDate: string; endDate: string } {
  const today = new Date();
  const endDate = today.toISOString().split("T")[0];

  switch (preset) {
    case "7d": {
      const start = new Date(today);
      start.setDate(start.getDate() - 7);
      return { startDate: start.toISOString().split("T")[0], endDate };
    }
    case "30d": {
      const start = new Date(today);
      start.setDate(start.getDate() - 30);
      return { startDate: start.toISOString().split("T")[0], endDate };
    }
    case "90d": {
      const start = new Date(today);
      start.setDate(start.getDate() - 90);
      return { startDate: start.toISOString().split("T")[0], endDate };
    }
    case "ytd": {
      const start = new Date(today.getFullYear(), 0, 1);
      return { startDate: start.toISOString().split("T")[0], endDate };
    }
    case "all":
    default:
      return { startDate: "", endDate: "" };
  }
}
