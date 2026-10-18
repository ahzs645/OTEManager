// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { Window } from "happy-dom";
import { watchBankReceipt } from "../extensions/vancity-payment-helper/bank-receipt.js";
import { validateConfirmation } from "../extensions/vancity-payment-helper/receipt-contract.js";
import {
  writePaymentConfirmation,
  readPaymentManagerExport,
} from "../extensions/vancity-payment-helper/manager-page.js";
import { installPaymentHelperConnection } from "../app/lib/payment-helper-connection";
import { buildPaymentExport } from "../shared/payment-export";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { fromWire, toWire } from "../shared/codec";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

const pages: Window[] = [];
const sample = {
  id: "test-article",
  title: "Test story",
  articleTier: "Tier 1 (Basic)",
  paymentStatus: false,
  paymentAmount: 2000,
  paymentIsManual: true,
  paymentRateSnapshot: null,
  author: {
    id: "test-author",
    givenName: "Test",
    surname: "Writer",
    email: "writer@example.test",
    etransferEmail: "writer@example.test",
    authorType: "Student",
    autoDepositAvailable: true,
  },
  issue: null,
  volume: 34,
  issueNumber: 1,
};
const batch = buildPaymentExport([sample]);
const payment = batch.payments[0];
const receipt = {
  bank: "Vancity",
  status: "sent",
  currency: "CAD",
  reference: "20260102030405000001",
  recipientEmail: payment.recipientEmail,
  recipientName: "Test Writer Bank",
  amountCents: 2000,
  feeCents: 0,
  message: payment.message,
  transferDate: "2 Jan 2026",
  receiptDate: "2 Jan 2026 - 03:04",
  sourceAccountLastFour: "1234",
};
const data = () =>
  validateConfirmation({
    batchId: batch.batchId,
    exportedAt: batch.createdAt,
    payment,
    receipt,
    expectedMessage: payment.message,
  });
function page(url = "https://my.vancity.com/banking/fixture") {
  const w = new Window({ url });
  pages.push(w);
  for (const [name, value] of Object.entries({
    window: w,
    document: w.document,
    location: w.location,
    MutationObserver: w.MutationObserver,
    CustomEvent: w.CustomEvent,
    getComputedStyle: w.getComputedStyle.bind(w),
  }))
    vi.stubGlobal(name, value);
  Object.defineProperty(w.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return this.style.display === "none" ? [] : [{ width: 100, height: 20 }];
    },
  });
  return w;
}
function success(w: Window, values: Record<string, string> = {}) {
  const fields = {
    "Sent from": "Test Payments 111111111234",
    "Send to": receipt.recipientName,
    "Notify by": "Email",
    "Email address": receipt.recipientEmail,
    Amount: "$20.00",
    "Service fee": "$0.00",
    "Transfer date": receipt.transferDate,
    Message: receipt.message,
    Date: receipt.receiptDate,
    "Transaction Type": "Send Money",
    "Reference #": receipt.reference,
    ...values,
  };
  w.document.body.innerHTML =
    '<div role="main">Review $20.00</div><div role="dialog"><box class="ETRANSFERSENDMONEY success"><box class="confirmation-description-text" aria-label="Your transfer has been sent."></box></box></div>';
  const box = w.document.querySelector(".ETRANSFERSENDMONEY")!;
  for (const [key, value] of Object.entries(fields)) {
    const row = w.document.createElement("app-display-label-value-control");
    const label = w.document.createElement("mat-label");
    label.setAttribute("aria-label", key);
    const text = w.document.createElement("fpx-display-text");
    text.textContent = value;
    row.append(label, text);
    box.append(row);
  }
}
afterEach(() => {
  (globalThis as any).__oteReceiptWatch?.stop();
  delete (globalThis as any).__oteReceiptWatch;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const p of pages.splice(0)) p.happyDOM.abort();
});

test("reads the real bank receipt layout outside main and excludes contact success, reviews and hidden receipts", () => {
  const w = page();
  success(w);
  expect(watchBankReceipt("test", true)).toEqual({
    status: "receipt",
    receipt,
  });
  w.document
    .querySelector(".confirmation-description-text")!
    .setAttribute("aria-label", "New contact has been added.");
  expect(watchBankReceipt("test", true).status).toBe("waiting");
  success(w);
  (w.document.querySelector('[role="dialog"]') as any).style.display = "none";
  expect(watchBankReceipt("test", true).status).toBe("waiting");
});
test.each([
  { "Reference #": "" },
  { "Transaction Type": "Request Money" },
  { "Notify by": "Mobile" },
  { Amount: "USD $20.00" },
  { Message: "" },
])("rejects incomplete or unsupported receipts: %j", (fields) => {
  const w = page();
  success(w, fields);
  expect(watchBankReceipt("test", true).status).toBe("waiting");
});
test("the watcher survives popup closure and reports a new receipt once without clicking bank controls", async () => {
  const w = page();
  const send = vi.fn(async () => ({ captured: true }));
  vi.stubGlobal("chrome", { runtime: { sendMessage: send } });
  const click = vi.spyOn(w.HTMLElement.prototype, "click");
  expect(watchBankReceipt("watch-fixture").status).toBe("watching");
  success(w);
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(send.mock.calls[0][0]).toEqual({
    kind: "ote-bank-receipt",
    watchId: "watch-fixture",
    receipt,
  });
  expect(click).not.toHaveBeenCalled();
  w.document.body.append(w.document.createElement("p"));
  expect(send).toHaveBeenCalledOnce();
});
test("matching confirmation crosses the connected page bridge without bank secrets and reports the durable result", async () => {
  const w = page("http://localhost:3000/utilities/payment-manager");
  const record = vi.fn(async (input) => ({
    success: true as const,
    reference: input.receipt.reference,
    articleIds: input.payment.articles.map((a: any) => a.id),
    alreadyRecorded: false,
  }));
  const onRecorded = vi.fn();
  const dispose = installPaymentHelperConnection({
    document: w.document as any,
    currentBatch: () => batch,
    record,
    onRecorded,
  });
  const connection = {
    ...JSON.parse(
      w.document.getElementById("ote-payment-helper-connection")!.textContent!,
    ),
    origin: w.location.origin,
  };
  expect(readPaymentManagerExport(true)).toEqual({
    status: "connected",
    connection: { bridgeId: connection.bridgeId, protocolVersion: 1 },
  });
  const result = await writePaymentConfirmation(
    { ...data(), securityAnswer: "must-not-cross" },
    connection,
  );
  expect(result.success).toBe(true);
  expect(record).toHaveBeenCalledWith(data());
  expect(onRecorded).toHaveBeenCalledOnce();
  expect(w.document.querySelector('[id^="ote-payment-receipt-"]')).toBeNull();
  dispose();
});
test("changed preview stops new write-back, while an explicit durable retry still invokes current backend validation", async () => {
  const w = page("http://localhost:3000/utilities/payment-manager");
  const record = vi.fn(async () => ({
    success: false as const,
    error: "Existing paid payment conflicts.",
  }));
  const dispose = installPaymentHelperConnection({
    document: w.document as any,
    currentBatch: () => null,
    record,
    onRecorded: vi.fn(),
  });
  const connection = {
    ...JSON.parse(
      w.document.getElementById("ote-payment-helper-connection")!.textContent!,
    ),
    origin: w.location.origin,
  };
  expect((await writePaymentConfirmation(data(), connection)).success).toBe(
    false,
  );
  expect(record).not.toHaveBeenCalled();
  expect(
    (await writePaymentConfirmation(data(), connection, true)).error,
  ).toContain("conflicts");
  expect(record).toHaveBeenCalledOnce();
  dispose();
});
test("a reloaded or different-origin connection cannot receive a receipt", async () => {
  const w = page("http://localhost:3000/utilities/payment-manager");
  expect(
    (
      await writePaymentConfirmation(data(), {
        origin: "http://localhost:3001",
        bridgeId: "x",
      })
    ).success,
  ).toBe(false);
  expect(
    (
      await writePaymentConfirmation(data(), {
        origin: w.location.origin,
        bridgeId: "old-bridge",
      })
    ).error,
  ).toContain("reloaded");
});

test("a connected receipt writes through the page bridge into the real Convex transaction and survives a duplicate delivery", async () => {
  const w = page("http://localhost:3000/utilities/payment-manager");
  const secret = "isolated-connected-writeback";
  vi.stubEnv("CONVEX_SERVER_SECRET", secret);
  const t = convexTest(schema, modules);
  const write = async (operation: string, input: any) =>
    fromWire(
      await t.mutation(api.app.write, {
        secret,
        operation,
        data: toWire(input),
      }),
    );
  const { articleId } = await write("createArticle", {
    title: sample.title,
    authorEmail: sample.author.email,
    authorGivenName: "Test",
    authorSurname: "Writer",
  });
  await write("updateArticleStatus", { articleId, status: "Approved" });
  await write("setManualPayment", { articleId, amount: 2000 });
  const exported = fromWire(
    await t.query(api.app.read, {
      secret,
      operation: "getUnpaidArticlesPage",
      data: null,
    }),
  );
  const current = buildPaymentExport(exported.articles);
  const p = current.payments[0];
  const confirmation = validateConfirmation({
    batchId: current.batchId,
    exportedAt: current.createdAt,
    payment: p,
    expectedMessage: p.message,
    receipt: { ...receipt, message: p.message },
  });
  const dispose = installPaymentHelperConnection({
    document: w.document as any,
    currentBatch: () => current,
    record: (input) => write("recordBankPayment", input),
    onRecorded: vi.fn(),
  });
  const connection = {
    ...JSON.parse(
      w.document.getElementById("ote-payment-helper-connection")!.textContent!,
    ),
    origin: w.location.origin,
  };
  expect(
    (await writePaymentConfirmation(confirmation, connection)).success,
  ).toBe(true);
  expect(
    (await writePaymentConfirmation(confirmation, connection, true))
      .alreadyRecorded,
  ).toBe(true);
  const result = fromWire(
    await t.query(api.app.read, {
      secret,
      operation: "getArticleById",
      data: { id: articleId },
    }),
  );
  expect(result.article.paymentStatus).toBe(true);
  expect(result.article.paymentBankReference).toBe(receipt.reference);
  expect(result.article.notes).toHaveLength(1);
  dispose();
});

test("background saves receipt before a failed write-back and rejects an unrelated tab, then retries once", async () => {
  vi.resetModules();
  const session: any = {
    pendingPayment: {
      bankTabId: 7,
      watchId: "watch",
      data: { ...data(), receipt: undefined },
      connection: {
        tabId: 8,
        origin: "http://localhost:3000",
        bridgeId: "bridge",
      },
    },
    autoWriteBack: true,
    managerConnection: {
      tabId: 8,
      origin: "http://localhost:3000",
      bridgeId: "bridge",
    },
  };
  const local: any = {};
  const storage = (values: any) => ({
    get: async (keys: any) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((k: any) => [
          k,
          structuredClone(values[k]),
        ]),
      ),
    set: async (value: any) => Object.assign(values, structuredClone(value)),
    remove: async (key: any) => {
      delete values[key];
    },
  });
  const scripting = vi.fn(async () => {
    expect(local.paymentReceipts[receipt.reference]).toBeDefined();
    return [{ result: { success: false, error: "Disconnected fixture" } }];
  });
  vi.stubGlobal("chrome", {
    runtime: {
      id: "test-helper",
      getURL: (s: string) => "chrome-extension://test-helper/" + s,
      onMessage: { addListener: vi.fn() },
    },
    storage: { session: storage(session), local: storage(local) },
    action: { setBadgeText: vi.fn() },
    tabs: {
      get: vi.fn(async () => ({
        id: 8,
        url: "http://localhost:3000/utilities/payment-manager",
      })),
    },
    scripting: { executeScript: scripting },
  });
  const { handleReceiptMessage } =
    await import("../extensions/vancity-payment-helper/background.js");
  const sender = {
    id: "test-helper",
    frameId: 0,
    tab: { id: 7, url: "https://my.vancity.com/banking/fixture" },
  };
  await expect(
    handleReceiptMessage(
      { kind: "ote-bank-receipt", watchId: "watch", receipt },
      { ...sender, tab: { ...sender.tab, id: 9 } },
    ),
  ).rejects.toThrow();
  await expect(
    handleReceiptMessage(
      {
        kind: "ote-bank-receipt",
        watchId: "watch",
        receipt: { ...receipt, amountCents: 3000 },
      },
      sender,
    ),
  ).rejects.toThrow("does not match");
  expect(local.paymentReceipts).toBeUndefined();
  expect(
    await handleReceiptMessage(
      { kind: "ote-bank-receipt", watchId: "watch", receipt },
      sender,
    ),
  ).toEqual({ captured: true, reference: receipt.reference });
  expect(session.pendingPayment).toBeUndefined();
  expect(session.sentArticles[sample.id].reference).toBe(receipt.reference);
  expect(local.paymentReceipts[receipt.reference].error).toContain(
    "Disconnected",
  );
  session.managerConnection.origin = "http://localhost:3001";
  const popup = {
    id: "test-helper",
    url: "chrome-extension://test-helper/popup.html",
  };
  await handleReceiptMessage({ kind: "ote-retry-receipts" }, popup);
  expect(scripting).toHaveBeenCalledOnce();
  session.managerConnection.origin = "http://localhost:3000";
  scripting.mockResolvedValueOnce([
    {
      result: {
        success: true,
        reference: receipt.reference,
        articleIds: [sample.id],
      },
    },
  ]);
  await handleReceiptMessage({ kind: "ote-retry-receipts" }, popup);
  expect(local.paymentReceipts[receipt.reference].synced).toBe(true);
  expect(scripting.mock.calls[1][0].args[2]).toBe(true);
  await handleReceiptMessage({ kind: "ote-retry-receipts" }, popup);
  expect(scripting).toHaveBeenCalledTimes(2);
});
