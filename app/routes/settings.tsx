import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { History, DollarSign, Save, RefreshCw, Upload, AlertCircle, CheckCircle, Database, HardDrive, Server, Eye, EyeOff, ChevronDown, ChevronUp, Plug, Unplug } from "lucide-react";
import { Section, Button, LoadingSpinner, formatDate } from "~/components/Layout";
import { getPaymentRateConfig, getPaymentRateHistory } from "~/lib/queries";
import { updatePaymentRateConfig, getConnectionConfig, saveConnectionConfig, testDatabaseConnection, testStorageConnection, type ConnectionConfig } from "~/lib/mutations";
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
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">
          Configure database connections, storage, and payment rates.
        </p>
      </div>

      {/* Connection Configuration */}
      <ConnectionConfigSection />

      {/* Payment Settings Header */}
      <div className="flex items-center gap-2 pt-2">
        <DollarSign className="w-5 h-5" style={{ color: "var(--accent)" }} />
        <h2 className="text-lg font-medium" style={{ color: "var(--fg-default)" }}>
          Payment Settings
        </h2>
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

// Connection Configuration Section
function ConnectionConfigSection() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showDbPassword, setShowDbPassword] = useState(false);
  const [showS3Secret, setShowS3Secret] = useState(false);

  // Connection status
  const [dbConnected, setDbConnected] = useState(false);
  const [storageConnected, setStorageConnected] = useState(false);
  const [usingS3, setUsingS3] = useState(false);

  // Test results
  const [dbTestResult, setDbTestResult] = useState<{ success: boolean; message: string; helpText?: string } | null>(null);
  const [storageTestResult, setStorageTestResult] = useState<{ success: boolean; message: string; helpText?: string } | null>(null);
  const [isTesting, setIsTesting] = useState<"db" | "storage" | null>(null);

  // Form state
  const [config, setConfig] = useState<ConnectionConfig>({
    database: {
      host: "localhost",
      port: 5432,
      database: "otemanager",
      username: "otemanager",
      password: "",
    },
    storage: {
      type: "local",
      uploadDir: "./uploads",
      maxFileSize: 52428800,
      endpoint: "http://localhost:9000",
      region: "us-east-1",
      bucket: "ote-articles",
      accessKeyId: "",
      secretAccessKey: "",
    },
  });

  // Load current configuration
  useEffect(() => {
    async function loadConfig() {
      try {
        const result = await getConnectionConfig();
        setConfig(result.config);
        setDbConnected(result.status.dbConnected);
        setStorageConnected(result.status.storageConnected);
        setUsingS3(result.status.usingS3);
      } catch (error) {
        console.error("Failed to load connection config:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadConfig();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const result = await saveConnectionConfig({ data: { config } });
      if (result.success) {
        setSaveMessage({ type: "success", text: result.message || "Configuration saved" });
      } else {
        setSaveMessage({ type: "error", text: result.error || "Failed to save" });
      }
    } catch (error) {
      setSaveMessage({ type: "error", text: "Failed to save configuration" });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 5000);
    }
  };

  const handleTestDatabase = async () => {
    setIsTesting("db");
    setDbTestResult(null);
    try {
      const result = await testDatabaseConnection({ data: config.database });
      setDbTestResult({
        success: result.success,
        message: result.success ? (result.message || "Connected") : result.error || "Connection failed",
        helpText: result.helpText,
      });
    } catch (error) {
      setDbTestResult({
        success: false,
        message: "Test failed",
        helpText: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsTesting(null);
    }
  };

  const handleTestStorage = async () => {
    setIsTesting("storage");
    setStorageTestResult(null);
    try {
      const result = await testStorageConnection({
        data: {
          type: config.storage.type,
          endpoint: config.storage.endpoint,
          region: config.storage.region,
          bucket: config.storage.bucket,
          accessKeyId: config.storage.accessKeyId,
          secretAccessKey: config.storage.secretAccessKey,
          uploadDir: config.storage.uploadDir,
        },
      });
      setStorageTestResult({
        success: result.success,
        message: result.success ? (result.message || "Connected") : result.error || "Connection failed",
        helpText: result.helpText,
      });
    } catch (error) {
      setStorageTestResult({
        success: false,
        message: "Test failed",
        helpText: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsTesting(null);
    }
  };

  const updateDatabase = (key: keyof ConnectionConfig["database"], value: string | number) => {
    setConfig((prev) => ({
      ...prev,
      database: { ...prev.database, [key]: value },
    }));
    setDbTestResult(null);
  };

  const updateStorage = (key: keyof ConnectionConfig["storage"], value: string | number) => {
    // Auto-add http:// to endpoint if missing
    if (key === "endpoint" && typeof value === "string" && value && !value.startsWith("http://") && !value.startsWith("https://")) {
      value = `http://${value}`;
    }
    setConfig((prev) => ({
      ...prev,
      storage: { ...prev.storage, [key]: value },
    }));
    setStorageTestResult(null);
  };

  if (isLoading) {
    return (
      <Section title="Connection Settings">
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner size="md" />
        </div>
      </Section>
    );
  }

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}
    >
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-opacity-50 transition-colors"
        style={{ background: isExpanded ? "var(--bg-subtle)" : "transparent" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="p-2 rounded-lg"
            style={{ background: "var(--bg-subtle)" }}
          >
            <Server className="w-5 h-5" style={{ color: "var(--accent)" }} />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-medium" style={{ color: "var(--fg-default)" }}>
              Connection Settings
            </h3>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="flex items-center gap-1 text-xs">
                {dbConnected ? (
                  <Plug className="w-3 h-3" style={{ color: "var(--status-success)" }} />
                ) : (
                  <Unplug className="w-3 h-3" style={{ color: "var(--status-error)" }} />
                )}
                <span style={{ color: dbConnected ? "var(--status-success)" : "var(--status-error)" }}>
                  Database {dbConnected ? "connected" : "disconnected"}
                </span>
              </span>
              <span className="flex items-center gap-1 text-xs">
                {storageConnected ? (
                  <Plug className="w-3 h-3" style={{ color: "var(--status-success)" }} />
                ) : (
                  <Unplug className="w-3 h-3" style={{ color: "var(--status-error)" }} />
                )}
                <span style={{ color: storageConnected ? "var(--status-success)" : "var(--status-error)" }}>
                  {usingS3 ? "S3/MinIO" : "Local storage"} {storageConnected ? "ready" : "error"}
                </span>
              </span>
            </div>
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5" style={{ color: "var(--fg-muted)" }} />
        ) : (
          <ChevronDown className="w-5 h-5" style={{ color: "var(--fg-muted)" }} />
        )}
      </button>

      {/* Expandable content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-6" style={{ borderTop: "1px solid var(--border-default)" }}>
          {/* Save Message */}
          {saveMessage && (
            <div
              className="mt-4 p-3 rounded-lg text-sm flex items-start gap-2"
              style={{
                background: saveMessage.type === "success" ? "var(--status-success-bg)" : "var(--status-error-bg)",
                color: saveMessage.type === "success" ? "var(--status-success)" : "var(--status-error)",
              }}
            >
              {saveMessage.type === "success" ? (
                <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              )}
              <div>
                <p>{saveMessage.text}</p>
                {saveMessage.type === "success" && (
                  <p className="text-xs mt-1 opacity-80">
                    A .env.generated file has been created. Copy its contents to your .env file and restart the application.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Database Configuration */}
          <div className="pt-4">
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-4 h-4" style={{ color: "var(--accent)" }} />
              <h4 className="text-sm font-medium" style={{ color: "var(--fg-default)" }}>
                PostgreSQL Database
              </h4>
            </div>
            <p className="text-xs mb-4" style={{ color: "var(--fg-muted)" }}>
              Configure the connection to your PostgreSQL database. Default setup uses 10.70.20.127:5432.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--fg-default)" }}>
                  Host
                </label>
                <input
                  type="text"
                  value={config.database.host}
                  onChange={(e) => updateDatabase("host", e.target.value)}
                  className="input"
                  style={{ width: "100%" }}
                  placeholder="10.70.20.127"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--fg-default)" }}>
                  Port
                </label>
                <input
                  type="number"
                  value={config.database.port}
                  onChange={(e) => updateDatabase("port", parseInt(e.target.value) || 5432)}
                  className="input"
                  style={{ width: "100%" }}
                  placeholder="5432"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--fg-default)" }}>
                  Database
                </label>
                <input
                  type="text"
                  value={config.database.database}
                  onChange={(e) => updateDatabase("database", e.target.value)}
                  className="input"
                  style={{ width: "100%" }}
                  placeholder="otemanager"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--fg-default)" }}>
                  Username
                </label>
                <input
                  type="text"
                  value={config.database.username}
                  onChange={(e) => updateDatabase("username", e.target.value)}
                  className="input"
                  style={{ width: "100%" }}
                  placeholder="otemanager"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--fg-default)" }}>
                Password
              </label>
              <div className="relative max-w-sm">
                <input
                  type={showDbPassword ? "text" : "password"}
                  value={config.database.password}
                  onChange={(e) => updateDatabase("password", e.target.value)}
                  className="input"
                  style={{ width: "100%", paddingRight: "2.5rem" }}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowDbPassword(!showDbPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--fg-muted)" }}
                >
                  {showDbPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Database Test Button and Result */}
            <div className="mt-4 flex items-start gap-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleTestDatabase}
                disabled={isTesting === "db"}
              >
                {isTesting === "db" ? (
                  <>
                    <LoadingSpinner size="sm" />
                    <span className="ml-2">Testing...</span>
                  </>
                ) : (
                  "Test Connection"
                )}
              </Button>
              {dbTestResult && (
                <div
                  className="flex-1 p-2 rounded text-xs"
                  style={{
                    background: dbTestResult.success ? "var(--status-success-bg)" : "var(--status-error-bg)",
                    color: dbTestResult.success ? "var(--status-success)" : "var(--status-error)",
                  }}
                >
                  <p className="font-medium">{dbTestResult.message}</p>
                  {dbTestResult.helpText && (
                    <p className="mt-1 opacity-80">{dbTestResult.helpText}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Storage Configuration */}
          <div
            className="pt-4"
            style={{ borderTop: "1px solid var(--border-default)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <HardDrive className="w-4 h-4" style={{ color: "var(--accent)" }} />
              <h4 className="text-sm font-medium" style={{ color: "var(--fg-default)" }}>
                File Storage
              </h4>
            </div>

            {/* Storage Type Toggle */}
            <div className="flex gap-4 mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="storageType"
                  value="local"
                  checked={config.storage.type === "local"}
                  onChange={() => updateStorage("type", "local")}
                  className="w-4 h-4"
                />
                <span className="text-sm" style={{ color: "var(--fg-default)" }}>
                  Local Storage
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="storageType"
                  value="s3"
                  checked={config.storage.type === "s3"}
                  onChange={() => updateStorage("type", "s3")}
                  className="w-4 h-4"
                />
                <span className="text-sm" style={{ color: "var(--fg-default)" }}>
                  S3/MinIO
                </span>
              </label>
            </div>

            {config.storage.type === "local" ? (
              <div className="space-y-4">
                <p className="text-xs" style={{ color: "var(--fg-muted)" }}>
                  Store files locally on the server's filesystem.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "var(--fg-default)" }}>
                      Upload Directory
                    </label>
                    <input
                      type="text"
                      value={config.storage.uploadDir}
                      onChange={(e) => updateStorage("uploadDir", e.target.value)}
                      className="input"
                      style={{ width: "100%" }}
                      placeholder="./uploads"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "var(--fg-default)" }}>
                      Max File Size (bytes)
                    </label>
                    <input
                      type="number"
                      value={config.storage.maxFileSize}
                      onChange={(e) => updateStorage("maxFileSize", parseInt(e.target.value) || 52428800)}
                      className="input"
                      style={{ width: "100%" }}
                      placeholder="52428800"
                    />
                    <p className="text-xs mt-1" style={{ color: "var(--fg-faint)" }}>
                      {(config.storage.maxFileSize / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs" style={{ color: "var(--fg-muted)" }}>
                  Connect to S3-compatible storage (MinIO, AWS S3). Default MinIO setup uses 10.70.20.168:9000.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "var(--fg-default)" }}>
                      Endpoint URL
                    </label>
                    <input
                      type="text"
                      value={config.storage.endpoint}
                      onChange={(e) => updateStorage("endpoint", e.target.value)}
                      className="input"
                      style={{ width: "100%" }}
                      placeholder="http://10.70.20.168:9000"
                    />
                    <p className="text-xs mt-1" style={{ color: "var(--fg-faint)" }}>
                      Include http:// or https://
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "var(--fg-default)" }}>
                      Region
                    </label>
                    <input
                      type="text"
                      value={config.storage.region}
                      onChange={(e) => updateStorage("region", e.target.value)}
                      className="input"
                      style={{ width: "100%" }}
                      placeholder="us-east-1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "var(--fg-default)" }}>
                      Bucket Name
                    </label>
                    <input
                      type="text"
                      value={config.storage.bucket}
                      onChange={(e) => updateStorage("bucket", e.target.value)}
                      className="input"
                      style={{ width: "100%" }}
                      placeholder="ote-articles"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "var(--fg-default)" }}>
                      Access Key ID
                    </label>
                    <input
                      type="text"
                      value={config.storage.accessKeyId}
                      onChange={(e) => updateStorage("accessKeyId", e.target.value)}
                      className="input"
                      style={{ width: "100%" }}
                      placeholder="admin"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "var(--fg-default)" }}>
                      Secret Access Key
                    </label>
                    <div className="relative">
                      <input
                        type={showS3Secret ? "text" : "password"}
                        value={config.storage.secretAccessKey}
                        onChange={(e) => updateStorage("secretAccessKey", e.target.value)}
                        className="input"
                        style={{ width: "100%", paddingRight: "2.5rem" }}
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowS3Secret(!showS3Secret)}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                        style={{ color: "var(--fg-muted)" }}
                      >
                        {showS3Secret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Storage Test Button and Result */}
            <div className="mt-4 flex items-start gap-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleTestStorage}
                disabled={isTesting === "storage"}
              >
                {isTesting === "storage" ? (
                  <>
                    <LoadingSpinner size="sm" />
                    <span className="ml-2">Testing...</span>
                  </>
                ) : (
                  "Test Connection"
                )}
              </Button>
              {storageTestResult && (
                <div
                  className="flex-1 p-2 rounded text-xs"
                  style={{
                    background: storageTestResult.success ? "var(--status-success-bg)" : "var(--status-error-bg)",
                    color: storageTestResult.success ? "var(--status-success)" : "var(--status-error)",
                  }}
                >
                  <p className="font-medium">{storageTestResult.message}</p>
                  {storageTestResult.helpText && (
                    <p className="mt-1 opacity-80">{storageTestResult.helpText}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Save Button */}
          <div
            className="pt-4 flex items-center gap-3"
            style={{ borderTop: "1px solid var(--border-default)" }}
          >
            <Button variant="primary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <LoadingSpinner size="sm" />
                  <span className="ml-2">Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Configuration
                </>
              )}
            </Button>
            <p className="text-xs" style={{ color: "var(--fg-muted)" }}>
              Changes require application restart to take effect.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
