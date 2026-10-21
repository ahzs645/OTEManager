// @vitest-environment node
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import { Window } from "happy-dom";
import { afterEach, expect, test, vi } from "vitest";

const windows: Window[] = [];
afterEach(async () => {
  for (const window of windows.splice(0)) await window.happyDOM.abort();
});
async function workspace() {
  const dom = new Window({
    url: "https://ote.example/designcraft/index.html?workspace=1",
  });
  windows.push(dom);
  dom.document.body.innerHTML = `
    <section id="planner"><div class="planner"><aside class="planner-controls">
      <p id="import-status">6 articles imported</p><div id="issue-pages"></div>
      <section id="browser-compose"><h3>Compose</h3><p id="browser-compose-status">Ready</p>
        <label><input id="browser-compose-fonts" type="file"></label>
        <label><input id="browser-compose-tighten" type="checkbox"></label>
        <label><input id="browser-compose-booklet" type="checkbox"></label>
        <button id="browser-variants"></button><button id="browser-suggest-issue"></button>
        <button id="browser-generate-page"></button>
        <div id="browser-compose-results"></div><div id="browser-compose-downloads"></div>
      </section>
    </aside><div class="preview-wrap"><div class="preview-toolbar"><span>Preview</span><span>Fit</span></div></div></div></section>`;
  const parent = { postMessage: vi.fn() };
  const window = Object.assign(new EventTarget(), {
    parent,
    oteBrowserCompose: { compose: vi.fn().mockResolvedValue({}) },
  });
  const pages = [{ id: "cover" }, { id: "page-2" }];
  const $ = (id: string) => dom.document.getElementById(id)!;
  const source = await readFile(
    new URL("../public/designcraft/workspace.js", import.meta.url),
    "utf8",
  );
  await new Script(source).runInNewContext({
    window,
    document: dom.document,
    location: dom.location,
    URLSearchParams,
    ArrayBuffer,
    MutationObserver: dom.MutationObserver,
    queueMicrotask,
    plannerReady: Promise.resolve(),
    issue: { articles: Array(6).fill({}) },
    plannedPages: pages,
    $,
  });
  parent.postMessage.mockClear();
  function command(
    action: string,
    origin = dom.location.origin,
    sender: unknown = parent,
  ) {
    window.dispatchEvent(
      Object.assign(new Event("message"), {
        origin,
        source: sender,
        data: { type: "ote.workspace.command", action },
      }),
    );
  }
  return { dom, window, parent, pages, $, command };
}

test("a late parent can reconnect after the planner is already ready", async () => {
  const { parent, command } = await workspace();
  command("connect");
  expect(parent.postMessage.mock.calls.map((call) => call[0].type)).toEqual([
    "ote.workspace.state",
    "ote.workspace.ready",
  ]);
  expect(parent.postMessage.mock.calls[0][0]).toMatchObject({
    articles: 6,
    pages: 2,
    sample: false,
    busy: false,
  });
});

test("generation accepts only the parent origin and selects the saved issue or current page", async () => {
  const { command, window, pages } = await workspace();
  command("generate", "https://other.example");
  command("generate", "https://ote.example", {});
  expect(window.oteBrowserCompose.compose).not.toHaveBeenCalled();
  command("generate");
  expect(window.oteBrowserCompose.compose).toHaveBeenLastCalledWith("issue");
  pages.length = 0;
  command("generate");
  expect(window.oteBrowserCompose.compose).toHaveBeenLastCalledWith("page");
});

test("reimporting the same issue acknowledges completion each time", async () => {
  const { dom, parent, $ } = await workspace();
  for (let i = 0; i < 2; i++) {
    $("import-status").textContent = "6 articles imported";
    await dom.happyDOM.waitUntilComplete();
    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ote.workspace.state",
        busy: false,
        status: "6 articles imported",
      }),
      "https://ote.example",
      [],
    );
    parent.postMessage.mockClear();
  }
});

test("handoff copies the document and fonts, includes downloads, and leaves failed drafts in the planner", async () => {
  const { window, parent, $ } = await workspace();
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const font = new Uint8Array([4, 5]).buffer;
  const detail = {
    name: "issue.designcraft",
    bytes,
    fonts: [{ name: "Headline.otf", bytes: font }],
  };
  const result = () =>
    window.dispatchEvent(
      Object.assign(new Event("ote.browser.result"), { detail }),
    );
  $("browser-compose-status").textContent = "Preflight failed; draft retained";
  result();
  expect(parent.postMessage).not.toHaveBeenCalled();
  $("browser-compose-status").textContent =
    "Composed in your browser. Preflight passed: 0 warnings";
  $("browser-compose-downloads").innerHTML =
    '<a href="blob:https://ote.example/output" download="issue.pdf">PDF</a>';
  result();
  const [message, origin, transfer] = parent.postMessage.mock.calls[0];
  expect(origin).toBe("https://ote.example");
  expect(message).toMatchObject({
    type: "ote.workspace.document",
    name: "issue.designcraft",
    downloads: [{ name: "issue.pdf", href: "blob:https://ote.example/output" }],
  });
  expect([...new Uint8Array(message.bytes)]).toEqual([1, 2, 3]);
  expect(message.bytes).not.toBe(bytes);
  expect(message.fonts[0].bytes).not.toBe(font);
  expect(transfer).toEqual([message.bytes, message.fonts[0].bytes]);
  expect(bytes.byteLength).toBe(3);
  expect(font.byteLength).toBe(2);
});
