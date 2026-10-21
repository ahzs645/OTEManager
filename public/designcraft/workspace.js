"use strict";
// OTEManager owns the workspace chrome and the editor. Keep the standalone
// planner available separately, and expose a small same-origin document bridge.
async function setupWorkspace() {
  if (
    new URLSearchParams(location.search).get("workspace") !== "1" ||
    window.parent === window
  )
    return;
  await plannerReady;
  const send = (data, transfer = []) =>
    window.parent.postMessage(data, location.origin, transfer);
  const panel = $("browser-compose");
  $("planner").insertBefore(panel, document.querySelector(".planner"));
  for (const details of document.querySelectorAll(".planner-controls>details"))
    details.open = false;
  const options = document.createElement("details");
  options.className = "workspace-options";
  const summary = document.createElement("summary");
  summary.textContent = "Fonts & print checks";
  options.append(summary);
  for (const id of [
    "browser-compose-fonts",
    "browser-compose-tighten",
    "browser-compose-booklet",
  ])
    options.append($(id).closest("label"));
  panel.insertBefore(options, $("browser-compose-results"));
  $("browser-variants").textContent = "Find fitting layouts";
  $("browser-suggest-issue").textContent = "Suggest issue plan";
  document.querySelector(".preview-toolbar span:last-child").textContent =
    "Layout preview";
  let activity = "plan",
    queued = false,
    last = "";
  function state() {
    queued = false;
    const busy = $("browser-generate-page").disabled;
    let status =
      activity === "import"
        ? $("import-status").textContent
        : activity === "compose"
          ? $("browser-compose-status").textContent
          : "Choose a layout, or import an issue to get started.";
    if (status.startsWith("Composed in your browser"))
      status =
        "Composition complete · " +
        status.split("Preflight passed: ")[1]?.replace(" Download below.", "");
    const value = {
      type: "ote.workspace.state",
      articles: issue.articles.length,
      pages: plannedPages.length,
      sample: !$("import-status").textContent.includes("articles imported"),
      busy,
      status,
    };
    const serialized = JSON.stringify(value);
    if (serialized !== last) {
      last = serialized;
      send(value);
    }
  }
  function update() {
    if (!queued) {
      queued = true;
      queueMicrotask(state);
    }
  }
  new MutationObserver(() => {
    activity = "import";
    last = "";
    update();
  }).observe($("import-status"), {
    childList: true,
    subtree: true,
    characterData: true,
  });
  new MutationObserver(() => {
    activity = "compose";
    update();
  }).observe($("browser-compose-status"), {
    childList: true,
    subtree: true,
    characterData: true,
  });
  new MutationObserver(update).observe(panel, {
    attributes: true,
    attributeFilter: ["disabled"],
    subtree: true,
  });
  new MutationObserver(update).observe($("issue-pages"), {
    childList: true,
    subtree: true,
  });
  window.addEventListener("change", update);
  window.addEventListener("message", async (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== window.parent ||
      event.data?.type !== "ote.workspace.command"
    )
      return;
    if (event.data.action === "connect") {
      last = "";
      state();
      send({ type: "ote.workspace.ready" });
      return;
    }
    if (
      event.data.action === "generate" &&
      !$("browser-generate-page").disabled
    ) {
      activity = "compose";
      try {
        await window.oteBrowserCompose.compose(
          plannedPages.length ? "issue" : "page",
        );
      } catch {
        /* status is displayed by the composer */
      }
      state();
    }
  });
  window.addEventListener("ote.browser.result", (event) => {
    if (
      !$("browser-compose-status").textContent.startsWith(
        "Composed in your browser",
      )
    )
      return;
    const value = event.detail;
    if (!(value?.bytes instanceof ArrayBuffer)) return;
    const bytes = value.bytes.slice(0),
      fonts = (value.fonts || []).map((font) => ({
        name: font.name,
        bytes: font.bytes.slice(0),
      }));
    const downloads = [
      ...$("browser-compose-downloads").querySelectorAll("a[download]"),
    ].map((link) => ({ name: link.download, href: link.href }));
    const warnings = Number(
      $("browser-compose-status").textContent.match(
        /Preflight passed: (\d+)/,
      )?.[1] || 0,
    );
    send(
      {
        type: "ote.workspace.document",
        name: value.name,
        bytes,
        fonts,
        downloads,
        warnings,
      },
      [bytes, ...fonts.map((font) => font.bytes)],
    );
  });
  state();
  send({ type: "ote.workspace.ready" });
}
setupWorkspace();
