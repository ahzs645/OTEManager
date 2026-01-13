import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { History, DollarSign, Save, RefreshCw } from "lucide-react";
import { Section, Button, LoadingSpinner, formatDate } from "~/components/Layout";
import { getPaymentRateConfig, getPaymentRateHistory } from "~/lib/queries";
import { updatePaymentRateConfig } from "~/lib/mutations";
import { formatCents } from "~/lib/payment-calculator";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

interface RateConfig {
  tier1Rate: number;
  tier2Rate: number;
  tier3Rate: number;
  researchBonus: number;
  multimediaBonus: number;
  timeSensitiveBonus: number;
  professionalPhotoBonus: number;
  professionalGraphicBonus: number;
}

interface HistoryEntry {
  id: string;
  ratesSnapshot: string;
  changedBy: string | null;
  changedAt: Date;
  notes: string | null;
}

function SettingsPage() {
  const [config, setConfig] = useState<RateConfig>({
    tier1Rate: 2000, // $20.00
    tier2Rate: 3500, // $35.00
    tier3Rate: 5000, // $50.00
    researchBonus: 1000, // $10.00
    multimediaBonus: 500, // $5.00
    timeSensitiveBonus: 500, // $5.00
    professionalPhotoBonus: 1500, // $15.00
    professionalGraphicBonus: 1500, // $15.00
  });
  const [originalConfig, setOriginalConfig] = useState<RateConfig | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Load config and history
  useEffect(() => {
    async function loadData() {
      try {
        const [configResult, historyResult] = await Promise.all([
          getPaymentRateConfig(),
          getPaymentRateHistory(),
        ]);

        if (configResult.config) {
          const loadedConfig = {
            tier1Rate: configResult.config.tier1Rate,
            tier2Rate: configResult.config.tier2Rate,
            tier3Rate: configResult.config.tier3Rate,
            researchBonus: configResult.config.researchBonus,
            multimediaBonus: configResult.config.multimediaBonus,
            timeSensitiveBonus: configResult.config.timeSensitiveBonus,
            professionalPhotoBonus: configResult.config.professionalPhotoBonus,
            professionalGraphicBonus: configResult.config.professionalGraphicBonus,
          };
          setConfig(loadedConfig);
          setOriginalConfig(loadedConfig);
        }

        setHistory(historyResult.history || []);
      } catch (error) {
        console.error("Failed to load settings:", error);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const result = await updatePaymentRateConfig({
        data: {
          ...config,
          updatedBy: "Admin",
        },
      });

      if (result.success) {
        setOriginalConfig(config);
        setSaveMessage({ type: "success", text: "Settings saved successfully" });
        // Refresh history
        const historyResult = await getPaymentRateHistory();
        setHistory(historyResult.history || []);
      } else {
        setSaveMessage({ type: "error", text: result.error || "Failed to save" });
      }
    } catch (error) {
      setSaveMessage({ type: "error", text: "Failed to save settings" });
    } finally {
      setIsSaving(false);
      // Clear message after 3 seconds
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleReset = () => {
    if (originalConfig) {
      setConfig(originalConfig);
    }
  };

  const hasChanges = originalConfig && JSON.stringify(config) !== JSON.stringify(originalConfig);

  // Helper to convert cents to dollars for input
  const centsToDollars = (cents: number) => (cents / 100).toFixed(2);

  // Helper to convert dollars input to cents
  const dollarsToCents = (value: string) => {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : Math.round(parsed * 100);
  };

  const updateRate = (key: keyof RateConfig, dollarValue: string) => {
    setConfig((prev) => ({
      ...prev,
      [key]: dollarsToCents(dollarValue),
    }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Calculate example payment (Tier 2 + Multimedia + Professional Photo)
  const examplePayment = config.tier2Rate + config.multimediaBonus + config.professionalPhotoBonus;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title">Payment Settings</h1>
        <p className="page-subtitle">
          Configure tier rates and bonus amounts. Changes only affect new calculations.
        </p>
      </div>

      {/* Save Message */}
      {saveMessage && (
        <div
          className="p-3 rounded-lg text-sm"
          style={{
            background: saveMessage.type === "success" ? "var(--status-success-bg)" : "var(--status-error-bg)",
            color: saveMessage.type === "success" ? "var(--status-success)" : "var(--status-error)",
          }}
        >
          {saveMessage.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Settings Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tier Base Rates */}
          <Section title="Tier Base Rates">
            <div className="space-y-4">
              <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
                Base payment for each article tier level.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <RateInput
                  label="Tier 1 (Basic)"
                  description="Short news, announcements, simple reviews"
                  value={centsToDollars(config.tier1Rate)}
                  onChange={(v) => updateRate("tier1Rate", v)}
                />
                <RateInput
                  label="Tier 2 (Standard)"
                  description="General news, opinions, basic features"
                  value={centsToDollars(config.tier2Rate)}
                  onChange={(v) => updateRate("tier2Rate", v)}
                />
                <RateInput
                  label="Tier 3 (Advanced)"
                  description="In-depth features, investigative pieces"
                  value={centsToDollars(config.tier3Rate)}
                  onChange={(v) => updateRate("tier3Rate", v)}
                />
              </div>
            </div>
          </Section>

          {/* Content Bonuses */}
          <Section title="Content Bonuses">
            <div className="space-y-4">
              <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
                Additional payment for content quality and effort.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <RateInput
                  label="Research Bonus"
                  description="Extensive research or interviews (up to)"
                  value={centsToDollars(config.researchBonus)}
                  onChange={(v) => updateRate("researchBonus", v)}
                />
                <RateInput
                  label="Time-Sensitive Bonus"
                  description="Short notice or breaking news"
                  value={centsToDollars(config.timeSensitiveBonus)}
                  onChange={(v) => updateRate("timeSensitiveBonus", v)}
                />
              </div>
            </div>
          </Section>

          {/* Multimedia Bonuses */}
          <Section title="Multimedia Bonuses">
            <div className="space-y-4">
              <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
                Additional payment for including multimedia content.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <RateInput
                  label="Multimedia Bonus"
                  description="Original photos, graphics, or video"
                  value={centsToDollars(config.multimediaBonus)}
                  onChange={(v) => updateRate("multimediaBonus", v)}
                />
                <RateInput
                  label="Professional Photo"
                  description="High-quality professional photos"
                  value={centsToDollars(config.professionalPhotoBonus)}
                  onChange={(v) => updateRate("professionalPhotoBonus", v)}
                />
                <RateInput
                  label="Professional Graphic"
                  description="Professional graphics/infographics"
                  value={centsToDollars(config.professionalGraphicBonus)}
                  onChange={(v) => updateRate("professionalGraphicBonus", v)}
                />
              </div>
            </div>
          </Section>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={handleSave} disabled={isSaving || !hasChanges}>
              {isSaving ? (
                <>
                  <LoadingSpinner size="sm" />
                  <span className="ml-2">Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
            {hasChanges && (
              <Button variant="ghost" onClick={handleReset}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Reset
              </Button>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Example Calculation */}
          <Section title="Example Calculation">
            <div className="space-y-3">
              <p className="text-xs" style={{ color: "var(--fg-muted)" }}>
                Tier 2 article with Multimedia + Pro Photo:
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: "var(--fg-muted)" }}>Tier 2 Base</span>
                  <span style={{ color: "var(--fg-default)" }}>{formatCents(config.tier2Rate)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--fg-muted)" }}>+ Multimedia</span>
                  <span style={{ color: "var(--fg-default)" }}>{formatCents(config.multimediaBonus)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--fg-muted)" }}>+ Pro Photo</span>
                  <span style={{ color: "var(--fg-default)" }}>{formatCents(config.professionalPhotoBonus)}</span>
                </div>
                <div
                  className="flex justify-between pt-2 mt-2 font-medium"
                  style={{ borderTop: "1px solid var(--border-default)" }}
                >
                  <span style={{ color: "var(--fg-default)" }}>Total</span>
                  <span style={{ color: "var(--accent)" }}>{formatCents(examplePayment)}</span>
                </div>
              </div>
            </div>
          </Section>

          {/* Rate Summary */}
          <Section title="Rate Summary">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span style={{ color: "var(--fg-muted)" }}>Tier 1</span>
                <span style={{ color: "var(--fg-default)" }}>{formatCents(config.tier1Rate)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--fg-muted)" }}>Tier 2</span>
                <span style={{ color: "var(--fg-default)" }}>{formatCents(config.tier2Rate)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--fg-muted)" }}>Tier 3</span>
                <span style={{ color: "var(--fg-default)" }}>{formatCents(config.tier3Rate)}</span>
              </div>
              <div className="pt-2 mt-2" style={{ borderTop: "1px solid var(--border-default)" }}>
                <p className="text-xs font-medium mb-2" style={{ color: "var(--fg-muted)" }}>
                  Max Bonuses:
                </p>
                <div className="flex justify-between">
                  <span style={{ color: "var(--fg-muted)" }}>Research</span>
                  <span style={{ color: "var(--fg-default)" }}>+{formatCents(config.researchBonus)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--fg-muted)" }}>Multimedia</span>
                  <span style={{ color: "var(--fg-default)" }}>+{formatCents(config.multimediaBonus)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--fg-muted)" }}>Time-Sensitive</span>
                  <span style={{ color: "var(--fg-default)" }}>+{formatCents(config.timeSensitiveBonus)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--fg-muted)" }}>Pro Photo</span>
                  <span style={{ color: "var(--fg-default)" }}>+{formatCents(config.professionalPhotoBonus)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--fg-muted)" }}>Pro Graphic</span>
                  <span style={{ color: "var(--fg-default)" }}>+{formatCents(config.professionalGraphicBonus)}</span>
                </div>
              </div>
            </div>
          </Section>

          {/* Rate History */}
          <Section
            title="Rate History"
            action={
              <span className="text-xs" style={{ color: "var(--fg-muted)" }}>
                Last {history.length} changes
              </span>
            }
          >
            {history.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
                No rate changes recorded yet.
              </p>
            ) : (
              <div className="space-y-3">
                {history.slice(0, 5).map((entry) => (
                  <HistoryItem key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

// Rate Input Component - Using text input for better UX
function RateInput({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [localValue, setLocalValue] = useState(value);

  // Sync local value when prop changes (e.g., on reset)
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleBlur = () => {
    // Parse and format on blur
    const parsed = parseFloat(localValue);
    if (!isNaN(parsed) && parsed >= 0) {
      const formatted = parsed.toFixed(2);
      setLocalValue(formatted);
      onChange(formatted);
    } else {
      // Reset to original value if invalid
      setLocalValue(value);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    // Allow typing freely - only validate on blur
    setLocalValue(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div>
      <label
        className="block text-xs font-medium mb-1"
        style={{ color: "var(--fg-default)" }}
      >
        {label}
      </label>
      {description && (
        <p className="text-xs mb-1.5" style={{ color: "var(--fg-muted)" }}>
          {description}
        </p>
      )}
      <div className="relative">
        <DollarSign
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
          style={{ color: "var(--fg-faint)" }}
        />
        <input
          type="text"
          inputMode="decimal"
          value={localValue}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="input"
          style={{ width: "100%", paddingLeft: "2.5rem" }}
          placeholder="0.00"
        />
      </div>
    </div>
  );
}

// History Item Component
function HistoryItem({ entry }: { entry: HistoryEntry }) {
  const [expanded, setExpanded] = useState(false);

  let snapshot: any = null;
  try {
    snapshot = JSON.parse(entry.ratesSnapshot);
  } catch {
    // Invalid JSON
  }

  return (
    <div
      className="text-sm p-2 rounded"
      style={{ background: "var(--bg-subtle)" }}
    >
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div>
          <div className="font-medium" style={{ color: "var(--fg-default)" }}>
            {formatDate(entry.changedAt)}
          </div>
          <div className="text-xs" style={{ color: "var(--fg-muted)" }}>
            {entry.changedBy || "System"}
          </div>
        </div>
        <History className="w-4 h-4" style={{ color: "var(--fg-faint)" }} />
      </div>

      {expanded && snapshot && (
        <div
          className="mt-2 pt-2 text-xs space-y-1"
          style={{ borderTop: "1px solid var(--border-default)" }}
        >
          <div className="flex justify-between">
            <span style={{ color: "var(--fg-muted)" }}>T1/T2/T3</span>
            <span style={{ color: "var(--fg-default)" }}>
              {formatCents(snapshot.tier1Rate)} / {formatCents(snapshot.tier2Rate)} /{" "}
              {formatCents(snapshot.tier3Rate)}
            </span>
          </div>
          {entry.notes && (
            <div className="mt-1" style={{ color: "var(--fg-muted)" }}>
              Note: {entry.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
