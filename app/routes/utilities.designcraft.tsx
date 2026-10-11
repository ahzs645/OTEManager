import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";

export const Route = createFileRoute("/utilities/designcraft")({
  component: DesignCraftLayoutsPage,
});

function DesignCraftLayoutsPage() {
  return (
    <div className="page-container">
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
            DesignCraft layouts
          </h1>
          <p
            style={{
              color: "var(--fg-muted)",
              fontSize: "0.875rem",
              margin: "0.4rem 0 0",
            }}
          >
            Review page templates and PDFs, plan an issue, and import issue.json
            from a Publications DesignCraft export.
          </p>
        </div>
        <a
          href="/designcraft/index.html"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost btn-sm"
        >
          <ExternalLink className="w-4 h-4" /> Open full view
        </a>
      </div>
      <iframe
        title="DesignCraft template library and issue planner"
        src="/designcraft/index.html"
        style={{
          width: "100%",
          minHeight: "78vh",
          border: "1px solid var(--border-default)",
          borderRadius: "8px",
          background: "white",
        }}
      />
    </div>
  );
}
