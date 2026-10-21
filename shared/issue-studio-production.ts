import type { IssueStudioState } from "./issue-studio";

/** Every digest identifies bytes or canonical JSON, never an updatedAt timestamp. */
export interface CompositionProvenance {
  sourceSha256: string;
  mediaSha256: string;
  templateSha256: string;
  fontsSha256: string;
  printProfileSha256: string;
  engineVersion: string;
}
export interface CheckedComposition {
  revision: number;
  inputSha256: string;
  status: "queued" | "running" | "failed" | "completed";
  provenance: CompositionProvenance;
  artifactSha256?: string;
  errors?: number;
  copyPreserved?: boolean;
}
export interface AdobeValidationReport {
  schemaVersion: "ote.adobe-validation.v1";
  inputSha256: string;
  artifactSha256: string;
  nativeSha256: string;
  checkedAt: string;
  application: { name: "Adobe InDesign"; version: string; platform: string };
  checks: {
    missingFonts: string[];
    invalidLinks: string[];
    oversetStories: string[];
    lowResolutionImages: string[];
    minImagePpi: number;
    pageCount: number;
    pageWidthPoints: number;
    pageHeightPoints: number;
    bleedPoints: [number, number, number, number];
    preflightProfile: string;
    preflightErrors: number;
    colorProfile: string;
  };
  outputs: { native: string; proof?: string };
}
export interface IssuePrintProfile {
  pageWidthPoints: number;
  pageHeightPoints: number;
  bleedPoints: [number, number, number, number];
  pageMultiple: number;
  preflightProfile: string;
  colorProfile: string;
  minImagePpi: number;
}
export interface NativeDocumentFork {
  id: string;
  sourceRevision: number;
  artifactSha256: string;
  status: "active" | "archived";
}
export interface ReleaseCheck {
  code: string;
  message: string;
}
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const nonnegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const boundedText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 4096;
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 10000 && value.every(boundedText);

/** Imported reports are operator evidence. This validates structure and byte identity, not a signature. */
export function validateAdobeReport(value: unknown): AdobeValidationReport {
  const r = value as AdobeValidationReport | undefined;
  if (
    !r ||
    r.schemaVersion !== "ote.adobe-validation.v1" ||
    !digest(r.inputSha256) ||
    !digest(r.artifactSha256) ||
    !digest(r.nativeSha256) ||
    !boundedText(r.checkedAt) ||
    !Number.isFinite(Date.parse(r.checkedAt)) ||
    r.application?.name !== "Adobe InDesign" ||
    !boundedText(r.application.version) ||
    !boundedText(r.application.platform) ||
    !r.checks ||
    !r.outputs ||
    !boundedText(r.outputs.native) ||
    (r.outputs.proof !== undefined && !boundedText(r.outputs.proof))
  )
    throw new Error("Invalid Adobe validation report identity");
  const c = r.checks;
  if (
    !strings(c.missingFonts) ||
    !strings(c.invalidLinks) ||
    !strings(c.oversetStories) ||
    !strings(c.lowResolutionImages) ||
    !finite(c.minImagePpi) ||
    c.minImagePpi <= 0 ||
    !nonnegativeInteger(c.pageCount) ||
    c.pageCount < 1 ||
    !finite(c.pageWidthPoints) ||
    c.pageWidthPoints <= 0 ||
    !finite(c.pageHeightPoints) ||
    c.pageHeightPoints <= 0 ||
    !Array.isArray(c.bleedPoints) ||
    c.bleedPoints.length !== 4 ||
    !c.bleedPoints.every((n) => finite(n) && n >= 0) ||
    !boundedText(c.preflightProfile) ||
    !nonnegativeInteger(c.preflightErrors) ||
    !boundedText(c.colorProfile)
  )
    throw new Error("Invalid Adobe validation report checks");
  // Return a copy so subsequent caller mutation cannot silently alter recorded evidence.
  return JSON.parse(JSON.stringify(r));
}

export function compositionHasProvenance(
  composition: CheckedComposition,
): boolean {
  const p = composition.provenance;
  return (
    !!p &&
    digest(composition.inputSha256) &&
    digest(composition.artifactSha256) &&
    digest(p.sourceSha256) &&
    digest(p.mediaSha256) &&
    digest(p.templateSha256) &&
    digest(p.fontsSha256) &&
    digest(p.printProfileSha256) &&
    boundedText(p.engineVersion)
  );
}

/** A composed preview never becomes an Adobe check merely because it succeeded. */
export function issueVerificationLevel(input: {
  revision: number;
  composition?: CheckedComposition | null;
  adobe?: unknown;
}): "Estimated" | "DesignCraft checked" | "Adobe verified" | "Stale" {
  const c = input.composition;
  if (!c) return "Estimated";
  if (c.revision !== input.revision) return "Stale";
  if (
    c.status !== "completed" ||
    c.errors !== 0 ||
    !c.copyPreserved ||
    !compositionHasProvenance(c)
  )
    return "Estimated";
  if (input.adobe) {
    try {
      const a = validateAdobeReport(input.adobe);
      if (
        a.inputSha256 === c.inputSha256 &&
        a.artifactSha256 === c.artifactSha256 &&
        a.checks.preflightErrors === 0 &&
        !a.checks.missingFonts.length &&
        !a.checks.invalidLinks.length &&
        !a.checks.oversetStories.length &&
        !a.checks.lowResolutionImages.length
      )
        return "Adobe verified";
    } catch {
      /* Malformed evidence cannot elevate the current check. */
    }
  }
  return "DesignCraft checked";
}

/** Final release is stricter than draft export. No output or draft is deleted by this guard. */
export function evaluateIssueRelease(input: {
  state: IssueStudioState;
  revision: number;
  composition?: CheckedComposition | null;
  adobe?: unknown;
  nativeForks?: NativeDocumentFork[];
  printProfile?: IssuePrintProfile | null;
}): {
  ready: boolean;
  level: ReturnType<typeof issueVerificationLevel>;
  blockers: ReleaseCheck[];
} {
  const blockers: ReleaseCheck[] = [];
  const block = (code: string, message: string) =>
    blockers.push({ code, message });
  const { state, composition: c, printProfile: profile } = input;
  for (const ad of state.reservations)
    if (
      ad.kind === "booked-ad" &&
      (ad.artworkStatus !== "ready" || !ad.artworkPath?.trim())
    )
      block(
        "booked-ad-artwork",
        `Booked advertisement ${ad.id} needs approved artwork.`,
      );
  if (
    state.pages.length !== state.pageBudget ||
    state.pages.some((p, i) => p.pageNumber !== i + 1)
  )
    block(
      "page-budget",
      "The saved pages must fill the fixed page budget in consecutive order.",
    );
  for (const p of state.placements) {
    if (p.included === false) continue;
    if (!p.pageIds.length)
      block("unplaced-story", `Article ${p.articleId} is unplaced.`);
    if (
      p.stale ||
      (p.currentSourceRevision && p.sourceRevision !== p.currentSourceRevision)
    )
      block(
        "stale-source",
        `Article ${p.articleId} changed after its saved layout.`,
      );
  }
  if (
    !c ||
    c.status !== "completed" ||
    c.revision !== input.revision ||
    c.errors !== 0 ||
    !c.copyPreserved ||
    !compositionHasProvenance(c)
  )
    block(
      "composition",
      "A successful composition with complete provenance is required for this exact revision.",
    );
  let report: AdobeValidationReport | undefined;
  try {
    if (input.adobe) report = validateAdobeReport(input.adobe);
  } catch {
    block("adobe-report", "The imported Adobe report is invalid.");
  }
  if (
    !report ||
    !c ||
    report.inputSha256 !== c.inputSha256 ||
    report.artifactSha256 !== c.artifactSha256
  )
    block(
      "adobe-identity",
      "Adobe validation must identify the exact composed input and IDML bytes.",
    );
  if (
    report &&
    (report.checks.preflightErrors ||
      report.checks.missingFonts.length ||
      report.checks.invalidLinks.length ||
      report.checks.oversetStories.length ||
      report.checks.lowResolutionImages.length)
  )
    block(
      "adobe-preflight",
      "Adobe reports font, link, overset, image-resolution or preflight problems.",
    );
  if (
    !profile ||
    !Number.isSafeInteger(profile.pageMultiple) ||
    profile.pageMultiple < 1 ||
    !finite(profile.minImagePpi) ||
    profile.minImagePpi <= 0 ||
    !finite(profile.pageWidthPoints) ||
    profile.pageWidthPoints <= 0 ||
    !finite(profile.pageHeightPoints) ||
    profile.pageHeightPoints <= 0 ||
    !Array.isArray(profile.bleedPoints) ||
    profile.bleedPoints.length !== 4 ||
    !profile.bleedPoints.every((n) => finite(n) && n >= 0) ||
    !boundedText(profile.preflightProfile) ||
    !boundedText(profile.colorProfile)
  ) {
    block(
      "print-profile",
      "A complete publisher-approved print profile is required.",
    );
  } else {
    if (state.pageBudget % profile.pageMultiple)
      block(
        "print-page-multiple",
        "The page budget does not satisfy the printer's page multiple.",
      );
    if (
      report &&
      (report.checks.pageCount !== state.pageBudget ||
        Math.abs(report.checks.pageWidthPoints - profile.pageWidthPoints) >
          0.01 ||
        Math.abs(report.checks.pageHeightPoints - profile.pageHeightPoints) >
          0.01 ||
        report.checks.bleedPoints.some(
          (n, i) => Math.abs(n - profile.bleedPoints[i]) > 0.01,
        ) ||
        report.checks.preflightProfile !== profile.preflightProfile ||
        report.checks.colorProfile !== profile.colorProfile ||
        report.checks.minImagePpi !== profile.minImagePpi)
    )
      block(
        "print-profile-mismatch",
        "Adobe dimensions, bleed, page count or profiles differ from the approved print profile.",
      );
  }
  for (const fork of input.nativeForks ?? [])
    if (
      fork.status === "active" &&
      (fork.sourceRevision !== input.revision ||
        fork.artifactSha256 !== report?.nativeSha256)
    )
      block(
        "native-fork",
        `Manual document fork ${fork.id} must be reconciled or archived before regenerating final output.`,
      );
  return {
    ready: blockers.length === 0,
    level: issueVerificationLevel(input),
    blockers,
  };
}

/** Regeneration creates another artifact; it cannot replace an active manual fork. */
export function assertNativeForkWritable(
  forks: NativeDocumentFork[],
  targetSha256?: string,
): void {
  if (
    forks.some(
      (f) =>
        f.status === "active" &&
        (!targetSha256 || f.artifactSha256 === targetSha256),
    )
  )
    throw new Error(
      "Preserve the active manual document fork; generate a new named revision or archive the fork explicitly.",
    );
}
