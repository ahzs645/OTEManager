import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useBlocker } from "@tanstack/react-router";
import {
  ArrowLeft,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Search,
  X,
} from "lucide-react";
import {
  ensureIssueStudio,
  saveIssueStudio,
  archiveNativeFork,
} from "~/lib/issue-studio";
import { getArticles } from "~/lib/queries";
import { updateArticleIssue } from "~/lib/mutations";
import {
  mergePlannerRecipe,
  reconcileDepartedStories,
} from "../components/issue-studio/state";
import { DesignCraftWorkspace } from "./utilities.designcraft";
import type {
  IssueStudioState,
  IssueStudioReservation,
} from "../../shared/issue-studio";
import studioCss from "../components/issue-studio/studio.css?url";
import workspaceCss from "../components/designcraft/workspace.css?url";

export const Route = createFileRoute("/publications_/issues/$issueId/studio")({
  loader: async ({ params }) => ({ issueId: params.issueId }),
  component: IssueStudio,
  head: () => ({
    links: [
      { rel: "stylesheet", href: studioCss },
      { rel: "stylesheet", href: workspaceCss },
    ],
  }),
});

type StudioView = Awaited<ReturnType<typeof ensureIssueStudio>>;
type SearchArticle = Awaited<
  ReturnType<typeof getArticles>
>["articles"][number];
type CompositionArtifact = { name: string; path: string; sha256?: string };
type CompositionJob = {
  id: string;
  status: string;
  artifacts?: CompositionArtifact[];
  diagnostics?: { message?: string };
  result?: {
    artifacts?: CompositionArtifact[];
    diagnostics?: { message?: string };
  };
  kind?: string;
  fork?: {
    id: string;
    name?: string;
    path: string;
    status: "active" | "archived";
    sourceRevision: number;
  };
};
type ImageChoice = {
  attachmentId: string;
  caption?: string;
  credit?: string;
  crop?: { x: number; y: number };
};
const copyState = (state: IssueStudioState): IssueStudioState =>
  JSON.parse(JSON.stringify(state));

function IssueStudio() {
  const [initial, setInitial] = useState<StudioView | null>(null);
  const [loadError, setLoadError] = useState("");
  const { issueId } = Route.useParams();
  useEffect(() => {
    let cancelled = false;
    setInitial(null);
    setLoadError("");
    ensureIssueStudio({ data: { issueId } }).then(
      (value) => {
        if (!cancelled) setInitial(value);
      },
      (error) => {
        if (!cancelled)
          setLoadError(
            error instanceof Error ? error.message : "Could not load issue",
          );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [issueId]);
  if (loadError)
    return (
      <div className="studio-empty" role="alert">
        {loadError}
      </div>
    );
  if (!initial)
    return (
      <div className="studio-empty" role="status">
        Loading saved issue…
      </div>
    );
  return (
    <IssueStudioEditor key={issueId} initial={initial} issueId={issueId} />
  );
}

export function IssueStudioEditor({
  initial,
  issueId,
}: {
  initial: StudioView;
  issueId: string;
}) {
  const [view, setView] = useState<StudioView>(initial);
  const [state, setState] = useState<IssueStudioState>(() =>
    copyState(initial.state),
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const compositionRetries = useRef(new Map<string, number>());
  const [lastJob, setLastJob] = useState<CompositionJob | null>(null);
  const [adobeJobId, setAdobeJobId] = useState("");
  const [adobeNativePath, setAdobeNativePath] = useState("");
  const [adobeReport, setAdobeReport] = useState<File | null>(null);
  const [printProfile, setPrintProfile] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchArticle[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<string | null>(
    initial.articles[0]?.id ?? null,
  );
  const [selectedPage, setSelectedPage] = useState(1);
  const [session, setSession] = useState(0);
  const [designerOpen, setDesignerOpen] = useState(false);
  const [allowedPageDraft, setAllowedPageDraft] = useState("");
  const [pageRuleError, setPageRuleError] = useState("");
  useEffect(() => {
    const allowed = state.placements.find(
      (p) => p.articleId === selectedArticle,
    )?.allowedPages;
    setAllowedPageDraft(Array.isArray(allowed) ? allowed.join(", ") : "");
    setPageRuleError("");
  }, [selectedArticle]);
  const navigation = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });
  const snapshot = useRef<(() => Promise<Record<string, unknown>>) | undefined>(
    undefined,
  );
  const registerSnapshot = useCallback(
    (value?: () => Promise<Record<string, unknown>>) => {
      snapshot.current = value;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    if (!search.trim()) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const value = await getArticles({
          data: { search: search.trim(), limit: 30 },
        });
        if (!cancelled)
          setResults(value.articles.filter((a) => a.issueId !== issueId));
      } catch (error) {
        if (!cancelled)
          setNotice(
            error instanceof Error ? error.message : "Article search failed",
          );
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [search, issueId]);

  const change = useCallback(
    (update: (value: IssueStudioState) => IssueStudioState) => {
      setState((value) => update(value));
      setDirty(true);
      setNotice("");
    },
    [],
  );

  const plannerChanged = useCallback((recipe: Record<string, unknown>) => {
    setState((value) => {
      if (JSON.stringify(value.plannerState) === JSON.stringify(recipe))
        return value;
      setDirty(true);
      return mergePlannerRecipe(value, recipe);
    });
  }, []);

  async function save() {
    if (busy || pageRuleError) return null;
    setBusy(true);
    setNotice("");
    try {
      const savingState = snapshot.current
        ? mergePlannerRecipe(state, await snapshot.current())
        : state;
      const next = await saveIssueStudio({
        data: {
          issueId,
          expectedRevision: view.plan?.revision ?? 0,
          state: savingState,
        },
      });
      setView(next);
      setState(copyState(next.state));
      setDirty(false);
      setNotice(`Saved revision ${next.plan?.revision}.`);
      if (!designerOpen) setSession((value) => value + 1);
      return next;
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The issue could not be saved. Your changes remain here.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function composeSavedRevision() {
    if (printProfile && printProfile.size > 512 * 1024) {
      setNotice("Print profile must be 512 KB or smaller.");
      return;
    }
    const saved = dirty ? await save() : view;
    if (!saved?.plan) return;
    setBusy(true);
    setComposing(true);
    setNotice("Composing the saved revision with DesignCraft…");
    try {
      const profile = printProfile
        ? JSON.parse(await printProfile.text())
        : null;
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(profile)),
      );
      const profileHash = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, "0"),
      )
        .join("")
        .slice(0, 16);
      const attemptKey = `${saved.plan.revision}-${profileHash}`;
      const retry = compositionRetries.current.get(attemptKey) ?? 0;
      const response = await fetch(
        `/api/issue-studio/${encodeURIComponent(issueId)}/compose`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: saved.plan.revision,
            idempotencyKey: `studio-${attemptKey}-${retry}`,
            ...(profile ? { profile } : {}),
          }),
        },
      );
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.error || "Composition failed");
      if (result.job.status === "failed")
        compositionRetries.current.set(attemptKey, retry + 1);
      setLastJob(result.job);
      setNotice(
        result.job.status === "completed" || result.job.status === "succeeded"
          ? "Saved revision composed. Inspect the preflight report before approving output. Adobe verification is separate."
          : `Composition ${result.job.status}: ${result.job.diagnostics?.message || "Inspect the recorded diagnostics."}`,
      );
      const next = await ensureIssueStudio({ data: { issueId } });
      setView(next);
      setState(copyState(next.state));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Composition failed");
    } finally {
      setBusy(false);
      setComposing(false);
    }
  }

  async function attachNativeFork(file?: File) {
    if (!file) return;
    if (
      !/\.(designcraft|idml|indd|indt)$/i.test(file.name) ||
      file.size > 64 * 1024 * 1024
    ) {
      setNotice(
        "Choose a saved DesignCraft, IDML, INDD, or INDT document up to 64 MB.",
      );
      return;
    }
    const saved = dirty ? await save() : view;
    if (!saved?.plan) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name);
      form.append("expectedRevision", String(saved.plan.revision));
      const response = await fetch(
        `/api/issue-studio/${encodeURIComponent(issueId)}/forks`,
        { method: "POST", body: form },
      );
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.error || "The document fork could not be saved");
      const next = await ensureIssueStudio({ data: { issueId } });
      setView(next);
      setNotice(
        "Manual document fork saved. Keep it active until editorial reconciliation is complete.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The document fork could not be saved",
      );
    } finally {
      setBusy(false);
    }
  }
  async function archiveFork(forkId: string) {
    if (dirty) {
      setNotice("Save the issue before archiving a document fork.");
      return;
    }
    setBusy(true);
    try {
      const next = await archiveNativeFork({
        data: { issueId, forkId, expectedRevision: view.plan?.revision ?? 0 },
      });
      setView(next);
      setNotice("Document fork archived. Its saved file remains available.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not archive document fork",
      );
    } finally {
      setBusy(false);
    }
  }
  async function uploadReservationArtwork(reservationId: string, file?: File) {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (
      !extension ||
      !["png", "jpg", "jpeg", "webp", "gif", "tif", "tiff", "pdf"].includes(
        extension,
      ) ||
      file.size > 16 * 1024 * 1024
    ) {
      setNotice("Choose image or PDF artwork up to 16 MB.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("path", `assets/user-${reservationId}.${extension}`);
      const response = await fetch(
        `/api/issue-studio/${encodeURIComponent(issueId)}/assets`,
        { method: "POST", body: form },
      );
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.error || "Artwork upload failed");
      updateReservation(reservationId, {
        artworkPath: result.path,
        artworkStatus: "ready",
      });
      setNotice(
        "Artwork uploaded. Save the issue to attach it to the reservation.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Artwork upload failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function recordAdobeReport() {
    if (dirty) {
      setNotice("Save the issue before recording Adobe evidence.");
      return;
    }
    if (!adobeJobId || !adobeNativePath || !adobeReport || !printProfile) {
      setNotice(
        "Choose the composition, saved Adobe document, report JSON, and print profile JSON.",
      );
      return;
    }
    if (adobeReport.size > 512 * 1024 || printProfile.size > 512 * 1024) {
      setNotice(
        "Adobe report and print profile must each be 512 KB or smaller.",
      );
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `/api/issue-studio/${encodeURIComponent(issueId)}/adobe-report`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: adobeJobId,
            nativePath: adobeNativePath,
            report: JSON.parse(await adobeReport.text()),
            printProfile: JSON.parse(await printProfile.text()),
          }),
        },
      );
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.error || "Adobe evidence could not be recorded");
      const next = await ensureIssueStudio({ data: { issueId } });
      setView(next);
      setLastJob(null);
      setNotice(
        "Adobe evidence recorded against the composition. Review the recorded checks and release blockers before approval.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Adobe evidence could not be recorded",
      );
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (dirty) {
      setNotice(
        "Save your changes before refreshing sources. A conflicting save keeps your changes here for review.",
      );
      return;
    }
    setBusy(true);
    try {
      const next = await ensureIssueStudio({ data: { issueId } });
      setView(next);
      setState(copyState(next.state));
      setSession((value) => value + 1);
      setNotice(
        "Sources refreshed. Changed placements are marked stale; recorded choices are preserved.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  async function assign(article: SearchArticle) {
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const result = await updateArticleIssue({
        data: { articleId: article.id, issueId },
      });
      if (!result.success) throw new Error(result.error);
      const next = await ensureIssueStudio({ data: { issueId } });
      setView(next);
      setState(copyState(next.state));
      setSelectedArticle(article.id);
      setSearch("");
      setResults([]);
      setSession((value) => value + 1);
      setNotice(`“${article.title}” is now assigned to this issue.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Assignment failed");
    } finally {
      setBusy(false);
    }
  }

  function updatePlacement(articleId: string, fields: Record<string, unknown>) {
    change((value) => {
      let updated = {
        ...value,
        placements: value.placements.map((p) =>
          p.articleId === articleId
            ? {
                ...p,
                ...fields,
                ...(fields.included === false ? { pageIds: [] } : {}),
              }
            : p,
        ),
      };
      if (fields.included === false)
        updated = reconcileDepartedStories(
          updated,
          updated.placements
            .filter((p) => p.included !== false)
            .map((p) => p.articleId),
        );
      return updated;
    });
  }
  function addReservation(
    kind: IssueStudioReservation["kind"],
    footprint: string,
  ) {
    const rect: [number, number, number, number] =
      footprint === "full"
        ? [36, 100, 684, 644]
        : footprint === "side"
          ? [552, 100, 168, 644]
          : footprint === "bottom"
            ? [36, 600, 684, 144]
            : [384, 420, 336, 324];
    change((value) => ({
      ...value,
      reservations: [
        ...value.reservations,
        {
          id: `reservation-${crypto.randomUUID()}`,
          pageNumber: selectedPage,
          rect,
          kind,
          artworkStatus: "pending",
          locked: kind === "booked-ad",
        },
      ],
    }));
  }
  function updateReservation(
    id: string,
    fields: Partial<IssueStudioReservation>,
  ) {
    change((value) => ({
      ...value,
      reservations: value.reservations.map((reservation) =>
        reservation.id === id ? { ...reservation, ...fields } : reservation,
      ),
    }));
  }
  const article = view.articles.find((a) => a.id === selectedArticle);
  const placement = state.placements.find(
    (p) => p.articleId === selectedArticle,
  );
  const images =
    article?.attachments.filter((a) =>
      ["photo", "graphic"].includes(a.attachmentType),
    ) ?? [];
  const imageChoices: ImageChoice[] = Array.isArray(placement?.imageChoices)
    ? (placement.imageChoices as ImageChoice[])
    : images
        .filter((image) => image.includeInExport !== false)
        .map((image) => ({
          attachmentId: image.id,
          caption: image.caption ?? "",
        }));
  const unplaced = state.placements.filter(
    (p) => p.included !== false && !p.pageIds.length,
  ).length;
  const stale = state.placements.filter((p) => p.stale).length;
  const pendingAds = state.reservations.filter(
    (r) =>
      r.kind === "booked-ad" && (r.artworkStatus !== "ready" || !r.artworkPath),
  ).length;
  const page = state.pages.find((p) => p.pageNumber === selectedPage);
  const reserved = state.reservations.filter(
    (r) => r.pageNumber === selectedPage,
  );

  const savedRecipes = Array.isArray(state.plannerState?.savedPages)
    ? (state.plannerState.savedPages as Array<{
        id: string;
        articleIds?: string[];
      }>)
    : [];
  const departedPages = savedRecipes.filter((page) =>
    page.articleIds?.some(
      (id) => !view.articles.some((article) => article.id === id),
    ),
  );
  const activeJobs = [
    ...(lastJob ? [lastJob] : []),
    ...(view.jobs as unknown as CompositionJob[])
      .map((job) => ({ ...job, ...job.result }))
      .filter((job) => job.id !== lastJob?.id),
  ];

  return (
    <div className="issue-studio">
      {navigation.status === "blocked" && (
        <div className="studio-stale" role="alert">
          This issue has unsaved changes.
          <div className="studio-actions">
            <button
              className="btn btn-primary"
              onClick={() => navigation.reset()}
            >
              Keep editing
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => navigation.proceed()}
            >
              Leave without saving
            </button>
          </div>
        </div>
      )}
      <header className="studio-header">
        <div>
          <Link to="/publications" className="studio-back">
            <ArrowLeft size={14} /> Publications
          </Link>
          <h1>
            {view.issue.title || `Issue ${view.issue.issueNumber}`}{" "}
            <span>Issue Studio</span>
          </h1>
          <p>
            Plan the issue, reserve space, and keep design decisions with your
            articles.
          </p>
        </div>
        <div className="studio-actions">
          <button
            className="btn btn-secondary"
            onClick={() => void refresh()}
            disabled={busy}
          >
            <RefreshCw size={15} /> Refresh sources
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={busy || !dirty || !!pageRuleError}
          >
            <Save size={15} />{" "}
            {busy ? (composing ? "Checking…" : "Saving…") : "Save issue"}
          </button>
        </div>
      </header>
      <div className="studio-summary" aria-label="Issue capacity">
        <div>
          <strong>{state.pageBudget}</strong>
          <span>Page budget</span>
        </div>
        <div>
          <strong>{state.pages.length}</strong>
          <span>Planned pages</span>
        </div>
        <div>
          <strong>{unplaced}</strong>
          <span>Unplaced stories</span>
        </div>
        <div>
          <strong>{state.reservations.length}</strong>
          <span>Reserved spaces</span>
        </div>
        <div className={stale ? "studio-attention" : ""}>
          <strong>{stale}</strong>
          <span>Stale placements</span>
        </div>
        <div className={pendingAds ? "studio-attention" : ""}>
          <strong>{pendingAds}</strong>
          <span>Booked ads awaiting artwork</span>
        </div>
      </div>
      <div className="studio-save-status" role="status">
        {dirty
          ? "Unsaved changes"
          : `Saved revision ${view.plan?.revision ?? 0}`}{" "}
        · {dirty ? "Stale" : view.releaseReadiness.level} — compose the saved
        plan to check text fit. {notice && <strong>{notice}</strong>}
      </div>
      {departedPages.length > 0 && (
        <div className="studio-stale" role="alert">
          {departedPages.length} saved page
          {departedPages.length === 1
            ? " references a story"
            : "s reference stories"}{" "}
          that left this issue. Reconcile these assignments before reopening the
          designer.
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => {
              if (
                departedPages.some(
                  (page) => state.pages.find((p) => p.id === page.id)?.locked,
                )
              ) {
                setNotice(
                  "Unlock affected pages and save before reconciling departed story assignments.",
                );
                return;
              }
              change((value) =>
                reconcileDepartedStories(
                  value,
                  view.articles.map((article) => article.id),
                ),
              );
              setNotice(
                "Departed assignments removed. Save, then choose replacement stories or layouts on affected pages.",
              );
            }}
          >
            Remove departed story assignments
          </button>
        </div>
      )}
      <details className="studio-release">
        <summary>
          {!dirty && view.releaseReadiness.ready
            ? "Saved revision passes release checks"
            : `Release checks: ${view.releaseReadiness.blockers.length}${dirty ? "+" : ""} unresolved`}
        </summary>
        <p className="studio-muted">
          {dirty
            ? "Save and recheck this issue after changes."
            : "Checks apply to the recorded revision and output."}
        </p>
        <ul>
          {view.releaseReadiness.blockers.map((blocker, index) => (
            <li key={`${blocker.code}-${index}`}>{blocker.message}</li>
          ))}
        </ul>
      </details>
      <fieldset className="studio-grid" disabled={busy}>
        <aside className="studio-panel studio-articles">
          <div className="studio-panel-heading">
            <h2>
              Articles <span>{view.articles.length}</span>
            </h2>
          </div>
          <label className="studio-search">
            <Search size={15} />
            <input
              aria-label="Find articles to add"
              placeholder="Find title or author to add…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {searching && <p className="studio-muted">Searching…</p>}
          {search.trim() && !searching && !results.length && (
            <p className="studio-muted">No additional articles match.</p>
          )}
          {results.map((result) => (
            <div className="studio-search-result" key={result.id}>
              <strong>{result.title}</strong>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void assign(result)}
              >
                <Plus size={13} />
                {result.issueId ? "Move to this issue" : "Add to issue"}
              </button>
            </div>
          ))}
          <div className="studio-article-list">
            {view.articles.map((item) => {
              const p = state.placements.find(
                (value) => value.articleId === item.id,
              );
              return (
                <button
                  key={item.id}
                  className={`studio-article ${selectedArticle === item.id ? "selected" : ""}`}
                  onClick={() => setSelectedArticle(item.id)}
                >
                  <strong>{item.title}</strong>
                  <span>{item.displayAuthor}</span>
                  <small>
                    {p?.included === false
                      ? "Excluded from layout"
                      : p?.pageIds.length
                        ? `${p.pageIds.length} page${p.pageIds.length === 1 ? "" : "s"}`
                        : "Unplaced"}
                    {p?.stale ? " · Stale source" : ""}
                    {p?.locked ? " · Locked" : ""}
                  </small>
                </button>
              );
            })}
            {!view.articles.length && (
              <p className="studio-empty">
                Start with the page budget and ad reservations. Add articles
                whenever they are ready.
              </p>
            )}
          </div>
        </aside>
        <section className="studio-panel studio-pages">
          <div className="studio-panel-heading">
            <h2>Issue map</h2>
            <label>
              Pages{" "}
              <input
                className="studio-number"
                aria-label="Page budget"
                type="number"
                min={1}
                max={128}
                value={state.pageBudget}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (Number.isInteger(value) && value > 0 && value <= 128)
                    change((s) => ({ ...s, pageBudget: value }));
                }}
              />
            </label>
          </div>
          <label className="studio-house-style">
            House style
            <select
              value={state.houseStyle}
              onChange={(event) =>
                change((value) => ({
                  ...value,
                  houseStyle: event.target.value,
                }))
              }
            >
              <option value="ote-2025">OTE 2025–26</option>
              <option value="ote-2024">OTE 2024–25</option>
              <option value="classic">Classic</option>
            </select>
          </label>
          <div className="studio-page-map">
            {Array.from({ length: state.pageBudget }, (_, index) => {
              const number = index + 1,
                saved = state.pages.find((p) => p.pageNumber === number),
                ads = state.reservations.filter((r) => r.pageNumber === number);
              return (
                <button
                  key={number}
                  className={`studio-page ${selectedPage === number ? "selected" : ""} ${saved ? "planned" : ""}`}
                  onClick={() => setSelectedPage(number)}
                  aria-label={`Page ${number}${saved ? ", planned" : ", empty"}`}
                >
                  <span>
                    {number}
                    {saved?.locked && <LockKeyhole size={12} />}
                  </span>
                  <div>{saved ? "Layout saved" : "Open page"}</div>
                  {ads.length > 0 && <small>{ads.length} reserved</small>}
                </button>
              );
            })}
          </div>
          <div className="studio-page-inspector">
            <h3>Page {selectedPage}</h3>
            {page && (
              <label className="studio-check">
                <input
                  type="checkbox"
                  checked={!!page.locked}
                  onChange={(e) =>
                    change((s) => ({
                      ...s,
                      pages: s.pages.map((p) =>
                        p.id === page.id
                          ? { ...p, locked: e.target.checked }
                          : p,
                      ),
                    }))
                  }
                />{" "}
                Keep this page layout
              </label>
            )}
            <div className="studio-reserve-actions">
              <button
                className="btn btn-secondary"
                onClick={() => addReservation("booked-ad", "quarter")}
              >
                <Plus size={13} /> Quarter-page ad
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => addReservation("booked-ad", "bottom")}
              >
                Bottom ad
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => addReservation("booked-ad", "side")}
              >
                Side ad
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => addReservation("booked-ad", "full")}
              >
                Full-page ad
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => addReservation("editorial", "quarter")}
              >
                Fixed feature
              </button>
            </div>
            {reserved.map((reservation) => (
              <div className="studio-reservation" key={reservation.id}>
                <div>
                  <strong>
                    {reservation.kind === "booked-ad"
                      ? "Booked advertisement"
                      : reservation.kind === "house-ad"
                        ? "House advertisement"
                        : "Fixed editorial space"}
                  </strong>
                  <button
                    aria-label="Remove reservation"
                    disabled={reservation.locked}
                    className="btn btn-ghost"
                    onClick={() =>
                      change((s) => ({
                        ...s,
                        reservations: s.reservations.filter(
                          (r) => r.id !== reservation.id,
                        ),
                      }))
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="studio-rect">
                  {["X", "Y", "Width", "Height"].map((label, index) => (
                    <label key={label}>
                      {label}
                      <input
                        aria-label={`Reservation ${label}`}
                        type="number"
                        disabled={reservation.locked}
                        min={index < 2 ? 0 : 1}
                        value={reservation.rect[index]}
                        onChange={(e) => {
                          const rect = [
                            ...reservation.rect,
                          ] as IssueStudioReservation["rect"];
                          rect[index] = Number(e.target.value);
                          updateReservation(reservation.id, { rect });
                        }}
                      />
                    </label>
                  ))}
                </div>
                <label className="studio-artwork-upload">
                  Upload artwork
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.pdf"
                    onChange={(event) => {
                      void uploadReservationArtwork(
                        reservation.id,
                        event.target.files?.[0],
                      );
                      event.target.value = "";
                    }}
                  />
                </label>
                <p className="studio-muted">
                  {reservation.artworkPath ? (
                    <>
                      Artwork received ·{" "}
                      <a
                        href={`/api/files/${reservation.artworkPath.split("/").map(encodeURIComponent).join("/")}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View original artwork
                      </a>
                    </>
                  ) : (
                    "Awaiting artwork"
                  )}
                </p>
                <label className="studio-check">
                  <input
                    type="checkbox"
                    checked={!!reservation.locked}
                    onChange={(e) =>
                      updateReservation(reservation.id, {
                        locked: e.target.checked,
                      })
                    }
                  />{" "}
                  Keep position
                </label>
              </div>
            ))}
            {!reserved.length && (
              <p className="studio-muted">
                Reserve space before artwork arrives. Dimensions are in points;
                booked ads block final release until resolved.
              </p>
            )}
          </div>
        </section>
        <aside className="studio-panel studio-inspector">
          <h2>{article ? "Story choices" : "Print choices"}</h2>
          {article && placement ? (
            <>
              <h3>{article.title}</h3>
              <p className="studio-muted">
                {
                  (article.content || "").trim().split(/\s+/).filter(Boolean)
                    .length
                }{" "}
                words · {article.displayAuthor}
              </p>
              <label className="studio-check">
                <input
                  type="checkbox"
                  disabled={
                    designerOpen ||
                    !!placement.locked ||
                    placement.pageIds.some(
                      (id) => state.pages.find((p) => p.id === id)?.locked,
                    )
                  }
                  checked={placement.included !== false}
                  onChange={(e) =>
                    updatePlacement(article.id, { included: e.target.checked })
                  }
                />{" "}
                Include in this layout
              </label>
              <label className="studio-check">
                <input
                  type="checkbox"
                  checked={!!placement.locked}
                  onChange={(e) =>
                    updatePlacement(article.id, { locked: e.target.checked })
                  }
                />{" "}
                Keep story placement
              </label>
              <label className="studio-story-rule">
                Planning priority
                <select
                  disabled={!!placement.locked}
                  value={
                    typeof placement.priority === "number"
                      ? placement.priority
                      : 0
                  }
                  onChange={(event) =>
                    updatePlacement(article.id, {
                      priority: Number(event.target.value),
                    })
                  }
                >
                  <option value={-1}>Low</option>
                  <option value={0}>Normal</option>
                  <option value={1}>High</option>
                </select>
              </label>
              <label className="studio-story-rule">
                Allowed page numbers
                <input
                  disabled={!!placement.locked}
                  placeholder="Any page, or e.g. 2, 3, 4"
                  value={allowedPageDraft}
                  aria-invalid={!!pageRuleError}
                  onChange={(event) => {
                    const text = event.target.value;
                    setAllowedPageDraft(text);
                    const pages = text.trim()
                      ? text.split(",").map((value) => Number(value.trim()))
                      : [];
                    if (
                      pages.some(
                        (value) =>
                          !Number.isInteger(value) ||
                          value < 1 ||
                          value > state.pageBudget,
                      ) ||
                      new Set(pages).size !== pages.length
                    ) {
                      setPageRuleError(
                        `Use distinct page numbers from 1 to ${state.pageBudget}.`,
                      );
                      return;
                    }
                    setPageRuleError("");
                    updatePlacement(article.id, { allowedPages: pages });
                  }}
                />
              </label>
              {pageRuleError && (
                <p className="studio-stale" role="alert">
                  {pageRuleError}
                </p>
              )}
              {placement.stale && (
                <div className="studio-stale">
                  The source changed after this placement was recorded.
                  <button
                    className="btn btn-secondary"
                    disabled={!!placement.locked}
                    onClick={() =>
                      updatePlacement(article.id, {
                        sourceRevision: placement.currentSourceRevision,
                        stale: false,
                      })
                    }
                  >
                    Use current source
                  </button>
                </div>
              )}
              <h3>Print images</h3>
              <p className="studio-muted">
                Choices here belong to this issue layout. Close the designer to
                change images, captions, or credits.
              </p>
              {images.map((image) => {
                const choice = imageChoices.find(
                  (c) => c.attachmentId === image.id,
                );
                return (
                  <div className="studio-image" key={image.id}>
                    <label className="studio-check">
                      <input
                        type="checkbox"
                        disabled={designerOpen || !!placement.locked}
                        checked={!!choice}
                        onChange={(e) =>
                          updatePlacement(article.id, {
                            imageChoices: e.target.checked
                              ? [
                                  ...imageChoices,
                                  {
                                    attachmentId: image.id,
                                    caption: image.caption || "",
                                  },
                                ]
                              : imageChoices.filter(
                                  (c) => c.attachmentId !== image.id,
                                ),
                          })
                        }
                      />
                      {image.originalFileName}
                    </label>
                    {choice && (
                      <>
                        <label>
                          Print caption
                          <textarea
                            rows={2}
                            disabled={designerOpen || !!placement.locked}
                            value={choice.caption ?? image.caption ?? ""}
                            onChange={(e) =>
                              updatePlacement(article.id, {
                                imageChoices: imageChoices.map((c) =>
                                  c.attachmentId === image.id
                                    ? { ...c, caption: e.target.value }
                                    : c,
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          Credit
                          <input
                            disabled={designerOpen || !!placement.locked}
                            value={choice.credit ?? ""}
                            onChange={(e) =>
                              updatePlacement(article.id, {
                                imageChoices: imageChoices.map((c) =>
                                  c.attachmentId === image.id
                                    ? { ...c, credit: e.target.value }
                                    : c,
                                ),
                              })
                            }
                          />
                        </label>
                      </>
                    )}
                  </div>
                );
              })}
              {!images.length && (
                <p className="studio-muted">
                  No photographs or graphics attached.
                </p>
              )}
            </>
          ) : (
            <p className="studio-empty">
              Select a story to choose its print images and preserve its
              editorial decisions.
            </p>
          )}
          <div className="studio-history">
            <h3>Saved history</h3>
            <p className="studio-muted">
              {view.revisions.length} recorded revision
              {view.revisions.length === 1 ? "" : "s"}. Generated output and
              Adobe verification are separate checks.
            </p>
            <label className="studio-artwork-upload">
              Attach saved manual document
              <input
                type="file"
                accept=".designcraft,.idml,.indd,.indt"
                onChange={(event) => {
                  void attachNativeFork(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            <details className="studio-adobe">
              <summary>Record Adobe validation</summary>
              <p className="studio-muted">
                Choose the report from Adobe and the printer’s profile. The
                checks must identify the exact composition and uploaded native
                document.
              </p>
              <label>
                Completed composition
                <select
                  value={adobeJobId}
                  onChange={(event) => setAdobeJobId(event.target.value)}
                >
                  <option value="">Choose composition…</option>
                  {activeJobs
                    .filter((job) => job.status === "completed")
                    .map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.id.slice(-24)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Saved Adobe document
                <select
                  value={adobeNativePath}
                  onChange={(event) => setAdobeNativePath(event.target.value)}
                >
                  <option value="">
                    Attach an INDD / INDT document first…
                  </option>
                  {activeJobs
                    .filter(
                      (job) =>
                        job.kind === "native-fork" &&
                        /\.(indd|indt)$/i.test(job.fork?.path || ""),
                    )
                    .map((job) => (
                      <option key={job.id} value={job.fork?.path}>
                        {job.fork?.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Adobe report JSON
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) =>
                    setAdobeReport(event.target.files?.[0] || null)
                  }
                />
              </label>
              <label>
                Print profile JSON
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) =>
                    setPrintProfile(event.target.files?.[0] || null)
                  }
                />
              </label>
              <button
                className="btn btn-secondary"
                disabled={busy || dirty}
                onClick={() => void recordAdobeReport()}
              >
                Record validation
              </button>
            </details>
            {activeJobs.slice(0, 8).map((job) => (
              <div className="studio-job" key={job.id}>
                <strong>
                  {job.kind === "native-fork"
                    ? `Manual document · ${job.fork?.status || job.status}`
                    : `Composition: ${job.status}`}
                </strong>
                {job.diagnostics?.message && <p>{job.diagnostics.message}</p>}
                {job.artifacts?.map((artifact) => (
                  <a
                    key={artifact.path}
                    href={`/api/files/${artifact.path.split("/").map(encodeURIComponent).join("/")}`}
                    download={artifact.name}
                  >
                    {artifact.name}
                  </a>
                ))}
                {job.fork && (
                  <>
                    <a
                      href={`/api/files/${job.fork.path.split("/").map(encodeURIComponent).join("/")}`}
                      download={job.fork.name}
                    >
                      {job.fork.name || "Saved document"}
                    </a>
                    {job.fork.status === "active" && (
                      <button
                        className="btn btn-secondary"
                        disabled={busy || dirty}
                        onClick={() => void archiveFork(job.id)}
                      >
                        Archive reconciled fork
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </aside>
      </fieldset>
      <div className="studio-compose-bar">
        <div>
          <label className="studio-muted">
            Printer profile JSON (optional for a draft)
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) =>
                setPrintProfile(event.target.files?.[0] || null)
              }
            />
          </label>
          {printProfile && (
            <p className="studio-muted">Selected: {printProfile.name}</p>
          )}
          <p className="studio-muted">
            Generate recorded output from the saved source and plan revision.
          </p>
        </div>
        <button
          className="btn btn-primary"
          disabled={busy || !state.pages.length || !!pageRuleError}
          onClick={() => void composeSavedRevision()}
        >
          {composing ? "Composing saved revision…" : "Compose saved revision"}
        </button>
      </div>
      <section className="studio-designer" inert={busy}>
        <div className="studio-panel-heading">
          <div>
            <h2>Design & compose</h2>
            <p className="studio-muted">
              Save issue settings before opening the designer. Save again after
              changing layouts.
            </p>
          </div>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              if (dirty && !(await save())) return;
              setDesignerOpen((value) => !value);
            }}
          >
            {designerOpen ? "Close designer" : "Open designer"}
          </button>
        </div>
        {designerOpen && (
          <>
            <p className="studio-editor-note">
              Native editor changes are a document fork: save the document from
              the editor’s File menu. Recipe regeneration does not include those
              freeform edits.
            </p>
            <DesignCraftWorkspace
              key={`${issueId}-${session}`}
              studio={{
                issueId,
                state,
                onPlannerState: plannerChanged,
                onRegisterSnapshot: registerSnapshot,
              }}
            />
          </>
        )}
      </section>
    </div>
  );
}
