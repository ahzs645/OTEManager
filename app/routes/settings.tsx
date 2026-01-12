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
  photoBonus: number;
  graphicBonus: number;
  videoBonus: number;
  audioBonus: number;
  featuredBonus: number;
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
    tier1Rate: 5000,
    tier2Rate: 10000,
    tier3Rate: 15000,
    photoBonus: 1500,
    graphicBonus: 2000,
    videoBonus: 2500,
    audioBonus: 1000,
    featuredBonus: 5000,
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
            photoBonus: configResult.config.photoBonus,
            graphicBonus: configResult.config.graphicBonus,
            videoBonus: configResult.config.videoBonus,
            audioBonus: configResult.config.audioBonus,
            featuredBonus: configResult.config.featuredBonus,
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
        ...config,
        updatedBy: "Admin",
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

  // Calculate example payment
  const examplePayment = config.tier2Rate + config.photoBonus + config.videoBonus;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title">Payment Settings</h1>
        <p className="page-subtitle">
          Configure tier rates and bonus amounts. Changes only affect new articles.
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
                  value={centsToDollars(config.tier1Rate)}
                  onChange={(v) => updateRate("tier1Rate", v)}
                />
                <RateInput
                  label="Tier 2 (Standard)"
                  value={centsToDollars(config.tier2Rate)}
                  onChange={(v) => updateRate("tier2Rate", v)}
                />
                <RateInput
                  label="Tier 3 (Advanced)"
                  value={centsToDollars(config.tier3Rate)}
                  onChange={(v) => updateRate("tier3Rate", v)}
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <RateInput
                  label="Photo"
                  value={centsToDollars(config.photoBonus)}
                  onChange={(v) => updateRate("photoBonus", v)}
                />
                <RateInput
                  label="Graphic"
                  value={centsToDollars(config.graphicBonus)}
                  onChange={(v) => updateRate("graphicBonus", v)}
                />
                <RateInput
                  label="Video"
                  value={centsToDollars(config.videoBonus)}
                  onChange={(v) => updateRate("videoBonus", v)}
                />
                <RateInput
                  label="Audio"
                  value={centsToDollars(config.audioBonus)}
                  onChange={(v) => updateRate("audioBonus", v)}
                />
              </div>
            </div>
          </Section>

          {/* Special Bonuses */}
          <Section title="Special Bonuses">
            <div className="space-y-4">
              <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
                Bonus for featured articles.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <RateInput
                  label="Featured"
                  value={centsToDollars(config.featuredBonus)}
                  onChange={(v) => updateRate("featuredBonus", v)}
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
                Tier 2 article with Photo + Video:
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: "var(--fg-muted)" }}>Tier 2 Base</span>
                  <span style={{ color: "var(--fg-default)" }}>{formatCents(config.tier2Rate)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--fg-muted)" }}>+ Photo</span>
                  <span style={{ color: "var(--fg-default)" }}>{formatCents(config.photoBonus)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--fg-muted)" }}>+ Video</span>
                  <span style={{ color: "var(--fg-default)" }}>{formatCents(config.videoBonus)}</span>
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

// Rate Input Component
function RateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label
        className="block text-xs font-medium mb-1.5"
        style={{ color: "var(--fg-muted)" }}
      >
        {label}
      </label>
      <div className="relative">
        <DollarSign
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
          style={{ color: "var(--fg-faint)" }}
        />
        <input
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input pl-9"
          style={{ width: "100%" }}
        />
      </div>
    </div>
  );
}

// History Item Component
function HistoryItem({ entry }: { entry: HistoryEntry }) {
  const [expanded, setExpanded] = useState(false);

  let snapshot: RateConfig | null = null;
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
