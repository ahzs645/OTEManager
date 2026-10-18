// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { buildPaymentExport } from "../shared/payment-export";

let window: Window;
let session: Record<string, any>;
let local: Record<string, any>;
let scripting: ReturnType<typeof vi.fn>;
let getTab: ReturnType<typeof vi.fn>;
let queryTabs: ReturnType<typeof vi.fn>;
let runtimeMessage: ReturnType<typeof vi.fn>;
const el = (id: string) => window.document.getElementById(id) as any;
const sample = {
  id: "popup-article",
  title: "Synthetic story",
  articleTier: "Tier 1 (Basic)",
  paymentStatus: false,
  paymentAmount: 2000,
  paymentIsManual: true,
  paymentRateSnapshot: null,
  author: {
    id: "popup-author",
    givenName: "Synthetic",
    surname: "Writer",
    email: "sample@example.test",
    etransferEmail: "sample@example.test",
    authorType: "Student",
    autoDepositAvailable: false,
  },
  issue: null,
  volume: 34,
  issueNumber: 1,
};
function storage(data: Record<string, any>) {
  return {
    async get(keys: string | string[]) {
      return Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys])
          .filter((k) => Object.hasOwn(data, k))
          .map((k) => [k, structuredClone(data[k])]),
      );
    },
    async set(values: Record<string, any>) {
      Object.assign(data, structuredClone(values));
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
    async setAccessLevel() {},
  };
}
beforeEach(async () => {
  vi.resetModules();
  window = new Window({ url: "https://isolated.test/popup.html?bankTabId=7" });
  window.document.body.innerHTML = await readFile(
    "extensions/vancity-payment-helper/popup.html",
    "utf8",
  );
  session = {
    batch: buildPaymentExport([sample, { ...sample, id: "popup-article-2" }]),
    securityPreset: {
      question: "Old session question?",
      answer: "old-session",
    },
  };
  local = { securityVault: { ciphertext: "obsolete-encrypted-preset" } };
  scripting = vi.fn(async () => [
    { result: { status: "matched", message: "Fixture contact found" } },
  ]);
  getTab = vi.fn(async () => ({
    id: 7,
    url: "https://my.vancity.com/banking/fixture",
  }));
  queryTabs = vi.fn(async () => [
    { id: 8, url: "http://localhost:3000/utilities/payment-manager" },
  ]);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("location", window.location);
  vi.stubGlobal("chrome", {
    storage: { session: storage(session), local: storage(local) },
    tabs: { get: getTab, query: queryTabs, create: vi.fn() },
    scripting: { executeScript: scripting },
    permissions: {
      request: vi.fn(async () => true),
      contains: vi.fn(async () => true),
      remove: vi.fn(async () => true),
    },
    runtime: {
      getURL: (path: string) => `https://isolated.test/${path}`,
      sendMessage: (runtimeMessage = vi.fn(async () => ({ watching: true }))),
    },
  });
  await import("../extensions/vancity-payment-helper/popup.js");
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.happyDOM.abort();
});

test("one-click preparation runs directly and targets only the connected bank tab", async () => {
  const prepare = window.document.querySelector(
    '[data-action="prepare"]',
  ) as any;
  expect(prepare.disabled).toBe(false);
  expect(el("reviewed")).toBeNull();
  expect(el("message-length")).toBeNull();
  prepare.click();
  await vi.waitFor(() => expect(scripting).toHaveBeenCalledOnce());
  expect(getTab).toHaveBeenCalledWith(7);
  expect(scripting.mock.calls[0][0].target).toEqual({ tabId: 7 });
  expect(scripting.mock.calls[0][0].args[0]).toBe("prepare");
  expect(scripting.mock.calls[0][0].args[3]).toBeNull();
});

test("bulk lookup checks unique emails and does not pass security secrets or prepare forms", async () => {
  el("bulk-check").click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("Contact check complete"),
  );
  expect(scripting).toHaveBeenCalledOnce();
  expect(scripting.mock.calls[0][0].args[0]).toBe("search");
  expect(scripting.mock.calls[0][0].args[3]).toBeNull();
  expect(session.contactChecks["sample@example.test"].status).toBe("matched");
});

test("missing-contact creation is offered after scanning, deduplicates emails, and uses only contact actions", async () => {
  expect(el("bulk-create").hidden).toBe(true);
  scripting.mockResolvedValueOnce([
    { result: { status: "no-match", message: "Missing" } },
  ]);
  el("bulk-check").click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("Contact check complete"),
  );
  expect(el("bulk-create").textContent).toBe("Create 1 missing contact");
  expect(scripting).toHaveBeenCalledOnce();
  local.securityPreset = {
    question: "Test question?",
    answer: "fixture-answer",
  };
  scripting.mockResolvedValueOnce([
    { result: { status: "created", message: "Created and verified" } },
  ]);
  el("bulk-create").click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("1 created and verified"),
  );
  const request = scripting.mock.calls[1][0];
  expect(request.args[0]).toBe("ensure-contact");
  expect(request.args[2]).toBe("");
  expect(request.args[3]).toEqual(local.securityPreset);
  expect(request.args[4]).toBeNull();
  expect(session.contactChecks["sample@example.test"].status).toBe("created");
  expect(runtimeMessage).not.toHaveBeenCalled();
  expect(el("bulk-create").hidden).toBe(true);
});

test("a bank error stops the contact queue and keeps completed results instead of opening another form", async () => {
  session.batch = buildPaymentExport([
    sample,
    {
      ...sample,
      id: "other",
      author: {
        ...sample.author,
        id: "other-author",
        email: "other@example.test",
        etransferEmail: "other@example.test",
      },
    },
  ]);
  session.contactChecks = {
    "sample@example.test": { status: "no-match" },
    "other@example.test": { status: "no-match" },
  };
  vi.resetModules();
  window.document.body.innerHTML = await readFile(
    "extensions/vancity-payment-helper/popup.html",
    "utf8",
  );
  await import("../extensions/vancity-payment-helper/popup.js");
  scripting.mockResolvedValueOnce([
    { result: { status: "error", message: "Bank needs extra verification" } },
  ]);
  el("bulk-create").click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("Stopped at"),
  );
  expect(scripting).toHaveBeenCalledOnce();
  expect(session.contactChecks["sample@example.test"].status).toBe("error");
  expect(session.contactChecks["other@example.test"].status).toBe("no-match");
  expect(runtimeMessage).not.toHaveBeenCalled();
});

test("upgrade removes the old encrypted preset and its session copy", () => {
  expect(local.securityVault).toBeUndefined();
  expect(session.securityPreset).toBeUndefined();
  expect(el("unlock")).toBeNull();
  expect(el("preset-passphrase")).toBeNull();
});

test("question and answer persist on this device and load without unlocking", async () => {
  const question = "Synthetic test question?",
    answer = "test-answer-only";
  el("preset-question").value = question;
  el("preset-answer").value = answer;
  el("save-preset").click();
  await vi.waitFor(() =>
    expect(el("preset-status").textContent).toContain("Ready to use"),
  );
  expect(local).toEqual({ securityPreset: { question, answer } });
  expect(session.securityPreset).toBeUndefined();
  expect(el("preset-answer").value).toBe(answer);
  expect(el("preset-answer").type).toBe("password");

  vi.resetModules();
  window.document.body.innerHTML = await readFile(
    "extensions/vancity-payment-helper/popup.html",
    "utf8",
  );
  await import("../extensions/vancity-payment-helper/popup.js");
  expect(el("preset-status").textContent).toContain("Ready to use");
  expect(el("preset-question").value).toBe(question);
  expect(el("preset-answer").value).toBe(answer);
  expect(el("preset-answer").type).toBe("password");
  (window.document.querySelector('[data-action="prepare"]') as any).click();
  await vi.waitFor(() => expect(scripting).toHaveBeenCalledOnce());
  expect(scripting.mock.calls[0][0].args[3]).toEqual({ question, answer });

  el("forget-preset").click();
  await vi.waitFor(() => expect(local.securityPreset).toBeUndefined());
  await vi.waitFor(() =>
    expect(el("preset-status").textContent).toContain("No answer saved"),
  );
  expect(el("preset-answer").value).toBe("");
  expect(el("show-preset").disabled).toBe(true);
});

test("an already open workspace uses the current saved preset after it is removed", async () => {
  local.securityPreset = { question: "Question?", answer: "test-only" };
  const prepare = window.document.querySelector(
    '[data-action="prepare"]',
  ) as any;
  prepare.click();
  await vi.waitFor(() => expect(scripting).toHaveBeenCalledTimes(1));
  expect(scripting.mock.calls[0][0].args[3]).toEqual(local.securityPreset);
  delete local.securityPreset;
  await vi.waitFor(() => expect(prepare.disabled).toBe(false));
  prepare.click();
  await vi.waitFor(() => expect(scripting).toHaveBeenCalledTimes(2));
  expect(scripting.mock.calls[1][0].args[3]).toBeNull();
});

test("remembers the current bank account without storing its balance and passes it only to preparation", async () => {
  const account = {
    accountNumber: "111111118874",
    name: "Test Payments",
    type: "Chequing Account",
  };
  scripting.mockResolvedValueOnce([
    {
      result: {
        status: "account",
        account: { ...account, availableBalance: "250" },
        message: "Read",
      },
    },
  ]);
  el("use-current-account").click();
  await vi.waitFor(() => expect(local.defaultSourceAccount).toEqual(account));
  await vi.waitFor(() =>
    expect(el("account-status").textContent).toContain("ending 8874"),
  );
  expect(scripting.mock.calls[0][0].args.slice(3)).toEqual([null, null]);
  vi.resetModules();
  window.document.body.innerHTML = await readFile(
    "extensions/vancity-payment-helper/popup.html",
    "utf8",
  );
  await import("../extensions/vancity-payment-helper/popup.js");
  expect(el("source-account").value).toBe(account.accountNumber);
  (window.document.querySelector('[data-action="prepare"]') as any).click();
  await vi.waitFor(() => expect(scripting).toHaveBeenCalledTimes(2));
  expect(scripting.mock.calls[1][0].args[4]).toEqual(account);
  await vi.waitFor(() => expect(el("bulk-check").disabled).toBe(false));
  el("bulk-check").click();
  await vi.waitFor(() => expect(scripting).toHaveBeenCalledTimes(3));
  expect(scripting.mock.calls[2][0].args.slice(3)).toEqual([null, null]);
});

test("account lookup offers current balances and saves only the chosen account identity", async () => {
  const account = {
    accountNumber: "111111118874",
    name: "Test Payments",
    type: "Chequing Account",
  };
  scripting.mockResolvedValueOnce([
    {
      result: {
        status: "accounts",
        accounts: [{ ...account, availableBalance: "250" }],
        message: "Read",
      },
    },
  ]);
  el("read-accounts").click();
  await vi.waitFor(() =>
    expect(el("source-account").textContent).toContain("available CAD $250"),
  );
  await vi.waitFor(() => expect(el("save-account").disabled).toBe(false));
  el("source-account").value = account.accountNumber;
  el("save-account").click();
  await vi.waitFor(() => expect(local.defaultSourceAccount).toEqual(account));
  await vi.waitFor(() => expect(el("forget-account").disabled).toBe(false));
  el("forget-account").click();
  await vi.waitFor(() => expect(local.defaultSourceAccount).toBeUndefined());
});

test("workspace refuses an unrelated tab before any bank script runs", async () => {
  getTab.mockResolvedValueOnce({ id: 7, url: "https://outside.test/" });
  el("navigate").click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("Select your Vancity"),
  );
  expect(scripting).not.toHaveBeenCalled();
});

test("a persistent sidebar can connect a Chrome-redacted bank tab through an exact-origin permission request and prepare on it", async () => {
  window.location.href = "https://isolated.test/popup.html";
  getTab.mockResolvedValue({ id: 7 });
  queryTabs.mockResolvedValue([{ id: 17 }]);
  vi.mocked(chrome.permissions.contains).mockResolvedValue(false);
  local.securityPreset = {
    question: "Synthetic sidebar question?",
    answer: "fixture-only",
  };
  local.paymentReceipts = {
    unrelated: {
      data: {
        payment: { articles: [{ id: "unrelated" }] },
        receipt: { reference: "20260102030405000001" },
      },
      capturedAt: new Date().toISOString(),
      synced: true,
    },
  };
  const preserved = structuredClone(local);
  vi.resetModules();
  window.document.body.innerHTML = await readFile(
    "extensions/vancity-payment-helper/popup.html",
    "utf8",
  );
  await import("../extensions/vancity-payment-helper/popup.js");
  expect(window.document.body.classList.contains("sidepanel")).toBe(true);
  expect(el("connection-status").textContent).toContain(
    "Click Connect Vancity",
  );
  expect(el("connect-bank").textContent).toBe("Connect Vancity");
  expect(scripting).not.toHaveBeenCalled();
  vi.mocked(chrome.permissions.request).mockImplementationOnce(
    async (request) => {
      expect(request).toEqual({ origins: ["https://my.vancity.com/*"] });
      queryTabs.mockResolvedValue([
        { id: 17, url: "https://my.vancity.com/banking/home" },
      ]);
      getTab.mockResolvedValue({
        id: 17,
        url: "https://my.vancity.com/banking/home",
      });
      return true;
    },
  );
  el("connect-bank").click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("Vancity connected"),
  );
  expect(session.bankTabId).toBe(17);
  expect(el("connection-status").textContent).toContain(
    "Vancity tab connected",
  );
  expect(local.securityPreset).toEqual(preserved.securityPreset);
  expect(local.paymentReceipts).toEqual(preserved.paymentReceipts);
  scripting
    .mockResolvedValueOnce([
      { result: { status: "filled", message: "Fixture form ready" } },
    ])
    .mockResolvedValueOnce([
      { result: { status: "reviewed", message: "Fixture Review ready" } },
    ]);
  (window.document.querySelector('[data-action="prepare"]') as any).click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("Fixture Review ready"),
  );
  expect(
    scripting.mock.calls.map(([r]) => [r.target.tabId, r.args[0]]),
  ).toEqual([
    [17, "prepare"],
    [17, "open-review"],
  ]);
});

test("declining the Vancity permission leaves bank scripts and saved data untouched", async () => {
  vi.mocked(chrome.permissions.request).mockResolvedValueOnce(false);
  const saved = structuredClone(local);
  el("connect-bank").click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("access was not allowed"),
  );
  expect(scripting).not.toHaveBeenCalled();
  expect(local).toEqual(saved);
});

test("bank connection cannot replace another pending transfer's tab or scope", async () => {
  session.pendingPayment = {
    bankTabId: 7,
    data: { payment: { amountCents: 2000 } },
  };
  queryTabs.mockResolvedValue([
    { id: 17, url: "https://my.vancity.com/banking/home" },
  ]);
  local.autoNextConfig = {
    enabled: true,
    volume: 33,
    issue: 2,
    bankTabId: 7,
    origin: "https://manager.example.test",
  };
  const config = structuredClone(local.autoNextConfig);
  el("connect-bank").click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain(
      "waiting on the previous bank tab",
    ),
  );
  expect(session.bankTabId).toBe(7);
  expect(local.autoNextConfig).toEqual(config);
  expect(scripting).not.toHaveBeenCalled();
});

test("Chrome injection permission errors point to Connect Vancity and do not keep retrying", async () => {
  scripting.mockRejectedValueOnce(
    new Error(
      "Cannot access contents of url. Extension manifest must request permission.",
    ),
  );
  el("navigate").click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("Click Connect Vancity"),
  );
  expect(scripting).toHaveBeenCalledOnce();
});

test("removing the optional Vancity grant stops automatic preparation and preserves receipt and preset data", async () => {
  local.autoNextConfig = {
    enabled: true,
    volume: 33,
    issue: 2,
    bankTabId: 7,
    origin: "https://manager.example.test",
  };
  local.securityPreset = {
    question: "Synthetic question?",
    answer: "fixture-only",
  };
  local.paymentReceipts = {
    fixture: {
      data: {
        payment: { articles: [{ id: "unrelated" }] },
        receipt: { reference: "20260102030405000001" },
      },
      capturedAt: new Date().toISOString(),
      synced: true,
    },
  };
  const saved = structuredClone(local);
  el("remove-bank-access").click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("Removed Vancity site access"),
  );
  expect(chrome.permissions.remove).toHaveBeenCalledWith({
    origins: ["https://my.vancity.com/*"],
  });
  expect(local.autoNextConfig.enabled).toBe(false);
  expect(local.securityPreset).toEqual(saved.securityPreset);
  expect(local.paymentReceipts).toEqual(saved.paymentReceipts);
  expect(scripting).not.toHaveBeenCalled();
});

test("direct local import reads only the selected OTE data and retains the connected bank tab", async () => {
  const batch = session.batch;
  scripting.mockResolvedValueOnce([{ result: { status: "export", batch } }]);
  el("import-manager").click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("directly from OTEManager"),
  );
  expect(scripting.mock.calls[0][0].target).toEqual({ tabId: 8 });
  expect(scripting.mock.calls[0][0].func.name).toBe("readPaymentManagerExport");
  expect(scripting.mock.calls[0][0].args).toBeUndefined();
  await vi.waitFor(() =>
    expect(
      (window.document.querySelector('[data-action="prepare"]') as any)
        .disabled,
    ).toBe(false),
  );
  (window.document.querySelector('[data-action="prepare"]') as any).click();
  await vi.waitFor(() => expect(scripting).toHaveBeenCalledTimes(2));
  expect(scripting.mock.calls[1][0].target).toEqual({ tabId: 7 });
});

test("direct import refuses unrelated pages before injecting an OTE reader", async () => {
  queryTabs.mockResolvedValueOnce([
    { id: 8, url: "http://localhost.evil.test/utilities/payment-manager" },
  ]);
  el("import-manager").click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("local or hosted OTEManager"),
  );
  expect(scripting).not.toHaveBeenCalled();
});

test("connected import enables write-back, and only a successfully filled form arms the immutable receipt context", async () => {
  const batch = session.batch;
  scripting.mockResolvedValueOnce([
    {
      result: {
        status: "export",
        batch,
        connection: { protocolVersion: 1, bridgeId: "test-bridge" },
      },
    },
  ]);
  el("import-manager").click();
  await vi.waitFor(() => expect(session.autoWriteBack).toBe(true));
  expect(session.managerConnection).toEqual({
    protocolVersion: 1,
    bridgeId: "test-bridge",
    tabId: 8,
    origin: "http://localhost:3000",
  });
  await vi.waitFor(() => expect(el("auto-record").disabled).toBe(false));
  scripting
    .mockResolvedValueOnce([
      { result: { status: "filled", message: "Prepared fixture form" } },
    ])
    .mockResolvedValueOnce([
      { result: { status: "reviewed", message: "Opened Review" } },
    ]);
  (window.document.querySelector('[data-action="prepare"]') as any).click();
  await vi.waitFor(() => expect(runtimeMessage).toHaveBeenCalledOnce());
  const packet = runtimeMessage.mock.calls[0][0];
  expect(packet.kind).toBe("ote-arm-receipt");
  expect(packet.bankTabId).toBe(7);
  expect(packet.paymentId).toBe(batch.payments[0].id);
  expect(packet.expectedMessage).toBe(batch.payments[0].message);
  expect(packet.securityPreset).toBeUndefined();
  expect(packet.defaultSourceAccount).toBeUndefined();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("Opened Review"),
  );
  expect(scripting.mock.calls[2][0].args[0]).toBe("open-review");
});

test.each([true, false])(
  "Prepare waits for receipt capture before opening Review (capture succeeds: %s)",
  async (succeeds) => {
    let arm!: (value: any) => void;
    runtimeMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          arm = resolve;
        }),
    );
    scripting
      .mockResolvedValueOnce([
        { result: { status: "filled", message: "Filled fixture" } },
      ])
      .mockResolvedValueOnce([
        { result: { status: "reviewed", message: "Opened Review" } },
      ]);
    (window.document.querySelector('[data-action="prepare"]') as any).click();
    await vi.waitFor(() => expect(runtimeMessage).toHaveBeenCalledOnce());
    expect(scripting).toHaveBeenCalledOnce();
    arm(
      succeeds
        ? { watching: true }
        : { error: "Synthetic receipt capture failure" },
    );
    await vi.waitFor(() =>
      expect(el("status").textContent).toContain(
        succeeds ? "Opened Review" : "capture failure",
      ),
    );
    expect(scripting).toHaveBeenCalledTimes(succeeds ? 2 : 1);
    if (succeeds)
      expect(scripting.mock.calls[1][0].args[0]).toBe("open-review");
  },
);

test("saved receipts block re-preparation after restart and remain available without a batch", async () => {
  local.paymentReceipts = {
    fixture: {
      data: {
        payment: { articles: [{ id: sample.id }] },
        receipt: { reference: "20260102030405000001" },
      },
      capturedAt: new Date().toISOString(),
      synced: false,
    },
  };
  vi.resetModules();
  window.document.body.innerHTML = await readFile(
    "extensions/vancity-payment-helper/popup.html",
    "utf8",
  );
  await import("../extensions/vancity-payment-helper/popup.js");
  expect(
    (window.document.querySelector('[data-action="prepare"]') as any).disabled,
  ).toBe(true);
  expect(el("receipt-status").textContent).toContain("20260102030405000001");
  expect(el("auto-record").checked).toBe(false);
  expect(el("retry-receipts").closest("#work")).toBeNull();
});

test("a successfully recorded article shows its reference instead of asking for reconciliation", async () => {
  local.paymentReceipts = {
    fixture: {
      data: {
        payment: { articles: [{ id: sample.id }] },
        receipt: { reference: "20260102030405000001" },
      },
      capturedAt: new Date().toISOString(),
      synced: true,
    },
  };
  vi.resetModules();
  window.document.body.innerHTML = await readFile(
    "extensions/vancity-payment-helper/popup.html",
    "utf8",
  );
  await import("../extensions/vancity-payment-helper/popup.js");
  expect(el("warnings").textContent).toContain(
    "Already recorded in OTEManager with reference 20260102030405000001",
  );
  expect(el("warnings").textContent).not.toMatch(/reconcile/i);
});

test("window preference is saved through the worker and explains reopening the toolbar", async () => {
  el("settings-tab").click();
  expect(el("helper-surface").value).toBe("sidepanel");
  runtimeMessage.mockResolvedValueOnce({ surface: "popup" });
  el("helper-surface").value = "popup";
  el("save-surface").click();
  await vi.waitFor(() =>
    expect(el("surface-status").textContent).toContain("Popover saved"),
  );
  expect(runtimeMessage).toHaveBeenCalledWith({
    kind: "ote-set-surface",
    surface: "popup",
  });
});

test("Review pauses bank preparation but keeps Settings and receipt checking available", async () => {
  session.pendingPayment = {
    bankTabId: 7,
    data: { payment: { amountCents: 2000 } },
  };
  session.autoNextStatus = { phase: "review", message: "Ready on Review" };
  vi.resetModules();
  window.document.body.innerHTML = await readFile(
    "extensions/vancity-payment-helper/popup.html",
    "utf8",
  );
  await import("../extensions/vancity-payment-helper/popup.js");
  expect(
    (window.document.querySelector('[data-action="prepare"]') as any).disabled,
  ).toBe(true);
  expect(el("pending-status").textContent).toContain(
    "Waiting for Vancity confirmation",
  );
  expect(el("settings-tab").disabled).toBe(false);
  expect(el("check-receipt").disabled).toBe(false);
  expect(el("match-history").disabled).toBe(false);
});

test("connect remembers the chosen site, loads live filters, and prepares only after rechecking the same payment", async () => {
  const batch = session.batch;
  const live = {
    status: "payments",
    batch,
    publications: [{ volume: 34, issues: [1] }],
    connection: { protocolVersion: 1, bridgeId: "live-bridge" },
  };
  queryTabs.mockResolvedValue([
    { id: 8, url: "https://manager.example.test/utilities/payment-manager" },
  ]);
  scripting.mockResolvedValueOnce([{ result: live }]);
  el("manager-url").value = "https://manager.example.test/articles";
  el("connect-live").click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("Choose the volume"),
  );
  expect(local.managerSiteUrl).toBe(
    "https://manager.example.test/utilities/payment-manager",
  );
  expect(chrome.permissions.request).toHaveBeenCalledWith({
    origins: ["https://manager.example.test/*"],
  });
  expect(session.managerConnection.live).toBe(true);
  expect(el("live-volume").textContent).toContain("Volume 34");
  expect(el("live-grouping").value).toBe("article");
  scripting
    .mockResolvedValueOnce([{ result: live }])
    .mockResolvedValueOnce([
      { result: { status: "filled", message: "Prepared" } },
    ])
    .mockResolvedValueOnce([
      { result: { status: "reviewed", message: "Opened Review" } },
    ]);
  (window.document.querySelector('[data-action="prepare"]') as any).click();
  await vi.waitFor(() => expect(runtimeMessage).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(scripting).toHaveBeenCalledTimes(4));
  expect(scripting.mock.calls.map(([call]) => call.func.name)).toEqual([
    "readLivePayments",
    "readLivePayments",
    "executeBankAction",
    "executeBankAction",
  ]);
  expect(scripting.mock.calls[2][0].target).toEqual({ tabId: 7 });
});

test("a payment removed from the live list stops before bank preparation and clears stale details", async () => {
  queryTabs.mockResolvedValue([
    { id: 8, url: "https://manager.example.test/utilities/payment-manager" },
  ]);
  const live = {
    status: "payments",
    batch: session.batch,
    publications: [],
    connection: { protocolVersion: 1, bridgeId: "live-bridge" },
  };
  scripting.mockResolvedValueOnce([{ result: live }]);
  el("manager-url").value = "https://manager.example.test";
  el("connect-live").click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("Choose the volume"),
  );
  scripting.mockResolvedValueOnce([
    { result: { ...live, batch: { ...session.batch, payments: [] } } },
  ]);
  (window.document.querySelector('[data-action="prepare"]') as any).click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("changed or was paid"),
  );
  expect(scripting.mock.calls.map(([call]) => call.func.name)).toEqual([
    "readLivePayments",
    "readLivePayments",
  ]);
  expect(el("details").textContent).toContain("No unpaid payments");
  expect(runtimeMessage).not.toHaveBeenCalled();
});

test("denying the site's permission prevents live page access", async () => {
  vi.mocked(chrome.permissions.request).mockResolvedValueOnce(false);
  el("manager-url").value = "https://manager.example.test";
  el("connect-live").click();
  await vi.waitFor(() =>
    expect(el("status").textContent).toContain("not granted"),
  );
  expect(local.liveMode).toBeUndefined();
  expect(scripting).not.toHaveBeenCalled();
});

test("automatic-next settings default to Volume 33 / Issue 2 and save the connected scope", async () => {
  queryTabs.mockResolvedValue([
    { id: 8, url: "https://manager.example.test/utilities/payment-manager" },
  ]);
  scripting.mockResolvedValueOnce([
    {
      result: {
        status: "payments",
        batch: session.batch,
        publications: [],
        connection: { bridgeId: "live-bridge" },
      },
    },
  ]);
  el("manager-url").value = "https://manager.example.test";
  el("connect-live").click();
  await vi.waitFor(() => expect(session.managerConnection?.live).toBe(true));
  await vi.waitFor(() => expect(el("settings-tab").disabled).toBe(false));
  el("settings-tab").click();
  expect(el("auto-next-volume").value).toBe("33");
  expect(el("auto-next-issue").value).toBe("2");
  expect(el("auto-next-enabled").checked).toBe(false);
  el("auto-next-enabled").checked = true;
  el("save-auto-next").click();
  await vi.waitFor(() => expect(local.autoNextConfig?.enabled).toBe(true));
  expect(local.autoNextConfig).toEqual({
    enabled: true,
    volume: 33,
    issue: 2,
    origin: "https://manager.example.test",
    bankTabId: 7,
  });
  await vi.waitFor(() =>
    expect(runtimeMessage).toHaveBeenCalledWith({
      kind: "ote-update-next-scope",
    }),
  );
  el("stop-auto-next").click();
  await vi.waitFor(() => expect(local.autoNextConfig.enabled).toBe(false));
});

test("background preparation pauses popup refresh and bank controls but leaves Stop available", async () => {
  local.liveMode = true;
  local.managerSiteUrl = "https://manager.example.test";
  local.autoNextConfig = {
    enabled: true,
    volume: 33,
    issue: 2,
    origin: local.managerSiteUrl,
    bankTabId: 7,
  };
  session.autoNextStatus = {
    phase: "preparing",
    message: "Preparing next synthetic article",
  };
  session.managerConnection = {
    live: true,
    origin: local.managerSiteUrl,
    tabId: 8,
  };
  session.autoWriteBack = true;
  vi.resetModules();
  window.document.body.innerHTML = await readFile(
    "extensions/vancity-payment-helper/popup.html",
    "utf8",
  );
  await import("../extensions/vancity-payment-helper/popup.js");
  expect(scripting).not.toHaveBeenCalled();
  expect(runtimeMessage).toHaveBeenCalledWith({ kind: "ote-auto-next-status" });
  expect(el("auto-next-run-status").textContent).toContain(
    "Preparing next synthetic",
  );
  expect(el("refresh-live").disabled).toBe(true);
  expect(el("stop-auto-next").disabled).toBe(false);
  expect(el("settings-tab").disabled).toBe(false);
  expect(
    (window.document.querySelector('[data-action="prepare"]') as any).disabled,
  ).toBe(true);
});

test("saved answers stay masked, can be revealed, and survive unrelated renders without losing edits", async () => {
  el("settings-tab").click();
  el("preset-question").value = "Synthetic reveal question?";
  el("preset-answer").value = "synthetic-reveal";
  el("save-preset").click();
  await vi.waitFor(() =>
    expect(local.securityPreset?.answer).toBe("synthetic-reveal"),
  );
  await vi.waitFor(() => expect(el("show-preset").disabled).toBe(false));
  expect(el("preset-answer").type).toBe("password");
  expect(el("preset-answer").value).toBe("synthetic-reveal");
  el("show-preset").click();
  expect(el("preset-answer").type).toBe("text");
  expect(el("show-preset").getAttribute("aria-pressed")).toBe("true");
  el("show-preset").click();
  expect(el("preset-answer").type).toBe("password");
  el("preset-answer").value = "unsaved-edit";
  el("preset-answer").dispatchEvent(
    new window.Event("input", { bubbles: true }),
  );
  el("show-preset").click();
  expect(el("preset-answer").value).toBe("unsaved-edit");
  expect(local.securityPreset.answer).toBe("synthetic-reveal");
  expect(el("preset-status").textContent).toContain("Unsaved changes");
  el("payments-tab").click();
  expect(el("preset-answer").type).toBe("password");
  el("settings-tab").click();
  expect(el("preset-answer").value).toBe("unsaved-edit");
});
