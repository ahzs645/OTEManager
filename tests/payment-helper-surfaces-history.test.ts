// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { Window } from "happy-dom";
import {
  initializeHelperSurface,
  saveHelperSurface,
} from "../extensions/vancity-payment-helper/surface.js";
import {
  readSentTransfer,
  matchSentTransfer,
} from "../extensions/vancity-payment-helper/bank-history.js";

let window: Window | undefined;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window?.happyDOM.abort();
  window = undefined;
});

test("sidebar is the toolbar default; saving Popover changes only the window preference and survives restart", async () => {
  const local: Record<string, any> = {};
  const setPopup = vi.fn(async () => {}),
    setOptions = vi.fn(async () => {}),
    setPanelBehavior = vi.fn(async () => {});
  vi.stubGlobal("chrome", {
    action: { setPopup },
    sidePanel: { setOptions, setPanelBehavior },
    storage: {
      local: {
        get: async () => ({ ...local }),
        set: async (value) => Object.assign(local, value),
      },
    },
  });
  await initializeHelperSurface();
  expect(setPopup).toHaveBeenLastCalledWith({ popup: "" });
  expect(setOptions).toHaveBeenLastCalledWith({
    path: "popup.html",
    enabled: true,
  });
  expect(setPanelBehavior).toHaveBeenLastCalledWith({
    openPanelOnActionClick: true,
  });
  expect(await saveHelperSurface("popup")).toEqual({ surface: "popup" });
  expect(local).toEqual({ helperSurface: "popup" });
  expect(setPopup).toHaveBeenLastCalledWith({
    popup: "popup.html?surface=popup",
  });
  expect(setOptions).toHaveBeenLastCalledWith({
    path: "popup.html",
    enabled: false,
  });
  await initializeHelperSurface();
  expect(setPanelBehavior).toHaveBeenLastCalledWith({
    openPanelOnActionClick: false,
  });
  await expect(saveHelperSurface("invalid")).rejects.toThrow("Choose Sidebar");
  expect(local.helperSurface).toBe("popup");
});

test("a failed Chrome surface change retains the previous preference and restores its toolbar behavior", async () => {
  const set = vi.fn();
  const setPopup = vi.fn(async () => {});
  vi.stubGlobal("chrome", {
    action: { setPopup },
    sidePanel: {
      setOptions: vi.fn(async () => {}),
      setPanelBehavior: vi
        .fn()
        .mockRejectedValueOnce(new Error("Chrome refused"))
        .mockResolvedValueOnce(undefined),
    },
    storage: { local: { get: async () => ({ helperSurface: "popup" }), set } },
  });
  await expect(saveHelperSurface("sidepanel")).rejects.toThrow(
    "Chrome refused",
  );
  expect(set).not.toHaveBeenCalled();
  expect(setPopup).toHaveBeenLastCalledWith({
    popup: "popup.html?surface=popup",
  });
});

const reference = "20260102030405000001";
const saved = {
  data: {
    receipt: {
      recipientEmail: "writer@example.test",
      recipientName: "Synthetic Writer",
      amountCents: 3500,
      message: "OTE: Synthetic story (Vol 33, Issue 2) — Tier 2 $35.00",
      sourceAccountLastFour: "1234",
      receiptDate: "2 Jan 2026 - 03:04",
    },
  },
  synced: true,
};
function transfer(overrides: Record<string, string> = {}) {
  window = new Window({
    url: "https://my.vancity.com/banking/etransfers-space/etransfers",
  });
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("location", window.location);
  vi.stubGlobal("getComputedStyle", window.getComputedStyle.bind(window));
  vi.spyOn(window.Element.prototype, "getClientRects").mockImplementation(
    function (this: any) {
      return this.isConnected && !this.hidden
        ? ([{ width: 100, height: 20 }] as any)
        : [];
    },
  );
  window.document.body.innerHTML =
    '<box role="dialog"><span>Transfer details</span><button>Cancel transfer</button><button>Send a reminder</button></box>';
  const fields = {
    "Transaction date": "2 Jan 2026 03:04",
    "Sent to": "Synthetic bank alias 2",
    "Notified by": saved.data.receipt.recipientEmail,
    "Sent from": "Test payments 111111111234",
    Amount: "Minus- $35.00",
    Status: "Pending",
    Message: saved.data.receipt.message,
    ...overrides,
  };
  for (const [label, value] of Object.entries(fields)) {
    const row = window.document.createElement("box");
    row.className = "scheduled-bill-details-content-item";
    row.innerHTML =
      '<span class="item-title"></span><box class="aside-container"><span class="item-value"></span></box>';
    row.querySelector(".item-title")!.textContent = label;
    row.querySelector(".item-value")!.textContent = value;
    window.document.querySelector('[role="dialog"]')!.append(row);
  }
  return window;
}

test("reads the real Sent detail layout, matches immutable receipt fields, keeps the receipt reference and never clicks financial controls", () => {
  const page = transfer();
  const click = vi.spyOn(page.HTMLElement.prototype, "click");
  const result = readSentTransfer();
  expect(result.status).toBe("history-detail");
  expect(result.detail).toMatchObject({
    amountCents: 3500,
    bankStatus: "Pending",
    sourceAccountLastFour: "1234",
  });
  expect(result.detail).not.toHaveProperty("reference");
  expect(JSON.stringify(result)).not.toContain("111111111234");
  expect(
    matchSentTransfer(result.detail, { [reference]: saved }).reference,
  ).toBe(reference);
  expect(click).not.toHaveBeenCalled();
});

test.each([
  "recipientEmail",
  "amountCents",
  "message",
  "transactionDate",
  "sourceAccountLastFour",
])("Sent matching refuses a changed %s, even with a matching name", (field) => {
  transfer();
  const { detail } = readSentTransfer();
  expect(() =>
    matchSentTransfer(
      { ...detail, [field]: field === "amountCents" ? 4000 : "different" },
      { [reference]: saved },
    ),
  ).toThrow("No saved send receipt matches");
});

test("identical saved receipt details are ambiguous instead of choosing a reference", () => {
  transfer();
  expect(() =>
    matchSentTransfer(readSentTransfer().detail, {
      [reference]: saved,
      "20260102030405000002": saved,
    }),
  ).toThrow("More than one");
});

test.each([
  { Amount: "$35.00" },
  { Message: "" },
  { Status: "Unknown" },
  { "Notified by": "15555555555" },
])(
  "unsupported or incomplete historical evidence is not accepted: %j",
  (fields) => {
    transfer(fields);
    expect(readSentTransfer().status).toBe("error");
  },
);

test("duplicate fields and history on the Accounts page are rejected", () => {
  const page = transfer();
  const duplicate = page.document
    .querySelector(".scheduled-bill-details-content-item")!
    .cloneNode(true);
  page.document.querySelector('[role="dialog"]')!.append(duplicate);
  expect(readSentTransfer().status).toBe("error");
  page.location.href = "https://my.vancity.com/banking/accounts-space/accounts";
  expect(readSentTransfer().status).toBe("error");
});
