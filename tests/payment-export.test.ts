// @vitest-environment node
import { expect, test } from "vitest";
import {
  buildPaymentExport,
  serializePaymentPageExport,
  type ExportableArticle,
} from "../shared/payment-export";
import {
  validateBatch,
  hasSentArticles,
  paymentWarnings,
} from "../extensions/vancity-payment-helper/contract.js";

const options = {
  batchId: "test-batch",
  createdAt: "2026-10-13T19:00:00.000Z",
};

test("page export safely retains article text containing HTML/script delimiters", () => {
  const batch = buildPaymentExport(
    [article({ title: 'News </script><script>alert("fixture")</script>' })],
    undefined,
    options,
  );
  const encoded = serializePaymentPageExport(batch);
  expect(encoded).not.toContain("<");
  expect(JSON.parse(encoded)).toEqual(batch);
});
function article(
  overrides: Partial<ExportableArticle> = {},
): ExportableArticle {
  return {
    id: "article-1",
    title: "Campus news",
    articleTier: "Tier 2 (Standard)",
    paymentStatus: false,
    paymentAmount: 4500,
    paymentIsManual: false,
    paymentRateSnapshot: JSON.stringify({
      tierName: "Tier 2 (Standard)",
      baseAmount: 3500,
      totalAmount: 4500,
      bonuses: [{ type: "Research", amount: 1000 }],
    }),
    author: {
      id: "author-1",
      givenName: "Test",
      surname: "Writer",
      email: "writer@example.test",
      etransferEmail: "PAYMENTS@example.test",
      authorType: "Student",
      autoDepositAvailable: true,
    },
    issue: { issueNumber: 3, volume: { volumeNumber: 33 } },
    volume: null,
    issueNumber: null,
    ...overrides,
  };
}

test("defaults to a separate transfer per article with exact saved cents, email and bonus description", () => {
  const batch = buildPaymentExport(
    [article(), article({ id: "article-2", title: "Another story" })],
    undefined,
    options,
  );
  expect(batch.grouping).toBe("article");
  expect(batch.payments).toHaveLength(2);
  expect(batch.payments[0]).toMatchObject({
    amountCents: 4500,
    recipientEmail: "payments@example.test",
    emailSource: "etransfer",
  });
  expect(batch.payments[0].message).toContain("Campus news (Vol 33, Issue 3)");
  expect(batch.payments[0].message).toContain("Research bonus $10.00");
  expect(validateBatch(batch)).toEqual(batch);
});

test("combines only the same author and email, retaining each article and breakdown", () => {
  const a = article();
  const batch = buildPaymentExport(
    [
      a,
      article({ id: "article-2" }),
      article({ id: "article-3", author: { ...a.author, id: "other-author" } }),
    ],
    "author",
    options,
  );
  expect(batch.payments).toHaveLength(2);
  expect(batch.payments[0].amountCents).toBe(9000);
  expect(batch.payments[0].articles.map((a) => a.id)).toEqual([
    "article-1",
    "article-2",
  ]);
  expect(batch.payments[1].amountCents).toBe(4500);
  expect(validateBatch(batch)).toEqual(batch);
});

test("excludes paid, ineligible, invalid amounts and invalid preferred addresses without mutating input", () => {
  const input = [
    article(),
    article(),
    article({ id: "paid", paymentStatus: true }),
    ...[null, 0, -100, 12.5, Number.MAX_SAFE_INTEGER + 1].map((amount, i) =>
      article({ id: `bad-amount-${i}`, paymentAmount: amount }),
    ),
    article({
      id: "faculty",
      author: { ...article().author, authorType: "Faculty" },
    }),
    article({
      id: "bad-email",
      author: { ...article().author, etransferEmail: "invalid" },
    }),
  ];
  const before = JSON.stringify(input);
  const batch = buildPaymentExport(input, "article", options);
  expect(batch.payments).toHaveLength(1);
  expect(batch.skipped).toHaveLength(8);
  expect(JSON.stringify(input)).toBe(before);
});

test("warns on fallback address and uses manual amount without inventing bonuses", () => {
  const batch = buildPaymentExport(
    [
      article({
        paymentIsManual: true,
        paymentAmount: 5200,
        author: { ...article().author, etransferEmail: null },
      }),
    ],
    "article",
    options,
  );
  expect(batch.payments[0].emailSource).toBe("author");
  expect(batch.payments[0].warnings.join()).toContain("confirm");
  expect(batch.payments[0].message).toContain("Manual payment $52.00");
  expect(batch.payments[0].message).not.toContain("Research");
});

test.each([
  "not-json",
  JSON.stringify({
    tierName: "Tier 2 (Standard)",
    baseAmount: 2000,
    totalAmount: 4500,
    bonuses: [],
  }),
])(
  "rejects stale/corrupt breakdown %s but preserves the saved amount",
  (snapshot) => {
    const p = buildPaymentExport(
      [article({ paymentRateSnapshot: snapshot })],
      "article",
      options,
    ).payments[0];
    expect(p.amountCents).toBe(4500);
    expect(p.articles[0].items).toEqual([
      { description: "Article payment", amountCents: 4500 },
    ]);
    expect(p.warnings.join()).toContain("no matching saved calculation");
  },
);

test("does not silently truncate long article messages", () => {
  const p = buildPaymentExport(
    [article({ title: "Long article ".repeat(50) })],
    "article",
    options,
  ).payments[0];
  expect(p.message.length).toBeGreaterThan(400);
  expect(p.message).toContain("Research bonus $10.00");
  expect(p.warnings.join()).toContain("400 characters");
});

test("helper rejects tampered totals, duplicates, unsupported currency and malformed files", () => {
  const batch = buildPaymentExport([article()], "article", options);
  for (const change of [
    (b: any) => b.payments[0].amountCents++,
    (b: any) => b.payments.push({ ...b.payments[0], id: "other" }),
    (b: any) => (b.currency = "USD"),
    (b: any) => (b.payments[0].recipientEmail = "bad"),
    (b: any) => (b.payments[0].articles[0].items[0].amountCents = 1),
    (b: any) => (b.createdAt = "invalid"),
  ]) {
    const altered = structuredClone(batch);
    change(altered);
    expect(() => validateBatch(altered)).toThrow("Invalid OTE payment export");
  }
  expect(() => validateBatch({})).toThrow();
});

test("session duplicate checks survive switching from separate to combined exports", () => {
  const batch = buildPaymentExport(
    [article(), article({ id: "article-2" })],
    "author",
    options,
  );
  expect(hasSentArticles(batch.payments[0], ["article-2"])).toBe(true);
  expect(hasSentArticles(batch.payments[0], [])).toBe(false);
  expect(
    paymentWarnings(
      batch,
      batch.payments[0],
      Date.parse(options.createdAt) + 2 * 86400000,
    ).join(),
  ).toContain("export is old");
});
