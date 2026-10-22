import { expect, test } from "vitest";
import {
  articleDisplayAuthor,
  articleDisplaySubmitted,
  readSourceProvenance,
  sourceRecoveryLabel,
} from "../app/lib/source-archive-display";

const source = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    schemaVersion: "ote.source-article-provenance.v1",
    archiveId: "original-issues",
    sourceKey: "legacy:original",
    originalAuthorName: "Original Reporter",
    ...fields,
  });
const article = {
  author: { givenName: "Internal", surname: "Archive Bucket" },
  submittedAt: null,
  createdAt: new Date("2026-10-22T12:00:00Z"),
  sourceProvenance: source(),
};

test("source article lists preserve the original byline and do not invent a submission date from import time", () => {
  expect(articleDisplayAuthor(article)).toBe("Original Reporter");
  expect(articleDisplaySubmitted(article)).toBeNull();
  expect(
    articleDisplayAuthor({
      ...article,
      sourceProvenance: source({ originalAuthorName: null }),
    }),
  ).toBe("Author not recorded");
  const submittedAt = new Date("2025-03-01T00:00:00Z");
  expect(articleDisplaySubmitted({ ...article, submittedAt })).toBe(
    submittedAt,
  );
  expect(
    articleDisplaySubmitted({
      ...article,
      sourceProvenance: source({
        originalDates: {
          submittedAt: "2024-11-01T13:30:00Z",
          createdAt: "invalid",
        },
      }),
    })?.toISOString(),
  ).toBe("2024-11-01T13:30:00.000Z");
  expect(articleDisplayAuthor({ ...article, sourceProvenance: null })).toBe(
    "Internal Archive Bucket",
  );
  expect(articleDisplaySubmitted({ ...article, sourceProvenance: null })).toBe(
    article.createdAt,
  );
});

test("malformed source metadata cannot crash article views or invent source page references", () => {
  expect(readSourceProvenance("not JSON")).toBeNull();
  expect(
    readSourceProvenance('{"archiveId":"other","sourceKey":"unrecognized"}'),
  ).toBeNull();
  const parsed = readSourceProvenance(
    source({
      originalAuthorName: {},
      recoveryStatus: [],
      placements: [
        null,
        { documentId: "march", pageNumbers: [3, -2, "5"], section: "News" },
        {},
      ],
      provenance: [null, { path: "original.idml" }, {}],
    }),
  );
  expect(parsed?.originalAuthorName).toBeNull();
  expect(parsed?.recoveryStatus).toBeUndefined();
  expect(parsed?.placements).toEqual([
    { documentId: "march", pageNumbers: [3], section: "News" },
  ]);
  expect(parsed?.provenance).toEqual([{ path: "original.idml" }]);
  expect(sourceRecoveryLabel("metadata-only")).toContain("text not recovered");
  expect(sourceRecoveryLabel("source-backup")).toBe("Original backup text");
  expect(sourceRecoveryLabel("source-idml")).toBe(
    "Recovered from original layout",
  );
});
