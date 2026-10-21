import JSZip from "jszip";
import markdownit from "markdown-it";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { query, mutate } from "./convex";
import { getStorage } from "../storage";
import { designcraftStaticDir, wasmCompiler } from "./designcraft-wasm";
import { validateFilePath } from "../shared/file-path";
import type { IssueStudioState } from "../shared/issue-studio";
import type { CheckedComposition } from "../shared/issue-studio-production";
import type { StorageProvider } from "../storage/types";

type Json = Record<string, any>;
type Artifact = {
  name: string;
  path: string;
  sha256: string;
  mimeType: string;
  bytes: number;
};
type Backend = {
  read(operation: string, data: Json): Promise<any>;
  write(operation: string, data: Json): Promise<any>;
};
type Dependencies = {
  backend?: Backend;
  storage?: Pick<StorageProvider, "getFile" | "saveFile">;
  staticDir?: string;
  compiler?: any;
};
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => JSON.stringify(value);
const segment = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
function diagnosticSummary(
  manifest: Json | null | undefined,
  preflight: Json | null | undefined,
  message: string,
) {
  const text = (value: unknown, limit = 1000) =>
    typeof value === "string" ? value.slice(0, limit) : undefined;
  return {
    message: message.slice(0, 4000),
    manifest: manifest
      ? {
          schemaVersion: text(manifest.schemaVersion),
          status: text(manifest.status),
          cliVersion: text(manifest.cliVersion),
          failedPageNumber: manifest.failedPageNumber ?? null,
          failedPageId: text(manifest.failedPageId),
          sourceMarkdownPreserved: manifest.sourceMarkdownPreserved === true,
        }
      : null,
    preflight: preflight
      ? {
          errors: Number(preflight.errors) || 0,
          warnings: Number(preflight.warnings) || 0,
          issues: Array.isArray(preflight.issues)
            ? preflight.issues.slice(0, 20).map((issue: Json) => ({
                kind: text(issue.kind),
                severity: text(issue.severity),
                message: text(issue.message),
                pageNumber: Number.isSafeInteger(issue.pageNumber)
                  ? issue.pageNumber
                  : null,
                pageId: text(issue.pageId),
              }))
            : [],
          truncated:
            Array.isArray(preflight.issues) && preflight.issues.length > 20,
        }
      : null,
  };
}

const defaultBackend: Backend = {
  read: (operation, data) => (query as any)(operation, data),
  write: (operation, data) => (mutate as any)(operation, data),
};

/** Compose only a server-recorded immutable revision. The browser cannot supply executable recipes. */
export async function composeSavedIssue(
  request: {
    issueId: string;
    expectedRevision: number;
    idempotencyKey: string;
    profile?: unknown;
  },
  dependencies: Dependencies = {},
) {
  if (
    !/^[a-zA-Z0-9_-]{1,100}$/.test(request.issueId) ||
    !Number.isSafeInteger(request.expectedRevision)
  )
    throw Error("Invalid issue composition request");
  const backend = dependencies.backend ?? defaultBackend,
    storage = dependencies.storage ?? getStorage();
  const queued = await backend.write("requestIssueComposition", request);
  const jobId = queued.job.id;
  const recorded = await backend.read("getIssueCompositionJob", {
    issueId: request.issueId,
    jobId,
  });
  if (recorded.job.status !== "queued")
    return { success: true, job: publicJob(recorded.job) };
  const workerId = randomUUID();
  // Compare-and-set is persistent: concurrent API retries cannot both consume the same job.
  try {
    await backend.write("transitionIssueComposition", {
      issueId: request.issueId,
      jobId,
      expectedStatus: "queued",
      status: "running",
      workerId,
    });
  } catch (error) {
    // Another request may have claimed the same idempotent job between read and claim.
    const current = await backend.read("getIssueCompositionJob", {
      issueId: request.issueId,
      jobId,
    });
    if (current.job.status !== "queued")
      return { success: true, job: publicJob(current.job) };
    throw error;
  }
  const input: Json = recorded.job.input;
  const artifacts: Artifact[] = [];
  const outputPrefix = `issue-studio/${request.issueId}/compositions/${hash(jobId)}`;
  let inputSha256 = hash(json(input));
  let outputBytes = 0;
  async function save(
    name: string,
    bytes: Uint8Array | string,
    mimeType: string,
  ) {
    const buffer = Buffer.from(bytes);
    outputBytes += buffer.length;
    if (outputBytes > 256 * 1024 * 1024)
      throw Error("Composition artifacts exceed the 256 MB issue limit");
    const sha256 = hash(buffer),
      path = `${outputPrefix}/${sha256}-${name}`;
    await storage.saveFile(path, buffer);
    artifacts.push({ name, path, sha256, mimeType, bytes: buffer.length });
  }
  try {
    await save("saved-input.json", json(input), "application/json");
    const state = structuredClone(input.state) as IssueStudioState;
    if (
      !state ||
      !Array.isArray(state.pages) ||
      !Array.isArray(state.placements)
    )
      throw Error("Saved composition input is incomplete");
    if (state.pages.length !== state.pageBudget)
      throw Error(
        "Save exactly the fixed page budget before composing the whole issue",
      );
    for (const placement of state.placements)
      if (
        placement.included !== false &&
        (placement.stale ||
          placement.sourceRevision !== placement.currentSourceRevision)
      )
        throw Error(
          `Article ${placement.articleId} changed. Explicitly accept its current source revision before composition.`,
        );
    const staticDir =
      dependencies.staticDir ?? (await designcraftStaticDir(process.cwd()));
    if (!staticDir)
      throw Error("The packaged DesignCraft WebAssembly engine is unavailable");
    const compiler = dependencies.compiler ?? (await wasmCompiler(staticDir));
    const library = JSON.parse(
      await readFile(join(staticDir, "templates.json"), "utf8"),
    );
    const recipe: Json = state.plannerState ?? {};
    const savedPages: Json[] = recipe.savedPages ?? [];
    if (savedPages.length !== state.pages.length)
      throw Error("Every saved issue page needs an editable planner recipe");
    const templates: Json[] = [],
      resources = new Map<string, Uint8Array>();
    const resourceHashes: Record<string, string> = {};
    let mediaBytes = 0;
    function retainResource(key: string, data: Uint8Array) {
      if (data.length > 32 * 1024 * 1024)
        throw Error("A composition image or artwork exceeds 32 MB");
      mediaBytes += data.length;
      if (mediaBytes > 128 * 1024 * 1024)
        throw Error(
          "Selected composition media exceeds the 128 MB issue limit",
        );
      resources.set(key, data);
      resourceHashes[key] = hash(data);
    }
    const readResource = async (root: string, path: string) => {
      validateFilePath(path);
      const key = root + ":" + path;
      if (resources.has(key)) return resources.get(key)!;
      const assetRef = recipe.assetRefs?.[path];
      let data: Uint8Array | null = null;
      if (assetRef) {
        if (
          typeof assetRef !== "string" ||
          !assetRef.startsWith(`issue-studio/${request.issueId}/`)
        )
          throw Error("Artwork belongs to a different issue");
        data = await storage.getFile(validateFilePath(assetRef));
      } else if (
        root === "library" ||
        [
          "assets/source-cover-photo.jpeg",
          "assets/ote-horizontal-logo.png",
          "assets/ote-stacked-logo.pdf",
          "assets/ote-stacked-logo.png",
        ].includes(path)
      ) {
        if (!/^(assets|original-art)\//.test(path))
          throw Error("Library resource is outside packaged artwork");
        const file = resolve(staticDir, path);
        if (!file.startsWith(resolve(staticDir) + "/"))
          throw Error("Invalid library resource path");
        data = new Uint8Array(await readFile(file));
      }
      if (!data?.length) throw Error("Saved media is unavailable: " + path);
      retainResource(key, data);
      return data;
    };
    for (const page of state.pages) {
      const saved = savedPages.find((p) => p.id === page.id);
      if (
        !saved?.template?.slots ||
        saved.pageNumber !== page.pageNumber ||
        saved.mode === "preserve"
      )
        throw Error(
          "Saved page recipe is missing or requires an existing native document: " +
            page.id,
        );
      const template = structuredClone(saved.template);
      template.id = `saved-${page.id}`;
      for (const reservation of state.reservations.filter(
        (r) => r.pageNumber === page.pageNumber,
      )) {
        const slot = template.slots.find(
          (s: Json) => s.id === `studio-reservation-${reservation.id}`,
        );
        const [x, y, width, height] = reservation.rect;
        if (!slot || json(slot.rect) !== json([x, y, x + width, y + height]))
          throw Error(
            `Reservation ${reservation.id} changed. Open and save the affected planner page before composition.`,
          );
        if (reservation.artworkPath) {
          const asset = `assets/user-reservation-${reservation.id}.${reservation.artworkPath.split(".").pop()}`;
          recipe.assetRefs ??= {};
          recipe.assetRefs[asset] = reservation.artworkPath;
          slot.asset = asset;
          slot.fit = "contain";
        } else {
          delete slot.asset;
        }
      }
      templates.push(template);
    }
    if (templates.reduce((n, t) => n + t.slots.length, 0) > 10000)
      throw Error("Composition has too many frames");
    library.templates = templates;
    const bundle: Json = recipe.issueBundle ?? {};
    const issue: Json = {
      schemaVersion: "ote.designcraft.issue.v1",
      issue: {
        ...(bundle.issue ?? {}),
        id: request.issueId,
        ...(input.issue
          ? { title: input.issue.title ?? "", number: input.issue.issueNumber }
          : {}),
        ...(input.volume ? { volume: input.volume.volumeNumber } : {}),
      },
      articles: [],
      layoutPlan: {
        ...(bundle.layoutPlan ?? {}),
        pages: state.pages.map((page) => {
          const saved = savedPages.find((p) => p.id === page.id)!;
          return {
            id: page.id,
            pageNumber: page.pageNumber,
            templateId: `saved-${page.id}`,
            kind: saved.template.kind,
            articleIds: saved.articleIds ?? [],
            mode: "replace",
          };
        }),
        cover: { ...(bundle.layoutPlan?.cover ?? {}), mode: "editable" },
        truck: { ...(bundle.layoutPlan?.truck ?? {}), mode: "editable" },
      },
    };
    // Only a saved cover owns featured references. The editor's unsaved cover
    // selection may still contain defaults while planning an interior-only issue.
    issue.layoutPlan.cover.articleIds =
      issue.layoutPlan.pages.find((page: Json) => page.kind === "cover")
        ?.articleIds ?? [];
    // Publication metadata comes from the immutable job snapshot, including
    // field-bound covers and interior datelines. Planner text cannot retain an old issue date.
    const releaseDate = input.issue?.releaseDate
      ? new Date(input.issue.releaseDate)
      : null;
    if (releaseDate && !Number.isFinite(releaseDate.getTime()))
      throw Error("Saved issue release date is invalid");
    const publicationFields: Json = {
      ...(input.volume
        ? {
            volume: input.volume.volumeNumber,
            ...(input.volume.year ? { year: input.volume.year } : {}),
          }
        : {}),
      ...(input.issue ? { number: input.issue.issueNumber } : {}),
      ...(releaseDate
        ? {
            date: releaseDate.toISOString().slice(0, 10),
            year: releaseDate.getUTCFullYear(),
          }
        : {}),
    };
    Object.assign(issue.issue, publicationFields);
    Object.assign(issue.layoutPlan.cover, publicationFields);
    const allSources: Json[] = input.sources ?? [];
    for (const placement of state.placements.filter(
      (p) => p.included !== false,
    )) {
      const source = allSources.find((s) => s.id === placement.articleId);
      if (!source || source.sourceRevision !== placement.sourceRevision)
        throw Error(
          "Source acceptance does not match saved article " +
            placement.articleId,
        );
      const choices = placement.imageChoices;
      const selected = choices
        ? choices
            .map((c: any) =>
              source.attachments.find(
                (a: Json) =>
                  a.id === (typeof c === "string" ? c : c.attachmentId),
              ),
            )
            .filter(Boolean)
        : source.attachments
            .filter(
              (a: Json) =>
                ["photo", "graphic"].includes(a.attachmentType) &&
                a.includeInExport !== false,
            )
            .sort(
              (a: Json, b: Json) =>
                (a.photoNumber ?? Number.MAX_SAFE_INTEGER) -
                  (b.photoNumber ?? Number.MAX_SAFE_INTEGER) ||
                a.id.localeCompare(b.id),
            );
      const photos = [];
      for (const attachment of selected) {
        const extension =
          /\.([a-zA-Z0-9]{1,10})$/
            .exec(attachment.originalFileName)?.[1]
            ?.toLowerCase() ?? "bin";
        const path = `media/${segment(source.id)}/${segment(attachment.id)}.${extension}`;
        if (attachment.fileSize > 32 * 1024 * 1024)
          throw Error("An article image exceeds the 32 MB composition limit");
        const data = await storage.getFile(
          validateFilePath(attachment.filePath),
        );
        if (
          !data?.length ||
          (attachment.fileSize !== null && attachment.fileSize !== data.length)
        )
          throw Error(
            "Original article image is unavailable or incomplete: " +
              attachment.id,
          );
        retainResource("issue:" + path, data);
        const choice = (choices ?? []).find(
          (c: any) => typeof c !== "string" && c.attachmentId === attachment.id,
        ) as Json | undefined;
        const override = (recipe.mediaOverrides ?? []).find(
          (p: Json) =>
            p.articleId === source.id &&
            (p.photoId === attachment.id || p.path === path),
        );
        photos.push({
          id: attachment.id,
          path,
          caption: [
            choice?.caption ?? attachment.caption ?? "",
            choice?.credit ? `Credit: ${choice.credit}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
          photoNumber: attachment.photoNumber,
          mimeType: attachment.mimeType,
          ...(override?.focus ? { focus: override.focus } : {}),
          ...(override?.fit ? { fit: override.fit } : {}),
          ...(override?.zoom ? { zoom: override.zoom } : {}),
          ...(choice?.focus ? { focus: choice.focus } : {}),
          ...(choice?.fit ? { fit: choice.fit } : {}),
        });
      }
      issue.articles.push({
        id: source.id,
        title: placement.printHeadline || source.title,
        body: source.content ?? "",
        author: source.displayAuthor,
        photos,
      });
    }
    const allFonts = await Promise.all(
      (await readdir(join(staticDir, "assets/fonts")))
        .filter((name) => /\.(ttf|otf|ttc|otc|txt)$/i.test(name))
        .map(async (name) => ({
          name,
          bytes: new Uint8Array(
            await readFile(join(staticDir, "assets/fonts", name)),
          ),
        })),
    );
    const fontProfile = bundle.layoutPlan?.fontProfile ?? "portable";
    // These are exact bundled fonts; absent proprietary faces use the compiler's recorded portable mappings.
    if (fontProfile !== "portable")
      throw Error(
        "Saved-revision composition currently requires the bundled portable font profile",
      );
    const fonts = compiler.pages.documentFonts(
      allFonts,
      fontProfile,
      compiler.pages.usesDesigns(library),
    );
    const fontsSha256 = hash(json(await compiler.pages.fontScope(fonts)));
    const executor = compiler.executors.wasmExecutor(compiler.Engine);
    // Materialize every dependency before hashing/engine work, including design layers and custom assets.
    for (const template of templates) {
      const art = library.designs?.[template.design]?.art;
      if (art)
        for (const layer of Object.values(art) as Json[])
          for (const part of [layer, layer.over].filter(Boolean))
            if (part.portable) await readResource("library", part.portable);
      for (const slot of template.slots)
        if (slot.asset)
          await readResource(
            slot.assetRoot === "issue" ? "issue" : "library",
            slot.asset,
          );
    }
    const sourceSha256 = hash(
      json({ issue: issue.issue, articles: issue.articles }),
    );
    const templateSha256 = hash(json(library));
    const mediaSha256 = hash(
      json(
        Object.fromEntries(
          Object.entries(resourceHashes).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    );
    const engineManifest = JSON.parse(
      await readFile(join(staticDir, "headless/manifest.json"), "utf8"),
    );
    const compilerSources = Object.fromEntries(
      await Promise.all(
        (await readdir(join(staticDir, "compiler")))
          .filter((name) => name.endsWith(".js"))
          .sort()
          .map(async (name) => [
            name,
            hash(await readFile(join(staticDir, "compiler", name))),
          ]),
      ),
    );
    const engineVersion = `${compiler.version}; upstream=${engineManifest.upstream.rev}; wasmSha256=${engineManifest.wasm.sha256}; compilerSha256=${hash(json(compilerSources))}`;
    const provenance = {
      sourceSha256,
      templateSha256,
      mediaSha256,
      fontsSha256,
      printProfileSha256: hash(json(input.profile ?? null)),
      engineVersion,
    };
    inputSha256 = hash(
      json({
        revision: input.revision,
        provenance,
        savedInputSha256: hash(json(input)),
      }),
    );
    await save(
      "composition-input.json",
      json({ inputSha256, provenance, issue, library }),
      "application/json",
    );
    let built: Json;
    try {
      built = await compiler.issues.compileIssue({
        library,
        issue,
        executor,
        markdownit,
        JSZip,
        fonts,
        fontProfile,
        loadMedia: ({ root, path }: Json) => readResource(root, path),
        fitCoverTitles: false,
      });
    } catch (error: any) {
      const draft = error?.artifacts ?? {};
      if (draft.native)
        await save(
          "draft.designcraft",
          draft.native,
          "application/octet-stream",
        );
      for (const page of draft.pages ?? [])
        if (page.artifacts?.native)
          await save(
            `draft-page-${page.pageNumber}.designcraft`,
            page.artifacts.native,
            "application/octet-stream",
          );
      if (draft.preflight)
        await save("preflight.json", json(draft.preflight), "application/json");
      if (draft.manifest)
        await save(
          "build-manifest.json",
          json(draft.manifest),
          "application/json",
        );
      throw Object.assign(
        error instanceof Error ? error : Error(String(error)),
        { diagnosticArtifacts: draft },
      );
    }
    const result = built.artifacts,
      manifest = built.manifest;
    if (
      !result.native ||
      !result.pdf ||
      !result.idml ||
      result.preflight?.errors !== 0 ||
      manifest.sourceMarkdownPreserved !== true ||
      !manifest.articleBodyChecks ||
      !Object.values(manifest.articleBodyChecks).every(Boolean)
    )
      throw Error("Compiler did not return a complete checked issue");
    await save("issue.designcraft", result.native, "application/octet-stream");
    await save("proof.pdf", result.pdf, "application/pdf");
    await save(
      "issue.idml",
      result.idml,
      "application/vnd.adobe.indesign-idml-package",
    );
    await save("preflight.json", json(result.preflight), "application/json");
    await save("build-manifest.json", json(manifest), "application/json");
    const fontZip = new JSZip();
    for (const font of fonts) fontZip.file(font.name, font.bytes);
    await save(
      "document-fonts.zip",
      await fontZip.generateAsync({
        type: "uint8array",
        compression: "DEFLATE",
      }),
      "application/zip",
    );
    const composition: CheckedComposition = {
      revision: input.revision,
      inputSha256,
      status: "completed",
      provenance,
      artifactSha256: hash(result.idml),
      errors: 0,
      copyPreserved: true,
    };
    const completed = await backend.write("transitionIssueComposition", {
      issueId: request.issueId,
      jobId,
      expectedStatus: "running",
      status: "completed",
      workerId,
      result: {
        composition,
        artifacts,
        diagnostics: diagnosticSummary(
          manifest,
          result.preflight,
          "DesignCraft checked. PDF is a proof; Adobe and printer validation remain required. Full diagnostics are stored as immutable artifacts.",
        ),
      },
    });
    return { success: true, job: publicJob(completed.job) };
  } catch (error: any) {
    const diagnostics = diagnosticSummary(
      error?.diagnosticArtifacts?.manifest,
      error?.diagnosticArtifacts?.preflight,
      error instanceof Error ? error.message : String(error),
    );
    const failed = await backend.write("transitionIssueComposition", {
      issueId: request.issueId,
      jobId,
      expectedStatus: "running",
      status: "failed",
      workerId,
      result: { artifacts, diagnostics, inputSha256 },
    });
    return { success: true, job: publicJob(failed.job) };
  }
}
function publicJob(job: Json) {
  const stored = typeof job.data === "string" ? JSON.parse(job.data) : job;
  const result = stored.result ?? job.result ?? {};
  return {
    id: job.id,
    status: job.status,
    inputRevision: job.inputRevision,
    artifacts: result.artifacts ?? [],
    diagnostics: result.diagnostics ?? null,
    composition: result.composition ?? null,
  };
}

export async function handleIssueStudioCompose(
  request: Request,
  issueId: string,
) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 4096)
      return Response.json(
        { error: "Composition request is too large" },
        { status: 413 },
      );
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 4096)
      return Response.json(
        { error: "Composition request is too large" },
        { status: 413 },
      );
    const data = JSON.parse(text);
    return Response.json(
      await composeSavedIssue({
        issueId,
        expectedRevision: data.expectedRevision,
        idempotencyKey: data.idempotencyKey,
        ...(data.profile ? { profile: data.profile } : {}),
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Issue composition failed",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
