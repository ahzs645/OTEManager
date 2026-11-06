import { useState } from "react";
import { ExternalLink, Send } from "lucide-react";
import { Section, Button, formatDate } from "~/components/Layout";
import { sendArticlesToWordPress } from "~/lib/mutations";
import { hasPassedApproval } from "../../../shared/model";
import { useUnsavedChanges } from "./UnsavedChangesContext";
import { WordPressResults, type WordPressSendResult } from "./WordPressResults";

interface Publication {
  siteUrl: string;
  remotePostId: number | null;
  remoteEditUrl: string | null;
  remoteUrl: string | null;
  remoteStatus: string | null;
  lastResult: string;
  lastError: string | null;
  warnings: string | null;
  lastPushedAt: Date | string | null;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending review",
  publish: "Published",
  future: "Scheduled",
  private: "Private",
};

function parseWarnings(value: string | null): string[] {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((w) => typeof w === "string") : [];
  } catch {
    return [];
  }
}

/** Article sidebar card: where the article is on WordPress, and a send button. */
export function WordPressPanel({
  articleId,
  status,
  publications,
}: {
  articleId: string;
  status: string;
  publications: Publication[];
}) {
  const { hasUnsavedChanges } = useUnsavedChanges();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<WordPressSendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Publication | null>(
    [...publications].sort((a, b) => +new Date(b.lastPushedAt || 0) - +new Date(a.lastPushedAt || 0))[0] || null,
  );
  const approved = hasPassedApproval(status);

  const send = async () => {
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const response = await sendArticlesToWordPress({ data: { articleIds: [articleId] } });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const sent = response.results[0];
      setResult(sent);
      if (sent.outcome !== "skipped" || sent.postId)
        setCurrent((previous) => ({
          siteUrl: response.siteUrl,
          remotePostId: sent.postId ?? previous?.remotePostId ?? null,
          remoteEditUrl: sent.editUrl ?? previous?.remoteEditUrl ?? null,
          remoteUrl: previous?.remoteUrl ?? null,
          remoteStatus: sent.outcome === "failed" ? previous?.remoteStatus ?? null : previous?.remoteStatus ?? "draft",
          lastResult: sent.outcome === "failed" ? "failed" : sent.warnings.length ? "warning" : "success",
          lastError: sent.outcome === "failed" ? sent.message : null,
          warnings: JSON.stringify(sent.warnings),
          lastPushedAt: new Date(),
        }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sending failed.");
    } finally {
      setSending(false);
    }
  };

  const storedWarnings = current ? parseWarnings(current.warnings) : [];
  return (
    <Section title="WordPress">
      <div className="space-y-3">
        {current?.remotePostId ? (
          <div className="text-sm space-y-1" style={{ color: "var(--fg-default)" }}>
            <p>
              <span className="badge badge-default">{STATUS_LABELS[current.remoteStatus || ""] || current.remoteStatus || "Sent"}</span>{" "}
              Post #{current.remotePostId}
            </p>
            {current.lastPushedAt && (
              <p className="text-xs" style={{ color: "var(--fg-muted)" }}>
                Last sent {formatDate(current.lastPushedAt as any)}
              </p>
            )}
            {current.remoteEditUrl && (
              <a href={current.remoteEditUrl} target="_blank" rel="noreferrer" className="text-xs inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>
                Open in WordPress <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        ) : (
          <p className="text-sm" style={{ color: "var(--fg-muted)" }}>Not sent to WordPress yet.</p>
        )}
        {!result && current?.lastResult === "failed" && current.lastError && (
          <p className="text-xs" role="alert" style={{ color: "var(--status-error)" }}>Last send failed: {current.lastError}</p>
        )}
        {!result && storedWarnings.length > 0 && (
          <ul className="text-xs list-disc pl-4" style={{ color: "var(--status-warning)" }}>
            {storedWarnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
        {result && <WordPressResults results={[result]} compact />}
        {error && <p className="text-xs" role="alert" style={{ color: "var(--status-error)" }}>{error}</p>}
        {hasUnsavedChanges && (
          <p className="text-xs" style={{ color: "var(--status-warning)" }}>Save your changes first; the saved version is what gets sent.</p>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={sending || !approved}
          onClick={send}
          title={approved ? "Send as a WordPress draft" : "Articles can be sent once they are approved"}
        >
          <Send className="w-4 h-4" />
          {sending ? "Sending…" : current?.remotePostId ? "Send update" : "Send to WordPress"}
        </Button>
        <p className="text-xs" style={{ color: "var(--fg-faint)" }}>
          {approved
            ? "Sent as a draft. Editors review and publish in WordPress. A post that is already published is not changed."
            : "Available once the article is approved."}
        </p>
      </div>
    </Section>
  );
}
