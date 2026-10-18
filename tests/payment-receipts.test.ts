import { beforeEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { fromWire, toWire } from "../shared/codec";
import { buildPaymentExport } from "../shared/payment-export";
import { validateConfirmation } from "../extensions/vancity-payment-helper/receipt-contract.js";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const secret = "payment-receipt-isolated-test";
beforeEach(() => vi.stubEnv("CONVEX_SERVER_SECRET", secret));
async function setup(grouping: "article" | "author" = "author") {
  const t = convexTest(schema, modules);
  const write = async (operation: string, data?: any) =>
    fromWire(
      await t.mutation(api.app.write, {
        secret,
        operation,
        data: toWire(data),
      }),
    );
  const read = async (operation: string, data?: any) =>
    fromWire(
      await t.query(api.app.read, { secret, operation, data: toWire(data) }),
    );
  for (const [title, amount] of [
    ["First story", 2000],
    ["Second story", 3500],
  ] as const) {
    const { articleId } = await write("createArticle", {
      title,
      authorEmail: "writer@example.test",
      authorGivenName: "Test",
      authorSurname: "Writer",
    });
    await write("updateArticleStatus", { articleId, status: "Approved" });
    await write("setManualPayment", { articleId, amount });
  }
  const articles = (await read("getUnpaidArticlesPage")).articles;
  const batch = buildPaymentExport(articles, grouping);
  const payment = batch.payments[0];
  const data = validateConfirmation({
    batchId: batch.batchId,
    exportedAt: batch.createdAt,
    expectedMessage: payment.message,
    payment,
    receipt: {
      bank: "Vancity",
      status: "sent",
      currency: "CAD",
      reference: "20260102030405000001",
      amountCents: payment.amountCents,
      feeCents: 0,
      recipientEmail: payment.recipientEmail,
      recipientName: "Test Writer Bank",
      message: payment.message,
      sourceAccountLastFour: "1234",
      transferDate: "2 Jan 2026",
      receiptDate: "2 Jan 2026 - 03:04",
    },
  });
  return { t, write, read, batch, data };
}
test("records all combined articles and the reference atomically; duplicate confirmation is idempotent", async () => {
  const { write, read, data } = await setup();
  const first = await write("recordBankPayment", data);
  expect(first.alreadyRecorded).toBe(false);
  expect((await read("getUnpaidArticlesPage")).articles).toHaveLength(0);
  const paidDates = [];
  for (const a of data.payment.articles) {
    const { article } = await read("getArticleById", { id: a.id });
    expect(article.paymentStatus).toBe(true);
    expect(article.paymentAmount).toBe(a.amountCents);
    expect(article.paymentBankReference).toBe(data.receipt.reference);
    expect(JSON.parse(article.paymentReceipt)).toEqual(data);
    expect(article.notes).toHaveLength(1);
    expect(article.notes[0].content).toContain(data.receipt.reference);
    paidDates.push(article.paidAt.getTime());
  }
  expect(new Set(paidDates).size).toBe(1);
  expect((await write("recordBankPayment", data)).alreadyRecorded).toBe(true);
  for (const a of data.payment.articles)
    expect(
      (await read("getArticleById", { id: a.id })).article.notes,
    ).toHaveLength(1);
});
test("separate mode records only the included article", async () => {
  const { write, read, data } = await setup("article");
  await write("recordBankPayment", data);
  const unpaid = (await read("getUnpaidArticlesPage")).articles;
  expect(unpaid).toHaveLength(1);
  expect(unpaid[0].id).not.toBe(data.payment.articles[0].id);
});
test.each(["email", "amount", "message", "reference", "status"])(
  "rejects a mismatched or incomplete bank %s before any writes",
  async (field) => {
    const { write, read, data } = await setup();
    const invalid = structuredClone(data);
    if (field === "email")
      invalid.receipt.recipientEmail = "other@example.test";
    if (field === "amount") invalid.receipt.amountCents++;
    if (field === "message") invalid.receipt.message = "Different article";
    if (field === "reference")
      invalid.receipt.reference = "20260102030405000002x";
    if (field === "status") (invalid.receipt as any).status = "scheduled";
    await expect(write("recordBankPayment", invalid)).rejects.toThrow();
    expect((await read("getUnpaidArticlesPage")).articles).toHaveLength(2);
  },
);
test("one stale saved amount rolls back the entire combined transfer", async () => {
  const { write, read, data } = await setup();
  await write("setManualPayment", {
    articleId: data.payment.articles[1].id,
    amount: 4500,
  });
  await expect(write("recordBankPayment", data)).rejects.toThrow("differs");
  const unpaid = (await read("getUnpaidArticlesPage")).articles;
  expect(unpaid).toHaveLength(2);
  for (const a of unpaid)
    expect(
      (await read("getArticleById", { id: a.id })).article.notes,
    ).toHaveLength(0);
});
test("an already paid article stops a combined receipt without altering the remaining articles", async () => {
  const { write, read, data } = await setup();
  const a = data.payment.articles[1];
  await write("markPaymentComplete", {
    articleId: a.id,
    amount: a.amountCents,
  });
  await expect(write("recordBankPayment", data)).rejects.toThrow(
    "already paid",
  );
  const first = (
    await read("getArticleById", { id: data.payment.articles[0].id })
  ).article;
  expect(first.paymentStatus).toBe(false);
  expect(first.notes).toHaveLength(0);
});
test("a reference cannot be reused for another article or another transfer amount", async () => {
  const { write, batch, data } = await setup("article");
  await write("recordBankPayment", data);
  const second = batch.payments[1];
  const different = validateConfirmation({
    ...data,
    payment: second,
    expectedMessage: second.message,
    receipt: {
      ...data.receipt,
      amountCents: second.amountCents,
      message: second.message,
    },
  });
  await expect(write("recordBankPayment", different)).rejects.toThrow(
    "different payment",
  );
});
test.each(["email", "author", "title", "status", "publication"])(
  "rechecks the current %s after export",
  async (field) => {
    const { write, read, data } = await setup();
    const a = data.payment.articles[0];
    if (field === "email")
      await write("updateAuthorPaymentInfo", {
        authorId: data.payment.authorId,
        etransferEmail: "new@example.test",
      });
    if (field === "author")
      await write("updateAuthorPaymentInfo", {
        authorId: data.payment.authorId,
        authorType: "Staff",
      });
    if (field === "title")
      await write("updateArticle", {
        articleId: a.id,
        title: "Renamed article",
      });
    if (field === "status")
      await write("updateArticleStatus", { articleId: a.id, status: "Draft" });
    if (field === "publication")
      await write("updateArticle", { articleId: a.id, volume: 90, issue: 1 });
    await expect(write("recordBankPayment", data)).rejects.toThrow();
    expect(
      (await read("getArticleById", { id: a.id })).article.paymentStatus,
    ).toBe(false);
  },
);
