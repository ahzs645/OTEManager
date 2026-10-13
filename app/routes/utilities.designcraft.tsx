import { useEffect, useRef } from "react";
import { takeDesignCraftIssue } from "~/lib/designcraft-handoff";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";

export const Route = createFileRoute("/utilities/designcraft")({
  component: DesignCraftLayoutsPage,
});

function DesignCraftLayoutsPage() {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== 'ote.planner.ready') return;
      const pending = takeDesignCraftIssue();
      if (!pending) return;
      const bytes = await pending.blob.arrayBuffer();
      frame.current?.contentWindow?.postMessage({ type: 'ote.import-issue', name: pending.name, bytes }, window.location.origin, [bytes]);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
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
            DesignCraft web
          </h1>
          <p
            style={{
              color: "var(--fg-muted)",
              fontSize: "0.875rem",
              margin: "0.4rem 0 0",
            }}
          >
            In Publications, choose DesignCraft ZIP and select articles and
            images, then open the selection here. Plan pages, cover features and continuations, then compose and open the document in the web editor. You can also open existing IDML or DesignCraft files directly.
          </p>
        </div>
        <a
          href="/designcraft/editor/index.html"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost btn-sm"
        >
          <ExternalLink className="w-4 h-4" /> Open web editor
        </a>
      </div>
      <iframe
        ref={frame}
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
