import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Download,
  FileInput,
  FolderOpen,
  LayoutTemplate,
  Loader2,
  Maximize2,
  Minimize2,
  PencilRuler,
  Wand2,
} from "lucide-react";
import { takeDesignCraftIssue } from "~/lib/designcraft-handoff";
import type { IssueStudioState } from "../../shared/issue-studio";
import workspaceCss from "../components/designcraft/workspace.css?url";

export const Route = createFileRoute("/utilities/designcraft")({
  component: () => <DesignCraftWorkspace />,
  head: () => ({ links: [{ rel: "stylesheet", href: workspaceCss }] }),
});

type DocumentFile = {
  name: string;
  bytes: ArrayBuffer;
  fonts: { name: string; bytes: ArrayBuffer }[];
  warnings?: number;
};
type ExportFile = { name: string; href: string };
type Plan = { articles: number; pages: number; sample: boolean };
const documentLimit = 64 * 1024 * 1024;

export type StudioWorkspaceProps = {
  issueId: string;
  state: IssueStudioState;
  onPlannerState: (state: Record<string, unknown>) => void;
  onRegisterSnapshot?: (
    snapshot?: () => Promise<Record<string, unknown>>,
  ) => void;
};

export function DesignCraftWorkspace({
  studio,
}: { studio?: StudioWorkspaceProps } = {}) {
  const studioRef = useRef(studio);
  studioRef.current = studio;
  const studioImported = useRef(false);
  const studioHydrated = useRef(false);
  const studioLoadRequested = useRef(false);
  const snapshots = useRef(
    new Map<
      string,
      {
        resolve: (state: Record<string, unknown>) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  useEffect(() => {
    if (!studio?.onRegisterSnapshot) return;
    studio.onRegisterSnapshot(
      () =>
        new Promise((resolve, reject) => {
          if (!studioHydrated.current || !planner.current?.contentWindow) {
            reject(
              new Error(
                "Wait for the saved issue to finish loading before saving the designer.",
              ),
            );
            return;
          }
          const requestId = crypto.randomUUID();
          const timer = setTimeout(() => {
            snapshots.current.delete(requestId);
            reject(
              new Error(
                "The designer did not finish saving its artwork. Try Save issue again.",
              ),
            );
          }, 60000);
          snapshots.current.set(requestId, { resolve, reject, timer });
          planner.current.contentWindow.postMessage(
            {
              type: "ote.studio.snapshot",
              issueId: studioRef.current?.issueId,
              requestId,
            },
            location.origin,
          );
        }),
    );
    return () => {
      studio.onRegisterSnapshot?.(undefined);
      for (const pending of snapshots.current.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error("The designer was closed before its snapshot completed."),
        );
      }
      snapshots.current.clear();
    };
  }, [studio?.onRegisterSnapshot]);
  const studioConfig = studio
    ? JSON.stringify({
        pageBudget: studio.state.pageBudget,
        houseStyle: studio.state.houseStyle,
        reservations: studio.state.reservations,
        pages: studio.state.pages.map((p) => ({ id: p.id, locked: p.locked })),
        placements: studio.state.placements.map((p) => ({
          id: p.id,
          articleId: p.articleId,
          pageIds: p.pageIds,
          locked: p.locked,
          included: p.included,
          imageChoices: p.imageChoices,
          priority: p.priority,
          allowedPages: p.allowedPages,
        })),
      })
    : "";
  useEffect(() => {
    if (!studioHydrated.current || !studioRef.current) return;
    const value = studioRef.current.state;
    planner.current?.contentWindow?.postMessage(
      {
        type: "ote.studio.load",
        state: value.plannerState,
        pageBudget: value.pageBudget,
        houseStyle: value.houseStyle,
        reservations: value.reservations,
        placements: value.placements,
        pages: value.pages,
      },
      location.origin,
    );
  }, [studioConfig]);
  const planner = useRef<HTMLIFrameElement>(null);
  const editor = useRef<HTMLIFrameElement>(null);
  const issueInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const fontsInput = useRef<HTMLInputElement>(null);
  const currentDocument = useRef<DocumentFile | null>(null);
  const editorReady = useRef(false);
  const ownUrls = useRef<string[]>([]);
  const [tab, setTab] = useState<"plan" | "editor">("plan");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editorStarted, setEditorStarted] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorError, setEditorError] = useState(false);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("Loading page planner…");
  const [plan, setPlan] = useState<Plan>({
    articles: 0,
    pages: 0,
    sample: true,
  });
  const [exports, setExports] = useState<ExportFile[]>([]);

  const sendDocument = useCallback(() => {
    const document = currentDocument.current;
    if (!document || !editorReady.current || !editor.current?.contentWindow)
      return;
    const fonts = document.fonts.map((font) => ({
      name: font.name,
      bytes: font.bytes.slice(0),
    }));
    if (fonts.length)
      editor.current.contentWindow.postMessage(
        { type: "ote.designcraft.fonts", fonts },
        location.origin,
        fonts.map((font) => font.bytes),
      );
    const bytes = document.bytes.slice(0);
    editor.current.contentWindow.postMessage(
      { type: "ote.designcraft.open", name: document.name, bytes },
      location.origin,
      [bytes],
    );
    setEditorLoading(true);
    setStatus("Opening document…");
  }, []);

  const openDocument = useCallback(
    (document: DocumentFile) => {
      currentDocument.current = document;
      setName(document.name);
      setEditorStarted(true);
      setEditorLoading(true);
      setEditorError(false);
      setTab("editor");
      sendDocument();
    },
    [sendDocument],
  );

  useEffect(() => {
    const receive = async (event: MessageEvent) => {
      if (event.origin !== location.origin) return;
      const data = event.data;
      if (event.source === planner.current?.contentWindow) {
        if (data?.type === "ote.workspace.ready") {
          setReady(true);
          if (studioRef.current && !studioImported.current) {
            studioImported.current = true;
            setBusy(true);
            setStatus("Loading saved issue sources…");
            try {
              const response = await fetch(
                `/api/issue-studio/${encodeURIComponent(studioRef.current.issueId)}/bundle`,
              );
              if (!response.ok)
                throw new Error(
                  (await response.json()).error ||
                    "Could not load issue sources",
                );
              const bytes = await response.arrayBuffer();
              planner.current?.contentWindow?.postMessage(
                { type: "ote.import-issue", name: "issue-studio.zip", bytes },
                location.origin,
                [bytes],
              );
            } catch (error) {
              setBusy(false);
              setStatus(
                error instanceof Error
                  ? error.message
                  : "Could not load issue sources",
              );
            }
            return;
          }
          const pending = studioRef.current ? null : takeDesignCraftIssue();
          if (pending) {
            setBusy(true);
            setStatus("Importing selected articles…");
            try {
              const bytes = await pending.blob.arrayBuffer();
              planner.current?.contentWindow?.postMessage(
                { type: "ote.import-issue", name: pending.name, bytes },
                location.origin,
                [bytes],
              );
            } catch {
              setBusy(false);
              setStatus(
                "The selected articles could not be opened. Please try the export again.",
              );
            }
          }
        } else if (
          data?.type === "ote.studio.changed" &&
          studioRef.current &&
          data.state &&
          typeof data.state === "object"
        ) {
          studioRef.current.onPlannerState(data.state);
        } else if (
          data?.type === "ote.studio.snapshot" &&
          typeof data.requestId === "string"
        ) {
          const pending = snapshots.current.get(data.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            snapshots.current.delete(data.requestId);
            pending.resolve(data.state);
          }
        } else if (data?.type === "ote.studio.loaded") {
          studioHydrated.current = true;
          setBusy(false);
          setStatus("Saved issue restored · changes are saved with Save issue");
        } else if (data?.type === "ote.studio.error") {
          const pending = snapshots.current.get(data.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            snapshots.current.delete(data.requestId);
            pending.reject(
              new Error(String(data.message || "Designer save failed")),
            );
          }
          setBusy(false);
          setStatus(
            `Issue plan could not load: ${String(data.message || "Unknown error")}`,
          );
        } else if (data?.type === "ote.workspace.state") {
          if (
            studioRef.current &&
            !studioLoadRequested.current &&
            typeof data.status === "string" &&
            data.status.includes("articles imported")
          ) {
            studioLoadRequested.current = true;
            const value = studioRef.current.state;
            planner.current?.contentWindow?.postMessage(
              {
                type: "ote.studio.load",
                state: value.plannerState,
                pageBudget: value.pageBudget,
                houseStyle: value.houseStyle,
                reservations: value.reservations,
                placements: value.placements,
                pages: value.pages,
              },
              location.origin,
            );
          }
          setPlan({
            articles: Number(data.articles) || 0,
            pages: Number(data.pages) || 0,
            sample: !!data.sample,
          });
          setBusy(!!data.busy);
          if (typeof data.status === "string") setStatus(data.status);
          if (data.busy) setExports([]);
        } else if (
          data?.type === "ote.workspace.document" &&
          data.bytes instanceof ArrayBuffer &&
          data.bytes.byteLength <= documentLimit &&
          /\.(designcraft|idml)$/i.test(data.name)
        ) {
          let fontBytes = 0;
          const fonts = (Array.isArray(data.fonts) ? data.fonts : [])
            .slice(0, 64)
            .filter((font: any) => {
              if (
                !(font?.bytes instanceof ArrayBuffer) ||
                !/\.(ttf|otf|ttc|otc)$/i.test(font.name)
              )
                return false;
              fontBytes += font.bytes.byteLength;
              return fontBytes <= documentLimit;
            });
          setExports(
            (Array.isArray(data.downloads) ? data.downloads : []).filter(
              (file: any) =>
                typeof file.name === "string" &&
                typeof file.href === "string" &&
                file.href.startsWith(`blob:${location.origin}/`),
            ),
          );
          openDocument({
            name: data.name,
            bytes: data.bytes,
            fonts,
            warnings:
              Number.isInteger(data.warnings) && data.warnings >= 0
                ? data.warnings
                : 0,
          });
        }
      } else if (event.source === editor.current?.contentWindow) {
        if (data?.type === "ote.designcraft.ready") {
          editorReady.current = true;
          setEditorLoading(false);
          setEditorError(false);
          sendDocument();
        } else if (data?.type === "ote.designcraft.received") {
          setEditorLoading(false);
          const warnings = currentDocument.current?.warnings;
          setStatus(
            `Ready to edit${warnings ? ` · ${warnings} preflight warnings (see complete output ZIP)` : ""} · use the editor’s File menu to save your changes`,
          );
        } else if (data?.type === "ote.designcraft.error") {
          editorReady.current = false;
          setEditorLoading(false);
          setEditorError(true);
          setStatus(
            `Editor could not load: ${String(data.message || "Please try again")}`,
          );
        }
      }
    };
    window.addEventListener("message", receive);
    planner.current?.contentWindow?.postMessage(
      { type: "ote.workspace.command", action: "connect" },
      location.origin,
    );
    return () => {
      window.removeEventListener("message", receive);
      ownUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [openDocument, sendDocument]);

  async function importIssue(file?: File) {
    if (!file) return;
    if (file.size > documentLimit) {
      setStatus("Choose an issue ZIP or JSON up to 64 MB.");
      return;
    }
    setBusy(true);
    setStatus("Importing issue…");
    setTab("plan");
    try {
      const bytes = await file.arrayBuffer();
      planner.current?.contentWindow?.postMessage(
        { type: "ote.import-issue", name: file.name, bytes },
        location.origin,
        [bytes],
      );
    } catch {
      setBusy(false);
      setStatus("The issue file could not be read. Please try again.");
    }
  }
  async function importDocument(file?: File) {
    if (!file) return;
    if (
      !/\.(idml|designcraft)$/i.test(file.name) ||
      file.size > documentLimit
    ) {
      setStatus("Choose an IDML or DesignCraft document up to 64 MB.");
      return;
    }
    const bytes = await file.arrayBuffer();
    ownUrls.current.forEach((url) => URL.revokeObjectURL(url));
    const href = URL.createObjectURL(file);
    ownUrls.current = [href];
    setExports([{ name: file.name, href }]);
    openDocument({ name: file.name, bytes, fonts: [] });
  }
  async function importFonts(files: FileList | null) {
    if (!files || !editorReady.current) return;
    let total = 0;
    const selected = Array.from(files)
      .slice(0, 64)
      .filter(
        (file) =>
          /\.(ttf|otf|ttc|otc)$/i.test(file.name) &&
          (total += file.size) <= documentLimit,
      );
    const fonts = await Promise.all(
      selected.map(async (file) => ({
        name: file.name,
        bytes: await file.arrayBuffer(),
      })),
    );
    editor.current?.contentWindow?.postMessage(
      { type: "ote.designcraft.fonts", fonts },
      location.origin,
      fonts.map((font) => font.bytes),
    );
    setStatus(`${fonts.length} font file(s) loaded on this device`);
  }
  function generate() {
    setBusy(true);
    setStatus("Preparing your document…");
    planner.current?.contentWindow?.postMessage(
      { type: "ote.workspace.command", action: "generate" },
      location.origin,
    );
  }

  return (
    <div className={`designcraft-utility ${expanded ? "dc-expanded" : ""}`}>
      <div className="dc-heading">
        <div>
          <h1 className="page-title">
            {studio ? "Page design" : "DesignCraft"}
          </h1>
          <p className="page-subtitle">
            Plan your pages, compose the issue, and edit the finished document.
          </p>
        </div>
        <div className="dc-heading-actions">
          <button
            className="btn btn-secondary"
            disabled={!!studio || !ready || busy}
            onClick={() => issueInput.current?.click()}
          >
            <FileInput size={15} /> Import issue
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => documentInput.current?.click()}
          >
            <FolderOpen size={15} /> Open document
          </button>
        </div>
      </div>
      <input
        ref={issueInput}
        type="file"
        accept=".zip,.json"
        aria-label="Import DesignCraft issue"
        hidden
        onChange={(event) => {
          void importIssue(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={documentInput}
        type="file"
        accept=".idml,.designcraft"
        aria-label="Open DesignCraft document"
        hidden
        onChange={(event) => {
          void importDocument(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={fontsInput}
        type="file"
        accept=".ttf,.otf,.ttc,.otc"
        aria-label="Load document fonts"
        multiple
        hidden
        onChange={(event) => {
          void importFonts(event.target.files);
          event.target.value = "";
        }}
      />
      <div className="dc-workspace">
        <div className="dc-toolbar">
          <div
            className="dc-tabs"
            role="tablist"
            aria-label="DesignCraft workspace"
          >
            <button
              role="tab"
              id="dc-plan-tab"
              aria-controls="dc-plan-panel"
              aria-selected={tab === "plan"}
              onClick={() => setTab("plan")}
            >
              <LayoutTemplate size={15} /> Plan & compose
            </button>
            <button
              role="tab"
              id="dc-editor-tab"
              aria-controls="dc-editor-panel"
              aria-selected={tab === "editor"}
              disabled={!editorStarted}
              onClick={() => setTab("editor")}
            >
              <PencilRuler size={15} /> Editor
            </button>
          </div>
          <span className="dc-document-name">
            {tab === "editor"
              ? name
              : `${plan.sample ? "Sample issue · " : ""}${plan.articles} articles${plan.pages ? ` · ${plan.pages} saved pages` : ""}`}
          </span>
          <div className="dc-toolbar-actions">
            {tab === "editor" && (
              <button
                className="btn btn-ghost"
                disabled={editorLoading || editorError}
                onClick={() => fontsInput.current?.click()}
              >
                Fonts
              </button>
            )}
            {!!exports.length && (
              <details className="dc-exports">
                <summary className="btn btn-secondary">
                  <Download size={14} /> Downloads
                </summary>
                <div>
                  {exports.map((file) => (
                    <a key={file.name} href={file.href} download={file.name}>
                      {file.name.endsWith(".pdf")
                        ? "PDF"
                        : file.name.endsWith(".idml")
                          ? "InDesign IDML"
                          : file.name.endsWith(".designcraft")
                            ? "DesignCraft document"
                            : "Complete output ZIP"}
                    </a>
                  ))}
                  <p>
                    Generated output · save editor changes from its File menu.
                  </p>
                </div>
              </details>
            )}
            <button
              className="btn btn-primary"
              disabled={!ready || busy || editorLoading}
              onClick={generate}
            >
              {busy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Wand2 size={15} />
              )}{" "}
              {busy ? "Composing…" : "Generate & edit"}
            </button>
            <button
              className="btn btn-ghost dc-expand"
              aria-label={
                expanded ? "Exit expanded workspace" : "Expand workspace"
              }
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        </div>
        <div
          id="dc-plan-panel"
          role="tabpanel"
          aria-labelledby="dc-plan-tab"
          className="dc-panel"
          hidden={tab !== "plan"}
        >
          <iframe
            ref={planner}
            title="DesignCraft page planner"
            src="/designcraft/index.html?workspace=1"
          />
        </div>
        <div
          id="dc-editor-panel"
          role="tabpanel"
          aria-labelledby="dc-editor-tab"
          className="dc-panel dc-editor-panel"
          hidden={tab !== "editor"}
        >
          {editorStarted && (
            <iframe
              ref={editor}
              title="DesignCraft document editor"
              src="/designcraft/editor/index.html"
              allow="clipboard-read; clipboard-write"
            />
          )}
          {editorLoading && (
            <div className="dc-loading" role="status">
              <Loader2 className="animate-spin" size={24} />
              <span>Opening your document…</span>
            </div>
          )}
          {editorError && (
            <div className="dc-loading">
              <p>{status}</p>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setEditorError(false);
                  setEditorLoading(true);
                  if (editor.current)
                    editor.current.src = `/designcraft/editor/index.html?retry=${Date.now()}`;
                }}
              >
                Retry editor
              </button>
            </div>
          )}
        </div>
        <div className="dc-status" role="status">
          {(busy || editorLoading) && (
            <Loader2 size={12} className="animate-spin" />
          )}
          <span>{status}</span>
          <span className="dc-local">
            {studio
              ? "Save issue to keep layout changes"
              : "Works on this device"}
          </span>
        </div>
      </div>
    </div>
  );
}
