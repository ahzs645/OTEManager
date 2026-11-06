import { ExternalLink } from "lucide-react";

export interface WordPressSendResult {
  articleId: string;
  title: string;
  outcome: "created" | "updated" | "unchanged" | "skipped" | "failed";
  message: string | null;
  warnings: string[];
  postId: number | null;
  editUrl: string | null;
}

const OUTCOME: Record<WordPressSendResult["outcome"], { label: string; color: string }> = {
  created: { label: "Draft created", color: "var(--status-success)" },
  updated: { label: "Draft updated", color: "var(--status-success)" },
  unchanged: { label: "Already up to date", color: "var(--fg-muted)" },
  skipped: { label: "Skipped", color: "var(--status-warning)" },
  failed: { label: "Failed", color: "var(--status-error)" },
};

/** Per-article outcomes of a WordPress send, including warnings. */
export function WordPressResults({ results, compact = false }: { results: WordPressSendResult[]; compact?: boolean }) {
  return (
    <ul className="space-y-2 text-sm" aria-live="polite">
      {results.map((r) => (
        <li key={r.articleId} className="rounded-md p-2" style={{ background: "var(--bg-subtle)" }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium" style={{ color: OUTCOME[r.outcome].color }}>{OUTCOME[r.outcome].label}</span>
            {!compact && <span style={{ color: "var(--fg-default)" }}>{r.title}</span>}
            {r.editUrl && (
              <a href={r.editUrl} target="_blank" rel="noreferrer" className="text-xs inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>
                Open <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          {r.message && <p className="text-xs mt-1" style={{ color: "var(--fg-muted)" }}>{r.message}</p>}
          {r.warnings.length > 0 && (
            <ul className="text-xs list-disc pl-4 mt-1" style={{ color: "var(--status-warning)" }}>
              {r.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
