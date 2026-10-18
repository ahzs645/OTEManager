// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { Window } from "happy-dom";
import { readPaymentManagerExport } from "../extensions/vancity-payment-helper/manager-page.js";

let page: Window;
function managerPage(
  url: string,
  batch: unknown = { payments: [{ id: "fixture" }] },
) {
  page = new Window({ url });
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("location", page.location);
  const node = page.document.createElement("script");
  node.id = "ote-payment-helper-export";
  node.type = "application/json";
  node.textContent = JSON.stringify(batch);
  page.document.body.append(node);
}
afterEach(() => {
  vi.unstubAllGlobals();
  page?.happyDOM.abort();
});

test.each([
  "http://localhost:3000/utilities/payment-manager",
  "http://127.0.0.1:4174/utilities/payment-manager",
  "http://[::1]:3000/utilities/payment-manager",
  "https://otemanager.k8s.overtheedgepaper.ca/utilities/payment-manager",
])(
  "reads the selected export from the permitted Payment Manager page: %s",
  (url) => {
    const batch = { payments: [{ id: "selected-fixture" }] };
    managerPage(url, batch);
    expect(readPaymentManagerExport()).toEqual({ status: "export", batch });
  },
);

test.each([
  "http://localhost.evil.test/utilities/payment-manager",
  "https://otemanager.k8s.overtheedgepaper.ca.evil.test/utilities/payment-manager",
  "http://localhost:3000/articles",
  "https://my.vancity.com/banking/home",
])("rejects unrelated origins and routes: %s", (url) => {
  managerPage(url);
  expect(readPaymentManagerExport().status).toBe("error");
});

test("requires a current selected preview and handles invalid page data", () => {
  managerPage("http://localhost:3000/utilities/payment-manager", {
    payments: [],
  });
  expect(readPaymentManagerExport().message).toContain("Select at least one");
  page.document.getElementById("ote-payment-helper-export")!.textContent =
    "invalid-json";
  expect(readPaymentManagerExport().status).toBe("error");
  page.document.getElementById("ote-payment-helper-export")!.remove();
  expect(readPaymentManagerExport().message).toContain("Preview export");
});
