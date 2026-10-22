// @vitest-environment node
import { beforeAll, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import {
  parseSourceArchiveBundle,
  type SourceArchiveBundle,
} from "../shared/source-archive";
import originals from "./fixtures/source-archive-originals.json";

const staticDir = join(process.cwd(), "public/designcraft");
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
let bundle: SourceArchiveBundle, registry: any;
beforeAll(async () => {
  bundle = parseSourceArchiveBundle(
    JSON.parse(await readFile(join(staticDir, "source-archive.json"), "utf8")),
  );
  registry = JSON.parse(
    await readFile(join(staticDir, "source-issues.json"), "utf8"),
  );
});

test("the article catalogue retains every supplied issue variant and the original PDF identity", async () => {
  expect(bundle.archiveId).toBe("ote-original-issues-2026-10-09");
  expect(bundle.issues.map((i) => i.documentId).sort()).toEqual(
    registry.issues.map((i: any) => i.documentId).sort(),
  );
  expect(bundle.issues).toHaveLength(9);
  expect(
    new Set(bundle.issues.map((i) => `${i.volumeNumber}/${i.issueNumber}`))
      .size,
  ).toBe(7);
  for (const source of registry.issues) {
    const issue = bundle.issues.find(
      (i) => i.documentId === source.documentId,
    )!;
    expect(issue).toMatchObject({
      volumeNumber: source.metadata.volume,
      issueNumber: source.metadata.number,
      pageCount: source.pageCount,
      releaseDate: source.metadata.date,
    });
    expect(issue.source.sha256).toBe(source.sourceSha256);
    expect(
      digest(new Uint8Array(await readFile(join(staticDir, source.pdf)))),
    ).toBe(issue.source.sha256);
  }
});

test("all87 original database records retain exact titles, public credits and all20 stored bodies", () => {
  expect(originals.articleCount).toBe(87);
  expect(originals.storedBodyCount).toBe(20);
  const records = bundle.articles.filter((a) => a.originalArticleId);
  expect(records.map((a) => a.originalArticleId).sort()).toEqual(
    originals.articles.map((a) => a.originalArticleId).sort(),
  );
  for (const expected of originals.articles) {
    const article = records.find(
      (a) => a.originalArticleId === expected.originalArticleId,
    )!;
    expect(article.title, expected.originalArticleId).toBe(expected.title);
    expect(article.authorName, expected.originalArticleId).toBe(
      expected.authorName,
    );
    expect(article.authorSourceId ?? null, expected.originalArticleId).toBe(
      expected.originalAuthorId,
    );
    expect(article.originalDates, expected.originalArticleId).toEqual(
      expected.originalDates,
    );
    const editions = article.placements
      .map((p) => bundle.issues.find((i) => i.documentId === p.documentId)!)
      .map((i) => `${i.volumeNumber}/${i.issueNumber}`);
    expect([...new Set(editions)], expected.originalArticleId).toEqual([
      `${expected.volume}/${expected.issueNumber}`,
    ]);
    if (expected.storedBodySha256)
      expect(digest(article.content), expected.originalArticleId).toBe(
        expected.storedBodySha256,
      );
    if (!article.content.trim())
      expect(article.recoveryStatus, expected.originalArticleId).toBe(
        "metadata-only",
      );
    expect(
      article.provenance.some((p) => p.sha256 === originals.sourceBackupSha256),
      expected.originalArticleId,
    ).toBe(true);
  }
});

test("the two similar September event titles remain separate original identities without invented missing copy", () => {
  const complete = bundle.articles.find(
    (a) => a.originalArticleId === "d6bb0ea5-152a-41e3-b40d-cc9ea65fc637",
  )!;
  const metadata = bundle.articles.find(
    (a) => a.originalArticleId === "e6db968d-315b-4a57-82bc-f978ae6bddf7",
  )!;
  expect(complete).toBeDefined();
  expect(metadata).toBeDefined();
  expect(complete.sourceKey).not.toBe(metadata.sourceKey);
  expect(complete.content.length).toBeGreaterThan(1000);
  expect(metadata.content).toBe("");
  expect(metadata.recoveryStatus).toBe("metadata-only");
});

test("the published catalogue omits source contact, payment and private workflow records", () => {
  const privateKeys = new Set([
    "email",
    "etransferEmail",
    "autoDepositAvailable",
    "paymentStatus",
    "paymentAmount",
    "paidAt",
    "paymentBankReference",
    "paymentReceipt",
    "paymentRateSnapshot",
    "paymentCalculatedAt",
    "paymentIsManual",
    "articleTier",
    "internalStatus",
    "automationStatus",
    "feedbackLetter",
  ]);
  function check(value: unknown, path = "archive") {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((v, index) => check(v, `${path}[${index}]`));
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      expect(privateKeys.has(key), `${path}.${key}`).toBe(false);
      check(item, `${path}.${key}`);
    }
  }
  check(bundle);
  for (const expected of originals.articles.filter((a) => a.anonymous)) {
    const record = bundle.articles.find(
      (a) => a.originalArticleId === expected.originalArticleId,
    )!;
    expect(record.authorName).toBe("Anonymous");
    expect(record.authorSourceId).toBeUndefined();
  }
});

test("genuine metadata-only articles are distinguished from recurring and photo feature inventory", () => {
  expect(
    bundle.articles.some(
      (a) =>
        a.kind === "article" &&
        a.recoveryStatus === "metadata-only" &&
        !a.content,
    ),
  ).toBe(true);
  expect(bundle.articles.some((a) => a.kind === "recurring")).toBe(true);
  expect(bundle.articles.some((a) => a.kind === "photo-feature")).toBe(true);
  for (const article of bundle.articles) {
    expect(article.title.trim()).not.toBe("");
    if (["article", "editorial"].includes(article.kind))
      expect(
        Boolean(article.content.trim()) ||
          article.recoveryStatus === "metadata-only",
        article.sourceKey,
      ).toBe(true);
    for (const placement of article.placements) {
      const issue = bundle.issues.find(
        (i) => i.documentId === placement.documentId,
      )!;
      expect(issue, article.sourceKey).toBeDefined();
      expect(
        placement.pageNumbers.every(
          (n) => Number.isInteger(n) && n > 0 && n <= issue.pageCount,
        ),
        article.sourceKey,
      ).toBe(true);
    }
  }
});

test("all25 recovered IDML main bodies equal the complete cited source stories, with explicit alternate-revision provenance", async () => {
  const recovered = bundle.articles.filter(
    (a) =>
      a.recoveryStatus === "source-idml" &&
      ["article", "editorial"].includes(a.kind),
  );
  expect(recovered).toHaveLength(25);
  const packages = new Map<string, JSZip>();
  const normalize = (text: string) =>
    text
      .normalize("NFC")
      .replace(/[\u00ad\ufeff\ufffc]/g, "")
      .replace(/\s+/gu, " ")
      .trim();
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    apos: "'",
    quot: '"',
  };
  const decode = (text: string) =>
    text
      .replace(/&#x([\da-f]+);/gi, (_, value) =>
        String.fromCodePoint(parseInt(value, 16)),
      )
      .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
      .replace(/&(amp|lt|gt|apos|quot);/g, (_, name) => entities[name]);
  // Concatenate style runs without inserting spaces inside words; paragraph
  // ends and explicit breaks remain separators. Only the cited byline is removed.
  const sourceText = (xml: string) =>
    [
      ...xml.matchAll(
        /<Content>([\s\S]*?)<\/Content>|<Br\s*\/>|<\/ParagraphStyleRange>/g,
      ),
    ]
      .map((match) => (match[1] === undefined ? "\n" : decode(match[1])))
      .join("");
  for (const article of recovered) {
    const candidates: string[] = [];
    for (const citation of article.provenance.filter((p) =>
      p.path.endsWith(".idml"),
    )) {
      if (!packages.has(citation.path)) {
        const bytes = new Uint8Array(
          await readFile(join(staticDir, citation.path)),
        );
        expect(digest(bytes), citation.path).toBe(citation.sha256);
        packages.set(citation.path, await JSZip.loadAsync(bytes));
      }
      for (const storyId of citation.storyIds as string[]) {
        const entry = packages
          .get(citation.path)!
          .file(`Stories/Story_${storyId}.xml`);
        expect(entry, `${article.sourceKey}:${storyId}`).not.toBeNull();
        let text = normalize(sourceText(await entry!.async("string")));
        if (citation.sourceByline)
          text = normalize(
            text.replace(normalize(String(citation.sourceByline)), ""),
          );
        candidates.push(text);
      }
    }
    expect(candidates, article.sourceKey).toContain(normalize(article.content));
    if (article.sourceVisibility?.includes("not-in-paired-pdf"))
      expect(
        article.placements.every((p) => p.pageNumbers.length === 0),
        article.sourceKey,
      ).toBe(true);
  }
  for (const [key, author, originalIssue] of [
    ["idml:66de36f6:u129d", "Travis Nielsen", 2],
    ["idml:66de36f6:u123a", "Carolynne Burkholder", 5],
  ] as const) {
    const reprint = bundle.articles.find((a) => a.sourceKey === key)!;
    expect(reprint.authorName).toBe(author);
    expect(reprint.content).toContain(
      `This originally appeared in Over the Edge Volume 11, Issue ${originalIssue}`,
    );
    expect(
      reprint.placements
        .map((p) => bundle.issues.find((i) => i.documentId === p.documentId)!)
        .every((i) => i.volumeNumber === 31 && i.issueNumber === 3),
    ).toBe(true);
  }
});
