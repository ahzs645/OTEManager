// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { buildPaymentExport } from "../shared/payment-export";
import { validateConfirmation } from "../extensions/vancity-payment-helper/receipt-contract.js";
import {
  nextUnpaidPayment,
  validateAutoNext,
} from "../extensions/vancity-payment-helper/auto-next.js";

const origin = "https://manager.example.test";
const config = { enabled: true, volume: 33, issue: 2, bankTabId: 7, origin };
const connection = { tabId: 8, origin, bridgeId: "fixture", live: true };
const popup = { id: "helper", url: "chrome-extension://helper/popup.html" };
const sender = {
  id: "helper",
  frameId: 0,
  tab: { id: 7, url: "https://my.vancity.com/banking/fixture" },
};
const sample = {
  id: "first",
  title: "First synthetic article",
  articleTier: "Tier 1 (Basic)",
  paymentStatus: false,
  paymentAmount: 2000,
  paymentIsManual: true,
  paymentRateSnapshot: null,
  author: {
    id: "writer",
    givenName: "Synthetic",
    surname: "Writer",
    email: "writer@example.test",
    etransferEmail: "writer@example.test",
    authorType: "Student",
    autoDepositAvailable: false,
  },
  issue: null,
  volume: 33,
  issueNumber: 2,
};
const batch = buildPaymentExport([
  sample,
  { ...sample, id: "second", title: "Second synthetic article" },
  { ...sample, id: "third", title: "Third synthetic article" },
]);
const confirmation = (
  p = batch.payments[0],
  reference = "20260102030405000001",
) =>
  validateConfirmation({
    batchId: batch.batchId,
    exportedAt: batch.createdAt,
    payment: p,
    expectedMessage: p.message,
    receipt: {
      bank: "Vancity",
      status: "sent",
      currency: "CAD",
      reference,
      recipientName: "Synthetic bank name",
      recipientEmail: p.recipientEmail,
      amountCents: p.amountCents,
      feeCents: 0,
      message: p.message,
      transferDate: "2 Jan 2026",
      receiptDate: "2 Jan 2026 - 03:04",
      sourceAccountLastFour: "1234",
    },
  });
const original = confirmation();
let session: Record<string, any>, local: Record<string, any>;
let scripting: ReturnType<typeof vi.fn>, updateTab: ReturnType<typeof vi.fn>;
let handle: (message: any, sender: any) => Promise<any>;
let catalog: any;
let write: () => Promise<any>;
let bank: (action: string) => Promise<any>;
const actions = () =>
  scripting.mock.calls
    .filter(([r]) => r.func.name === "executeBankAction")
    .map(([r]) => r.args[0]);
const storage = (data: Record<string, any>) => ({
  async get(keys: string | string[]) {
    return Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys]).map((k) => [
        k,
        structuredClone(data[k]),
      ]),
    );
  },
  async set(value: any) {
    Object.assign(data, structuredClone(value));
  },
  async remove(key: string) {
    delete data[key];
  },
});
async function loadWorker() {
  vi.resetModules();
  handle = (await import("../extensions/vancity-payment-helper/background.js"))
    .handleReceiptMessage;
  await handle({ kind: "ote-auto-next-status" }, popup);
}
async function capture() {
  return handle(
    { kind: "ote-bank-receipt", watchId: "watch", receipt: original.receipt },
    sender,
  );
}
beforeEach(async () => {
  session = {
    autoWriteBack: true,
    managerConnection: structuredClone(connection),
    pendingPayment: {
      bankTabId: 7,
      watchId: "watch",
      connection: structuredClone(connection),
      autoNext: structuredClone(config),
      data: { ...original, receipt: undefined },
    },
  };
  local = {
    autoNextConfig: structuredClone(config),
    liveMode: true,
    managerSiteUrl: origin,
    securityPreset: {
      question: "Synthetic test question?",
      answer: "fixture-answer",
    },
    defaultSourceAccount: {
      name: "Test payments",
      type: "Chequing",
      accountNumber: "111111111234",
    },
  };
  catalog = structuredClone(batch); // Includes the just-sent article to exercise the durable exclusion.
  write = async () => ({
    success: true,
    reference: original.receipt.reference,
    articleIds: [sample.id],
  });
  bank = async (action) => ({
    status: (
      {
        "leave-recorded-receipt": "navigated",
        prepare: "filled",
        "open-review": "reviewed",
      } as any
    )[action],
  });
  scripting = vi.fn(async ({ func, args }) => {
    if (func.name === "readLivePayments")
      return [
        {
          result: {
            status: "connected",
            connection,
            ...(args[0].connectionOnly
              ? {}
              : {
                  batch: catalog,
                  publications: [{ volume: 33, issues: [2] }],
                }),
          },
        },
      ];
    if (func.name === "writePaymentConfirmation")
      return [{ result: await write() }];
    if (func.name === "executeBankAction")
      return [{ result: await bank(args[0]) }];
    if (func.name === "watchBankReceipt")
      return [{ result: { status: "watching" } }];
    throw new Error(`Unexpected injected script ${func.name}`);
  });
  updateTab = vi.fn(async () => ({}));
  vi.stubGlobal("chrome", {
    runtime: {
      id: "helper",
      getURL: (s: string) => "chrome-extension://helper/" + s,
      onMessage: { addListener: vi.fn() },
    },
    storage: { local: storage(local), session: storage(session) },
    action: { setBadgeText: vi.fn(async () => {}) },
    permissions: { contains: vi.fn(async () => true) },
    tabs: {
      get: vi.fn(async (id) => ({
        id,
        url: id === 7 ? sender.tab.url : `${origin}/utilities/payment-manager`,
      })),
      query: vi.fn(async () => [
        { id: 8, url: `${origin}/utilities/payment-manager` },
      ]),
      update: updateTab,
    },
    scripting: { executeScript: scripting },
  });
  await loadWorker();
});
afterEach(() => vi.unstubAllGlobals());

test("waits for durable OTE recording, refreshes the exact issue, arms capture, then opens Review with saved presets", async () => {
  let resolveWrite!: (v: any) => void;
  write = () =>
    new Promise((resolve) => {
      resolveWrite = resolve;
    });
  const recording = capture();
  await vi.waitFor(() => expect(resolveWrite).toBeDefined());
  expect(local.paymentReceipts[original.receipt.reference].synced).toBe(false);
  expect(actions()).toEqual([]);
  resolveWrite({
    success: true,
    reference: original.receipt.reference,
    articleIds: [sample.id],
  });
  await recording;
  expect(local.paymentReceipts[original.receipt.reference].synced).toBe(true);
  expect(actions()).toEqual([
    "leave-recorded-receipt",
    "prepare",
    "open-review",
  ]);
  const request = scripting.mock.calls.find(
    ([r]) => r.func.name === "readLivePayments" && !r.args[0].connectionOnly,
  )![0];
  expect(request.args[0]).toEqual({
    volume: 33,
    issue: 2,
    grouping: "article",
    search: "",
  });
  const prepared = scripting.mock.calls.find(
    ([r]) => r.func.name === "executeBankAction" && r.args[0] === "prepare",
  )![0];
  expect(prepared.args.slice(1, 5)).toEqual([
    {
      recipientName: batch.payments[1].recipientName,
      recipientEmail: batch.payments[1].recipientEmail,
      amountCents: 2000,
    },
    batch.payments[1].message,
    local.securityPreset,
    local.defaultSourceAccount,
  ]);
  const watched = scripting.mock.calls.findIndex(
    ([r]) => r.func.name === "watchBankReceipt",
  );
  const reviewed = scripting.mock.calls.findIndex(
    ([r]) => r.func.name === "executeBankAction" && r.args[0] === "open-review",
  );
  expect(watched).toBeLessThan(reviewed);
  expect(session.pendingPayment.data.payment.articles[0].id).toBe("second");
  expect(session.pendingPayment.autoNext).toEqual(config);
  expect(session.selectedId).toBe(batch.payments[1].id);
  expect(session.autoNextStatus.phase).toBe("review");
  expect(updateTab).toHaveBeenCalledWith(7, { active: true });
  delete session.pendingPayment;
  await handle({ kind: "ote-start-next" }, popup);
  await handle({ kind: "ote-retry-receipts" }, popup);
  await loadWorker();
  await handle({ kind: "ote-start-next" }, popup);
  expect(actions()).toHaveLength(3); // A receipt never repeats its bank steps.
});

test("failed write-back never advances; a successful durable retry advances once", async () => {
  write = async () => ({ success: false, error: "Fixture app unavailable" });
  await capture();
  expect(actions()).toEqual([]);
  expect(session.pendingPayment).toBeUndefined();
  expect(local.paymentReceipts[original.receipt.reference].synced).toBe(false);
  write = async () => ({
    success: true,
    reference: original.receipt.reference,
    articleIds: [sample.id],
  });
  await handle({ kind: "ote-retry-receipts" }, popup);
  expect(actions()).toEqual([
    "leave-recorded-receipt",
    "prepare",
    "open-review",
  ]);
  await handle({ kind: "ote-retry-receipts" }, popup);
  expect(actions()).toHaveLength(3);
});

test("each new user-confirmed receipt advances one article and the final receipt ends the sequence", async () => {
  const inject = scripting.getMockImplementation()!;
  scripting.mockImplementation(async (request) => {
    if (request.func.name === "writePaymentConfirmation") {
      const data = request.args[0];
      return [
        {
          result: {
            success: true,
            reference: data.receipt.reference,
            articleIds: data.payment.articles.map((a: any) => a.id),
          },
        },
      ];
    }
    return inject(request);
  });
  await capture();
  expect(session.pendingPayment.data.payment.articles[0].id).toBe("second");
  const second = confirmation(batch.payments[1], "20260102030405000002");
  await handle(
    {
      kind: "ote-bank-receipt",
      watchId: session.pendingPayment.watchId,
      receipt: second.receipt,
    },
    sender,
  );
  expect(session.pendingPayment.data.payment.articles[0].id).toBe("third");
  expect(actions()).toHaveLength(6);
  const third = confirmation(batch.payments[2], "20260102030405000003");
  await handle(
    {
      kind: "ote-bank-receipt",
      watchId: session.pendingPayment.watchId,
      receipt: third.receipt,
    },
    sender,
  );
  expect(session.pendingPayment).toBeUndefined();
  expect(session.autoNextStatus.phase).toBe("complete");
  expect(actions()).toHaveLength(6);
  expect(Object.values(local.paymentReceipts).every((e: any) => e.synced)).toBe(
    true,
  );
});

test("Stop during a bank step prevents the following step and leaves the old payment recorded", async () => {
  bank = async (action) => {
    if (action === "prepare") local.autoNextConfig.enabled = false;
    return { status: action === "prepare" ? "filled" : "navigated" };
  };
  await capture();
  expect(actions()).toEqual(["leave-recorded-receipt", "prepare"]);
  expect(session.pendingPayment).toBeUndefined();
  expect(session.autoNextStatus.phase).toBe("paused");
  expect(local.paymentReceipts[original.receipt.reference].synced).toBe(true);
  expect(local.paymentReceipts[original.receipt.reference].error).toBe("");
});

test.each(["disabled", "other-issue", "other-origin", "other-tab"])(
  "automatic continuation stops on %s settings",
  async (mode) => {
    if (mode === "disabled") local.autoNextConfig.enabled = false;
    if (mode === "other-issue") local.autoNextConfig.issue = 3;
    if (mode === "other-origin")
      local.managerSiteUrl = "https://other.example.test";
    if (mode === "other-tab") local.autoNextConfig.bankTabId = 9;
    await capture();
    expect(actions()).toEqual([]);
  },
);

test("a preparation error does not undo recording and cannot replay a started bank flow", async () => {
  bank = async () => ({ status: "error", message: "Sign back into Vancity" });
  await capture();
  const entry = local.paymentReceipts[original.receipt.reference];
  expect(entry.synced).toBe(true);
  expect(entry.error).toBe("");
  expect(entry.nextPreparation).toMatchObject({
    phase: "error",
    bankStarted: true,
  });
  expect(session.autoNextStatus.message).toContain("Sign back");
  await handle({ kind: "ote-start-next" }, popup);
  expect(actions()).toHaveLength(1);
});

test("worker restart releases stale progress but retains the no-replay claim", async () => {
  await capture();
  delete session.pendingPayment;
  local.paymentReceipts[original.receipt.reference].nextPreparation.phase =
    "preparing";
  session.autoNextStatus = {
    phase: "preparing",
    reference: original.receipt.reference,
  };
  scripting.mockClear();
  await loadWorker();
  expect(session.autoNextStatus.phase).toBe("error");
  expect(session.autoNextStatus.message).toContain("interrupted");
  await handle({ kind: "ote-start-next" }, popup);
  expect(actions()).toEqual([]);
});

test("empty and excluded queues finish without any bank navigation", async () => {
  catalog = {
    ...batch,
    payments: [],
    skipped: [{ reason: "Needs attention" }],
  };
  await capture();
  expect(actions()).toEqual([]);
  expect(session.autoNextStatus.phase).toBe("complete");
  expect(session.autoNextStatus.message).toContain("1 excluded");
});

test("a pending payment prevents starting another preparation", async () => {
  local.paymentReceipts = {
    [original.receipt.reference]: {
      data: original,
      synced: true,
      capturedAt: new Date().toISOString(),
      connection,
    },
  };
  const result = await handle({ kind: "ote-start-next" }, popup);
  expect(result.error).toContain("already waiting");
  expect(actions()).toEqual([]);
});

test("enabling the option on an existing Review updates only its matching pending context", async () => {
  delete session.pendingPayment.autoNext;
  const unchanged = structuredClone(session.pendingPayment.data);
  await handle({ kind: "ote-update-next-scope" }, popup);
  expect(session.pendingPayment.autoNext).toEqual(config);
  expect(session.pendingPayment.data).toEqual(unchanged);
  expect(actions()).toEqual([]);
  delete session.pendingPayment;
  await handle({ kind: "ote-update-next-scope" }, popup);
  expect(session.pendingPayment).toBeUndefined();
});

test("a Sent-detail check corroborates a saved receipt, clears only its stale pending context, and does not prepare or write another payment", async () => {
  local.paymentReceipts = {
    [original.receipt.reference]: {
      data: original,
      synced: true,
      capturedAt: new Date().toISOString(),
      connection,
    },
  };
  const inject = scripting.getMockImplementation()!;
  scripting.mockImplementation(async (request) =>
    request.func.name === "readSentTransfer"
      ? [
          {
            result: {
              status: "history-detail",
              detail: {
                recipientName: "Synthetic alias",
                recipientEmail: original.receipt.recipientEmail,
                amountCents: original.receipt.amountCents,
                message: original.receipt.message,
                sourceAccountLastFour: original.receipt.sourceAccountLastFour,
                transactionDate: "2 Jan 2026 03:04",
                bankStatus: "Pending",
              },
            },
          },
        ]
      : inject(request),
  );
  const result = await handle(
    { kind: "ote-match-sent-transfer", bankTabId: 7 },
    popup,
  );
  expect(result.reference).toBe(original.receipt.reference);
  expect(result.message).toContain("Already recorded in OTEManager");
  expect(session.pendingPayment).toBeUndefined();
  expect(
    local.paymentReceipts[original.receipt.reference].historyCheck.bankStatus,
  ).toBe("Pending");
  expect(scripting.mock.calls.map(([r]) => r.func.name)).toEqual([
    "readSentTransfer",
  ]);
  session.pendingPayment = {
    data: {
      ...original,
      payment: {
        ...original.payment,
        articles: [
          { ...original.payment.articles[0], id: "different-article" },
        ],
      },
    },
  };
  await handle({ kind: "ote-match-sent-transfer", bankTabId: 7 }, popup);
  expect(session.pendingPayment).toBeDefined();
});

test("fresh queue excludes captured and manually recorded articles, and refuses wrong scope or warnings", () => {
  expect(
    nextUnpaidPayment(
      batch,
      config,
      { x: { data: original, synced: false } },
      { second: {} },
    )?.articles[0].id,
  ).toBe("third");
  const wrong = structuredClone(batch);
  wrong.payments[1].articles[0].issue = "Vol 33, Issue 3";
  expect(() => nextUnpaidPayment(wrong, config, {})).toThrow("outside");
  const warned = structuredClone(batch);
  warned.payments[0].warnings.push("Review email");
  expect(() => nextUnpaidPayment(warned, config, {})).toThrow("Review email");
  expect(() =>
    nextUnpaidPayment({ ...batch, grouping: "author" }, config, {}),
  ).toThrow("outside");
  expect(() =>
    validateAutoNext({ ...config, origin: "https://my.vancity.com" }),
  ).toThrow();
  expect(() => validateAutoNext({ ...config, volume: 0 })).toThrow();
});
