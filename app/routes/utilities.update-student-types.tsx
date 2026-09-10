import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  GraduationCap,
  ChevronLeft,
  CheckCircle,
  AlertCircle,
  Upload,
  RefreshCw,
} from "lucide-react";
import { createServerFn } from "@tanstack/react-start";
import { LoadingSpinner } from "~/components/Layout";

// Server function to update student types
const updateStudentTypes = createServerFn({ method: "POST" })
  .inputValidator((data: { articles: any[] }) => data)
  .handler(async ({ data }) => {
    const { updateStudentTypes } = await import("../../server/sharepoint-json");
    return updateStudentTypes(data);
  });

export const Route = createFileRoute("/utilities/update-student-types")({
  component: UpdateStudentTypesPage,
});

function UpdateStudentTypesPage() {
  const [jsonData, setJsonData] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<{
    updated: number;
    skipped: number;
    notFound: number;
    errors: string[];
    details: string[];
  } | null>(null);

  const handleProcess = async () => {
    if (!jsonData.trim()) return;

    try {
      const parsed = JSON.parse(jsonData);
      const articles = Array.isArray(parsed)
        ? parsed
        : parsed.value || [parsed];

      setIsProcessing(true);
      setResults(null);

      const result = await updateStudentTypes({ data: { articles } });
      setResults(result);
    } catch (error) {
      setResults({
        updated: 0,
        skipped: 0,
        notFound: 0,
        errors: [
          `JSON parse error: ${error instanceof Error ? error.message : "Invalid JSON"}`,
        ],
        details: [],
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setJsonData(event.target?.result as string);
    };
    reader.readAsText(file);
  };

  return (
    <div className="page-container">
      {/* Header with back button */}
      <div style={{ marginBottom: "1.5rem" }}>
        <Link
          to="/utilities"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.25rem",
            fontSize: "0.8125rem",
            color: "var(--fg-muted)",
            textDecoration: "none",
            marginBottom: "0.75rem",
          }}
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Utilities
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              background: "var(--bg-subtle)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <GraduationCap
              className="w-5 h-5"
              style={{ color: "var(--fg-muted)" }}
            />
          </div>
          <div>
            <h1
              style={{
                fontSize: "1.25rem",
                fontWeight: 600,
                color: "var(--fg-default)",
                margin: 0,
                letterSpacing: "-0.02em",
              }}
            >
              Update Student Types
            </h1>
            <p
              style={{
                fontSize: "0.875rem",
                color: "var(--fg-muted)",
                margin: "0.25rem 0 0 0",
              }}
            >
              Re-import student type data (Undergrad/Grad) for existing authors
            </p>
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div
        style={{
          padding: "1rem 1.25rem",
          background: "rgba(37, 99, 235, 0.05)",
          border: "0.5px solid rgba(37, 99, 235, 0.15)",
          borderRadius: "8px",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            fontSize: "0.875rem",
            fontWeight: 500,
            color: "var(--fg-default)",
            marginBottom: "0.5rem",
          }}
        >
          How this works
        </div>
        <ul
          style={{
            fontSize: "0.8125rem",
            color: "var(--fg-muted)",
            margin: 0,
            paddingLeft: "1.25rem",
            listStyleType: "disc",
            lineHeight: 1.6,
          }}
        >
          <li>
            Upload the same SharePoint JSON export you used for the initial
            import
          </li>
          <li>Authors are matched by email address</li>
          <li>Only authors with type "Student" will be updated</li>
          <li>
            The "role" field (Undergrad, Grad, etc.) will be saved as Student
            Type
          </li>
          <li>
            Existing data is preserved - only the Student Type field is updated
          </li>
        </ul>
      </div>

      {/* Main Content */}
      <div
        style={{
          background: "var(--bg-surface)",
          border: "0.5px solid var(--border-default)",
          borderRadius: "8px",
          padding: "1.5rem",
        }}
      >
        {/* File Upload */}
        <div style={{ marginBottom: "1.5rem" }}>
          <label
            style={{
              display: "block",
              fontSize: "0.8125rem",
              fontWeight: 500,
              color: "var(--fg-default)",
              marginBottom: "0.5rem",
            }}
          >
            Upload JSON file
          </label>
          <input
            type="file"
            accept=".json"
            onChange={handleFileUpload}
            style={{
              fontSize: "0.875rem",
              color: "var(--fg-muted)",
            }}
          />
        </div>

        {/* JSON Input */}
        <div style={{ marginBottom: "1.5rem" }}>
          <label
            style={{
              display: "block",
              fontSize: "0.8125rem",
              fontWeight: 500,
              color: "var(--fg-default)",
              marginBottom: "0.5rem",
            }}
          >
            Or paste JSON data
          </label>
          <textarea
            value={jsonData}
            onChange={(e) => setJsonData(e.target.value)}
            placeholder="Paste your SharePoint JSON export here..."
            rows={8}
            className="input"
            style={{
              width: "100%",
              fontFamily: "var(--font-mono)",
              fontSize: "0.8125rem",
              resize: "vertical",
            }}
          />
        </div>

        {/* Process Button */}
        <div
          style={{
            paddingTop: "0.5rem",
            borderTop: "0.5px solid var(--border-subtle)",
          }}
        >
          <button
            onClick={handleProcess}
            disabled={isProcessing || !jsonData.trim()}
            className="btn btn-primary"
            style={{ gap: "0.5rem" }}
          >
            {isProcessing ? (
              <>
                <LoadingSpinner size="sm" />
                Processing...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Update Student Types
              </>
            )}
          </button>
        </div>

        {/* Results */}
        {results && (
          <div
            style={{
              marginTop: "1.5rem",
              padding: "1rem",
              borderRadius: "6px",
              background:
                results.errors.length > 0
                  ? "rgba(239, 68, 68, 0.05)"
                  : "rgba(34, 197, 94, 0.05)",
              border: `0.5px solid ${results.errors.length > 0 ? "rgba(239, 68, 68, 0.2)" : "rgba(34, 197, 94, 0.2)"}`,
            }}
          >
            {/* Summary */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "1rem",
                marginBottom:
                  results.details.length > 0 || results.errors.length > 0
                    ? "1rem"
                    : 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.875rem",
                  color: "var(--status-success)",
                }}
              >
                <CheckCircle className="w-4 h-4" />
                {results.updated} updated
              </div>
              <div
                style={{
                  fontSize: "0.875rem",
                  color: "var(--fg-muted)",
                }}
              >
                {results.skipped} skipped
              </div>
              <div
                style={{
                  fontSize: "0.875rem",
                  color: "var(--fg-muted)",
                }}
              >
                {results.notFound} not found
              </div>
              {results.errors.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    fontSize: "0.875rem",
                    color: "var(--status-error)",
                  }}
                >
                  <AlertCircle className="w-4 h-4" />
                  {results.errors.length} errors
                </div>
              )}
            </div>

            {/* Details */}
            {results.details.length > 0 && (
              <div
                style={{ marginBottom: results.errors.length > 0 ? "1rem" : 0 }}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    color: "var(--fg-muted)",
                    marginBottom: "0.5rem",
                  }}
                >
                  Details:
                </div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--fg-muted)",
                    maxHeight: "150px",
                    overflowY: "auto",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {results.details.map((detail, i) => (
                    <div key={i} style={{ marginTop: i > 0 ? "0.25rem" : 0 }}>
                      {detail}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Errors */}
            {results.errors.length > 0 && (
              <div
                style={{ fontSize: "0.8125rem", color: "var(--status-error)" }}
              >
                {results.errors.map((error, i) => (
                  <div key={i} style={{ marginTop: i > 0 ? "0.25rem" : 0 }}>
                    {error}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
