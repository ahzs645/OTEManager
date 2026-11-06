import { expect, test } from "vitest";
import {
  assertNativeForkWritable,
  evaluateIssueRelease,
  issueVerificationLevel,
  validateAdobeReport,
  type AdobeValidationReport,
  type CheckedComposition,
  type IssuePrintProfile,
} from "../shared/issue-studio-production";
import { emptyIssueStudioState } from "../shared/issue-studio";
const hash = (character = "a") => character.repeat(64);
const profile: IssuePrintProfile = {
  pageWidthPoints: 756,
  pageHeightPoints: 792,
  bleedPoints: [9, 9, 9, 9],
  pageMultiple: 4,
  preflightProfile: "OTE Press",
  colorProfile: "Printer CMYK",
  minImagePpi: 300,
};
const composition = (): CheckedComposition => ({
  revision: 4,
  inputSha256: hash(),
  artifactSha256: hash("b"),
  status: "completed",
  errors: 0,
  copyPreserved: true,
  provenance: {
    sourceSha256: hash(),
    mediaSha256: hash(),
    templateSha256: hash(),
    fontsSha256: hash(),
    printProfileSha256: hash(),
    engineVersion: "DesignCraft 0.9",
  },
});
const adobe = (): AdobeValidationReport => ({
  schemaVersion: "ote.adobe-validation.v1",
  inputSha256: hash(),
  artifactSha256: hash("b"),
  nativeSha256: hash("c"),
  checkedAt: "2026-10-21T00:00:00Z",
  application: { name: "Adobe InDesign", version: "21", platform: "macOS" },
  checks: {
    missingFonts: [],
    invalidLinks: [],
    oversetStories: [],
    lowResolutionImages: [],
    minImagePpi: 300,
    pageCount: 4,
    pageWidthPoints: 756,
    pageHeightPoints: 792,
    bleedPoints: [9, 9, 9, 9],
    preflightProfile: "OTE Press",
    preflightErrors: 0,
    colorProfile: "Printer CMYK",
  },
  outputs: { native: "issue.indd" },
});
const state = () => ({
  ...emptyIssueStudioState(),
  pageBudget: 4,
  pages: [1, 2, 3, 4].map((pageNumber) => ({
    id: `p${pageNumber}`,
    pageNumber,
  })),
  placements: [
    {
      id: "placement",
      articleId: "story",
      pageIds: ["p1"],
      sourceRevision: "source",
      currentSourceRevision: "source",
    },
  ],
});

test("verification never elevates a preview, missing provenance or mismatched Adobe bytes", () => {
  expect(issueVerificationLevel({ revision: 4 })).toBe("Estimated");
  expect(
    issueVerificationLevel({
      revision: 5,
      composition: composition(),
      adobe: adobe(),
    }),
  ).toBe("Stale");
  expect(
    issueVerificationLevel({
      revision: 4,
      composition: { ...composition(), errors: undefined },
    }),
  ).toBe("Estimated");
  expect(
    issueVerificationLevel({
      revision: 4,
      composition: {
        ...composition(),
        provenance: { ...composition().provenance, fontsSha256: "missing" },
      },
    }),
  ).toBe("Estimated");
  expect(
    issueVerificationLevel({
      revision: 4,
      composition: composition(),
      adobe: { ...adobe(), artifactSha256: hash("d") },
    }),
  ).toBe("DesignCraft checked");
  expect(
    issueVerificationLevel({
      revision: 4,
      composition: composition(),
      adobe: adobe(),
    }),
  ).toBe("Adobe verified");
});

test("final release blocks pending booked artwork, stale sources and unplaced copy", () => {
  const s = state();
  s.reservations.push({
    id: "ad",
    pageNumber: 1,
    rect: [36, 36, 200, 200],
    kind: "booked-ad",
    artworkStatus: "pending",
  });
  s.placements[0].pageIds = [];
  s.placements[0].currentSourceRevision = "changed";
  const result = evaluateIssueRelease({
    state: s,
    revision: 4,
    composition: composition(),
    adobe: adobe(),
    printProfile: profile,
  });
  expect(result.ready).toBe(false);
  expect(result.blockers.map((b) => b.code)).toEqual(
    expect.arrayContaining([
      "booked-ad-artwork",
      "stale-source",
      "unplaced-story",
    ]),
  );
  expect(s.reservations[0].artworkStatus).toBe("pending");
});

test("a complete current revision can release only against its approved print profile", () => {
  const input = {
    state: state(),
    revision: 4,
    composition: composition(),
    adobe: adobe(),
    printProfile: profile,
  };
  expect(evaluateIssueRelease(input)).toEqual({
    ready: true,
    level: "Adobe verified",
    blockers: [],
  });
  expect(
    evaluateIssueRelease({
      ...input,
      printProfile: { ...profile, minImagePpi: 600 },
    }).blockers.map((b) => b.code),
  ).toContain("print-profile-mismatch");
  expect(
    evaluateIssueRelease({
      ...input,
      adobe: {
        ...adobe(),
        checks: { ...adobe().checks, bleedPoints: [0, 0, 0, 0] },
      },
    }).ready,
  ).toBe(false);
  expect(
    evaluateIssueRelease({
      ...input,
      adobe: {
        ...adobe(),
        checks: { ...adobe().checks, oversetStories: ["story-3"] },
      },
    }).blockers.map((b) => b.code),
  ).toContain("adobe-preflight");
  expect(
    evaluateIssueRelease({ ...input, printProfile: undefined }).ready,
  ).toBe(false);
});

test("Adobe evidence is bounded, complete, copied and never inferred from a tested flag", () => {
  expect(() => validateAdobeReport({ adobeInDesignTested: true })).toThrow(
    /identity/,
  );
  expect(() =>
    validateAdobeReport({
      ...adobe(),
      checks: { ...adobe().checks, preflightErrors: -1 },
    }),
  ).toThrow(/checks/);
  expect(() =>
    validateAdobeReport({
      ...adobe(),
      checks: { ...adobe().checks, pageWidthPoints: NaN },
    }),
  ).toThrow(/checks/);
  const source = adobe(),
    saved = validateAdobeReport(source);
  source.checks.missingFonts.push("missing");
  expect(saved.checks.missingFonts).toEqual([]);
});

test("regeneration preserves active manual document forks", () => {
  const fork = {
    id: "manual-edit",
    sourceRevision: 3,
    artifactSha256: hash("d"),
    status: "active" as const,
  };
  expect(() => assertNativeForkWritable([fork], hash("d"))).toThrow(/Preserve/);
  expect(() => assertNativeForkWritable([fork], hash("e"))).not.toThrow();
  const result = evaluateIssueRelease({
    state: state(),
    revision: 4,
    composition: composition(),
    adobe: adobe(),
    printProfile: profile,
    nativeForks: [fork],
  });
  expect(result.blockers.map((b) => b.code)).toContain("native-fork");
  expect(
    evaluateIssueRelease({
      state: state(),
      revision: 4,
      composition: composition(),
      adobe: adobe(),
      printProfile: profile,
      nativeForks: [
        { ...fork, sourceRevision: 4, artifactSha256: adobe().nativeSha256 },
      ],
    }).ready,
  ).toBe(true);
});
