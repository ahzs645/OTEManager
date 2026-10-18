// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { Window } from "happy-dom";
import {
  managerSite,
  requestManager,
} from "../extensions/vancity-payment-helper/manager-client.js";
import {
  readLivePayments,
  writePaymentConfirmation,
} from "../extensions/vancity-payment-helper/manager-page.js";
import { installPaymentHelperConnection } from "../app/lib/payment-helper-connection";
import { buildLivePaymentCatalog } from "../shared/payment-export";
let page: Window;
const article = {
  id: "live-article",
  title: "Campus story",
  articleTier: "Tier 1 (Basic)",
  paymentStatus: false,
  paymentAmount: 2000,
  paymentIsManual: true,
  paymentRateSnapshot: null,
  author: {
    id: "live-author",
    givenName: "Live",
    surname: "Writer",
    email: "live@example.test",
    etransferEmail: "pay@example.test",
    authorType: "Student",
    autoDepositAvailable: true,
  },
  issue: null,
  volume: 33,
  issueNumber: 2,
};
const filters = {
  grouping: "article" as const,
  volume: null,
  issue: null,
  search: "",
};
afterEach(() => {
  vi.unstubAllGlobals();
  page?.happyDOM.abort();
});
function setup() {
  page = new Window({
    url: "https://manager.example.test/utilities/payment-manager",
  });
  for (const [key, value] of Object.entries({
    document: page.document,
    location: page.location,
    MutationObserver: page.MutationObserver,
    CustomEvent: page.CustomEvent,
    window: page,
  }))
    vi.stubGlobal(key, value);
}
test.each([
  "https://user:pass@manager.test",
  "http://manager.test",
  "https://my.vancity.com",
  "file:///tmp/test",
  "javascript:alert(1)",
])("rejects unsuitable manager URLs: %s", (url) => {
  expect(() => managerSite(url)).toThrow();
});
test("normalizes routes and pins a localhost port", () => {
  expect(managerSite("http://localhost:4174/articles?status=Draft").url).toBe(
    "http://localhost:4174/utilities/payment-manager",
  );
  expect(managerSite("https://manager.test/path").permission).toBe(
    "https://manager.test/*",
  );
});
test("live catalog uses preferred email, filters publication/author, and does not include paid records", () => {
  const catalog = buildLivePaymentCatalog(
    [
      article,
      { ...article, id: "other", volume: 34 },
      { ...article, id: "paid", paymentStatus: true },
    ],
    { ...filters, volume: 33, issue: 2, search: "writer" },
  );
  expect(catalog.batch.payments.map((p) => p.id)).toEqual(["live-article"]);
  expect(catalog.batch.payments[0].recipientEmail).toBe("pay@example.test");
  expect(catalog.publications).toEqual([
    { volume: 34, issues: [2] },
    { volume: 33, issues: [2] },
  ]);
  expect(() =>
    buildLivePaymentCatalog([article], { ...filters, volume: -1 }),
  ).toThrow();
});

test("partial settings and HTML select strings normalize into valid live filters", () => {
  expect(
    buildLivePaymentCatalog([article], {} as any).batch.payments,
  ).toHaveLength(1);
  expect(
    buildLivePaymentCatalog([article], {
      grouping: "article",
      volume: "33",
      issue: "2",
      search: "",
    } as any).batch.payments,
  ).toHaveLength(1);
  expect(
    buildLivePaymentCatalog([article], {
      grouping: "article",
      volume: "",
      issue: "",
    } as any).batch.payments,
  ).toHaveLength(1);
  expect(() =>
    buildLivePaymentCatalog([article], { ...filters, volume: "bad" } as any),
  ).toThrow("Invalid live payment filter");
});
test("a live list requires no page preview and its receipt remains matched after another list is loaded", async () => {
  setup();
  const record = vi.fn(async (data) => ({
    success: true as const,
    reference: data.receipt.reference,
    articleIds: [article.id],
    alreadyRecorded: false,
  }));
  const dispose = installPaymentHelperConnection({
    document: page.document as any,
    currentBatch: () => null,
    listPayments: async (f) => buildLivePaymentCatalog([article], f),
    record,
    onRecorded: vi.fn(),
  });
  const result: any = await readLivePayments(filters, page.location.origin);
  expect(result.status).toBe("payments");
  expect(page.document.getElementById("ote-payment-helper-export")).toBeNull();
  await readLivePayments(
    { ...filters, search: "absent" },
    page.location.origin,
  );
  const payment = result.batch.payments[0];
  const receipt = {
    bank: "Vancity",
    status: "sent",
    currency: "CAD",
    reference: "20260102030405000002",
    recipientEmail: payment.recipientEmail,
    recipientName: "Live Writer",
    amountCents: 2000,
    feeCents: 0,
    message: payment.message,
    transferDate: "2 Jan 2026",
    receiptDate: "2 Jan 2026 - 03:04",
    sourceAccountLastFour: "1234",
  };
  const written = await writePaymentConfirmation(
    {
      batchId: result.batch.batchId,
      exportedAt: result.batch.createdAt,
      expectedMessage: payment.message,
      payment,
      receipt,
    },
    { ...result.connection, origin: page.location.origin, live: true },
  );
  expect(written.success).toBe(true);
  expect(record).toHaveBeenCalledOnce();
  expect(page.document.querySelector('[id^="ote-payment-list-"]')).toBeNull();
  dispose();
});
test("live requests reject another origin and explain older page versions", async () => {
  setup();
  expect((await readLivePayments(filters, "https://another.test")).status).toBe(
    "error",
  );
  const dispose = installPaymentHelperConnection({
    document: page.document as any,
    currentBatch: () => null,
    record: vi.fn(),
    onRecorded: vi.fn(),
  });
  expect(
    (await readLivePayments(filters, page.location.origin)).message,
  ).toContain("live-connection update");
  dispose();
});
test("site access is required before any page injection or tab creation", async () => {
  const create = vi.fn();
  const executeScript = vi.fn();
  vi.stubGlobal("chrome", {
    permissions: { contains: vi.fn(async () => false) },
    tabs: { create },
    scripting: { executeScript },
  });
  await expect(
    requestManager(
      managerSite("https://manager.test"),
      filters,
      readLivePayments,
    ),
  ).rejects.toThrow("Connect");
  expect(create).not.toHaveBeenCalled();
  expect(executeScript).not.toHaveBeenCalled();
});

test("receipt retry reconnects a reloaded live page on the original site, and refuses a changed site", async () => {
  vi.resetModules();
  const batch = buildLivePaymentCatalog([article], filters).batch;
  const p = batch.payments[0];
  const reference = "20260102030405000003";
  const origin = "https://manager.example.test";
  const local: any = {
    managerSiteUrl: `${origin}/utilities/payment-manager`,
    liveMode: true,
    paymentReceipts: {
      [reference]: {
        data: {
          batchId: batch.batchId,
          exportedAt: batch.createdAt,
          expectedMessage: p.message,
          payment: p,
          receipt: { reference },
        },
        connection: {
          origin,
          live: true,
          tabId: 8,
          bridgeId: "old-page",
          protocolVersion: 1,
        },
        synced: false,
      },
    },
  };
  const session: any = { autoWriteBack: true };
  const storage = (values: any) => ({
    get: async (keys: any) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((k: string) => [
          k,
          structuredClone(values[k]),
        ]),
      ),
    set: async (v: any) => Object.assign(values, structuredClone(v)),
  });
  const scripting = vi.fn(async ({ func }) => [
    {
      result:
        func.name === "readLivePayments"
          ? {
              status: "connected",
              connection: { protocolVersion: 1, bridgeId: "new-page" },
            }
          : { success: true, reference, articleIds: [article.id] },
    },
  ]);
  vi.stubGlobal("chrome", {
    storage: { session: storage(session), local: storage(local) },
    permissions: { contains: vi.fn(async () => true) },
    tabs: {
      query: vi.fn(async () => []),
      create: vi.fn(async () => ({
        id: 9,
        url: `${origin}/utilities/payment-manager`,
      })),
      get: vi.fn(async () => ({
        id: 9,
        url: `${origin}/utilities/payment-manager`,
      })),
    },
    scripting: { executeScript: scripting },
    action: { setBadgeText: vi.fn() },
    runtime: {
      id: "helper",
      getURL: (s: string) => `chrome-extension://helper/${s}`,
      onMessage: { addListener: vi.fn() },
    },
  });
  const { handleReceiptMessage } =
    await import("../extensions/vancity-payment-helper/background.js");
  const sender = { id: "helper", url: "chrome-extension://helper/popup.html" };
  await handleReceiptMessage({ kind: "ote-retry-receipts" }, sender);
  expect(local.paymentReceipts[reference].synced).toBe(true);
  expect(session.managerConnection.bridgeId).toBe("new-page");
  expect(scripting.mock.calls[1][0].args[2]).toBe(true);
  local.paymentReceipts[reference].synced = false;
  local.managerSiteUrl = "https://other-manager.test";
  await handleReceiptMessage({ kind: "ote-retry-receipts" }, sender);
  expect(scripting).toHaveBeenCalledTimes(2);
  expect(local.paymentReceipts[reference].error).toContain(
    "original OTEManager",
  );
});
