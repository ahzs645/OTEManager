import { validateBatch, paymentWarnings, hasSentArticles } from "./contract.js";
import { executeBankAction } from "./bank.js";
import { validateSecurityPreset } from "./security-preset.js";
import { validateSourceAccount } from "./account-preset.js";
import { readPaymentManagerExport, readLivePayments } from "./manager-page.js";
import { managerSite, requestManager } from "./manager-client.js";
import { validateAutoNext } from "./auto-next.js";
import {
  BANK_SITE_PERMISSION,
  BANK_ACCESS_MESSAGE,
  activeBankingTab,
  resolveBankingTab,
} from "./bank-tab.js";

const $ = (id) => document.getElementById(id);
const surfaceParams = new URLSearchParams(location.search);
if (
  surfaceParams.get("surface") !== "popup" &&
  !surfaceParams.has("bankTabId") &&
  !surfaceParams.has("workspace")
)
  document.body.classList.add("sidepanel");
const money = (cents) =>
  `CAD $${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
let state = await chrome.storage.session.get([
  "batch",
  "sentArticles",
  "messages",
  "selectedId",
  "contactChecks",
  "bankTabId",
  "managerConnection",
  "autoWriteBack",
  "liveFilters",
  "pendingPayment",
  "autoNextStatus",
  "publications",
]);
if (state.autoNextStatus?.phase === "preparing") {
  // Wakes a restarted worker to recover an interrupted durable attempt.
  await chrome.runtime.sendMessage({ kind: "ote-auto-next-status" });
  state = { ...state, ...(await chrome.storage.session.get("autoNextStatus")) };
}
let batch = null;
try {
  batch = state.batch
    ? validateBatch(state.batch, {
        allowEmpty: state.managerConnection?.live === true,
      })
    : null;
} catch {
  status(
    "Stored export is invalid. Import a fresh Payment Manager file.",
    true,
  );
}
let sentArticles = state.sentArticles || {};
let messages = state.messages || {};
let contactChecks = state.contactChecks || {};
let pendingPayment = state.pendingPayment || null;
let managerConnection = state.managerConnection || null;
let autoWriteBack = state.autoWriteBack === true && !!managerConnection;
const savedLive = await chrome.storage.local.get([
  "managerSiteUrl",
  "liveMode",
  "autoNextConfig",
  "helperSurface",
]);
$("helper-surface").value =
  savedLive.helperSurface === "popup" ? "popup" : "sidepanel";
let liveMode = savedLive.liveMode === true;
let liveSite = null;
try {
  if (savedLive.managerSiteUrl)
    liveSite = managerSite(savedLive.managerSiteUrl);
} catch {
  liveMode = false;
}
let liveFilters = state.liveFilters || {
  grouping: "article",
  volume: null,
  issue: null,
  search: "",
};
let publications = state.publications || [];
let autoNextConfig = null;
try {
  autoNextConfig = savedLive.autoNextConfig
    ? validateAutoNext(savedLive.autoNextConfig)
    : null;
} catch {}
let autoNextState = state.autoNextStatus || null;
let autoNextDraftDirty = false;
let liveError = "";
$("manager-url").value =
  liveSite?.origin || "https://otemanager.k8s.overtheedgepaper.ca";
let paymentReceipts =
  (await chrome.storage.local.get("paymentReceipts")).paymentReceipts || {};
function mergeCapturedSent() {
  for (const entry of Object.values(paymentReceipts))
    for (const article of entry.data?.payment?.articles || [])
      sentArticles[article.id] = {
        reference: entry.data.receipt.reference,
        recordedAt: entry.capturedAt,
      };
}
mergeCapturedSent();
await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
// Remove the previous encrypted preset and its session copy on upgrade.
await chrome.storage.local.remove("securityVault");
await chrome.storage.session.remove("securityPreset");
let securityPreset = null;
let presetRevealed = false,
  presetDraftDirty = false;
let defaultSourceAccount = null;
let accountChoices = [];
try {
  const saved = (await chrome.storage.local.get("securityPreset"))
    .securityPreset;
  securityPreset = saved ? validateSecurityPreset(saved) : null;
} catch {
  await chrome.storage.local.remove("securityPreset");
}
try {
  const saved = (await chrome.storage.local.get("defaultSourceAccount"))
    .defaultSourceAccount;
  defaultSourceAccount = saved ? validateSourceAccount(saved) : null;
  if (defaultSourceAccount) accountChoices = [defaultSourceAccount];
} catch {
  await chrome.storage.local.remove("defaultSourceAccount");
}
let busy = false,
  checkingAll = false,
  cancelBulk = false;
let bankAccessGranted = await chrome.permissions.contains({
  origins: [BANK_SITE_PERMISSION],
});
let bankConnectionError = "";
const workspaceTabId = new URLSearchParams(location.search).get("bankTabId");
let connectedBankTabId =
  pendingPayment?.bankTabId ||
  (workspaceTabId && /^\d+$/.test(workspaceTabId)
    ? Number(workspaceTabId)
    : Number.isInteger(state.bankTabId)
      ? state.bankTabId
      : null);
try {
  const tab = await resolveBankingTab(connectedBankTabId, {
    locked: !!pendingPayment,
  });
  connectedBankTabId = tab.id;
  await chrome.storage.session.set({ bankTabId: tab.id });
} catch (error) {
  bankConnectionError = error.message;
  if (!pendingPayment) {
    connectedBankTabId = null;
    await chrome.storage.session.remove("bankTabId");
  }
}
if (workspaceTabId || new URLSearchParams(location.search).has("workspace"))
  document.body.classList.add("workspace");

function selectedPayment() {
  return batch?.payments.find((p) => p.id === $("payment").value);
}
function missingContacts() {
  const unique = new Map();
  for (const payment of batch?.payments || []) {
    if (hasSentArticles(payment, Object.keys(sentArticles))) continue;
    if (contactChecks[payment.recipientEmail]?.status !== "no-match") continue;
    const previous = unique.get(payment.recipientEmail);
    if (previous === null) continue;
    if (previous && previous.recipientName !== payment.recipientName)
      unique.set(payment.recipientEmail, null);
    else unique.set(payment.recipientEmail, payment);
  }
  return [...unique.values()].filter(Boolean);
}
function status(message, error = false) {
  $("status").textContent = message;
  $("status").className = error ? "error" : "";
}
function updateButtons() {
  const bankBusy = busy || autoNextState?.phase === "preparing";
  const payment = selectedPayment();
  const sent = payment && hasSentArticles(payment, Object.keys(sentArticles));
  const messageValid =
    $("message").value.trim() && $("message").value.length <= 400;
  $("message-error").hidden = $("message").value.length <= 400;
  $("message-error").textContent =
    "Shorten the bank message to 400 characters or fewer.";
  for (const button of document.querySelectorAll("[data-action]"))
    button.disabled =
      bankBusy ||
      !!pendingPayment ||
      !payment ||
      sent ||
      (["prepare", "fill-payment"].includes(button.dataset.action) &&
        !messageValid);
  for (const id of [
    "payments-tab",
    "settings-tab",
    "open-settings",
    "navigate",
    "connect-bank",
    "remove-bank-access",
    "workspace",
    "import-paste",
    "import-manager",
    "reconnect-manager",
    "check-receipt",
    "retry-receipts",
    "match-history",
    "download-receipts",
    "payment",
    "import",
    "clear",
    "save-preset",
    "read-accounts",
    "use-current-account",
    "source-account",
    "save-account",
    "connect-live",
    "manager-url",
    "refresh-live",
    "live-volume",
    "live-issue",
    "live-search",
    "live-grouping",
    "disconnect-live",
    "auto-next-enabled",
    "auto-next-volume",
    "auto-next-issue",
    "save-auto-next",
    "save-surface",
  ])
    $(id).disabled = ["payments-tab", "settings-tab", "open-settings"].includes(
      id,
    )
      ? busy
      : bankBusy;
  $("start-auto-next").disabled =
    bankBusy ||
    !!pendingPayment ||
    !autoNextConfig?.enabled ||
    !liveMode ||
    !autoWriteBack;
  $("stop-auto-next").disabled = !autoNextConfig?.enabled;
  $("pending-status").hidden = !pendingPayment;
  $("pending-status").textContent = pendingPayment
    ? `Waiting for Vancity confirmation for ${money(pendingPayment.data.payment.amountCents)}. Payment preparation is paused while you review and send; confirmation checking remains available.`
    : "";
  $("bulk-check").disabled = bankBusy || !batch?.payments.length;
  const missing = missingContacts().length;
  $("bulk-create").hidden = missing === 0;
  $("bulk-create-note").hidden = missing === 0;
  $("bulk-create").textContent =
    `Create ${missing} missing contact${missing === 1 ? "" : "s"}`;
  $("bulk-create").disabled = bankBusy || !!pendingPayment || missing === 0;
  $("cancel-bulk").hidden = !checkingAll;
  $("cancel-bulk").disabled = cancelBulk;
  $("forget-preset").disabled = busy || !securityPreset;
  $("show-preset").disabled = busy || !$("preset-answer").value;
  $("forget-account").disabled = busy || !defaultSourceAccount;
  $("sent").disabled = busy || !payment || sent || !$("sent-confirm").checked;
  $("auto-record").disabled = busy || !managerConnection;
  $("disconnect-live").disabled = busy || !liveMode;
  $("remove-bank-access").disabled = bankBusy || !bankAccessGranted;
}
function renderReceipts() {
  $("manager-status").textContent = managerConnection
    ? `Connected to ${managerConnection.origin}. Matching send receipts ${autoWriteBack ? "will automatically mark articles paid and save the bank reference" : "will be saved on this device; automatic OTEManager recording is off"}.`
    : "Enter your OTEManager site URL and connect to browse unpaid payments. JSON-file imports keep receipts on this device.";
  $("auto-record").checked = autoWriteBack;
  $("receipt-status").replaceChildren();
  const entries = Object.values(paymentReceipts)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    .slice(0, 10);
  for (const entry of entries) {
    const p = document.createElement("p");
    p.textContent = `${entry.data.receipt.recipientName} · ${money(entry.data.receipt.amountCents)} · reference ${entry.data.receipt.reference} · ${entry.synced ? "OTEManager updated" : entry.connection ? `Write-back pending${entry.error ? ": " + entry.error : ""}` : "Receipt saved on this device"}${entry.historyCheck ? ` · Sent history: ${entry.historyCheck.bankStatus}` : ""}`;
    $("receipt-status").append(p);
  }
}
function renderAutoNext() {
  if (!autoNextDraftDirty) {
    $("auto-next-enabled").checked = autoNextConfig?.enabled === true;
    $("auto-next-volume").value = autoNextConfig?.volume || 33;
    $("auto-next-issue").value = autoNextConfig?.issue || 2;
  }
  $("auto-next-run").hidden = !autoNextConfig?.enabled && !autoNextState;
  $("auto-next-run-status").textContent =
    autoNextState?.message ||
    (autoNextConfig?.enabled
      ? `After each confirmed recording, prepare the first remaining unpaid article in Volume ${autoNextConfig.volume}, Issue ${autoNextConfig.issue}. You can start from the last recorded payment now.`
      : "Automatic next-payment preparation is off.");
  updateButtons();
}
function renderPreset(force = false) {
  $("preset-status").textContent = presetDraftDirty
    ? "Unsaved changes. Save to use this question and answer."
    : securityPreset
      ? "Question and answer saved on this device. Ready to use."
      : "No answer saved. Enter it once below.";
  if (force || !presetDraftDirty) {
    $("preset-question").value =
      securityPreset?.question || "what are we called one word?";
    $("preset-answer").value = securityPreset?.answer || "";
  }
  $("preset-answer").type = presetRevealed ? "text" : "password";
  $("show-preset").textContent = presetRevealed ? "Hide answer" : "Show answer";
  $("show-preset").setAttribute("aria-pressed", String(presetRevealed));
  updateButtons();
}
function renderAccounts() {
  $("account-status").textContent = defaultSourceAccount
    ? `Default: ${defaultSourceAccount.name} · ending ${defaultSourceAccount.accountNumber.slice(-4)}. Prepare will select this account.`
    : "Using Vancity's selected account. You can remember a source account below.";
  $("source-account").replaceChildren();
  const bankDefault = document.createElement("option");
  bankDefault.value = "";
  bankDefault.textContent = "Use Vancity's selected account";
  $("source-account").append(bankDefault);
  for (const account of accountChoices) {
    const option = document.createElement("option");
    option.value = account.accountNumber;
    option.textContent =
      `${account.name} · ${account.type} · ending ${account.accountNumber.slice(-4)}` +
      (account.availableBalance
        ? ` · available CAD $${account.availableBalance}`
        : "");
    $("source-account").append(option);
  }
  $("source-account").value = defaultSourceAccount?.accountNumber || "";
  updateButtons();
}
function renderChecks() {
  $("bulk-results").replaceChildren();
  const emails = new Set(batch?.payments.map((p) => p.recipientEmail) || []);
  for (const email of emails)
    if (Object.hasOwn(contactChecks, email)) {
      const result = contactChecks[email];
      const line = document.createElement("p");
      line.textContent = `${email}: ${result.status === "created" ? `Contact created and verified${result.contactName ? " as " + result.contactName : ""}` : result.status === "matched" ? "Contact found" : result.status === "no-match" ? "Not in contacts" : result.status === "ambiguous" ? "Multiple matches; manual selection" : `Needs attention${result.message ? ": " + result.message : ""}`} · ${new Date(result.checkedAt).toLocaleTimeString()}`;
      $("bulk-results").append(line);
    }
  $("bulk-details").hidden = !$("bulk-results").children.length;
}
function showPayment() {
  const p = selectedPayment();
  if (!p) {
    $("details").textContent = "No unpaid payments match these filters.";
    $("warnings").replaceChildren();
    $("message").value = "";
    updateButtons();
    return;
  }
  $("sent-confirm").checked = false;
  $("reference").value = "";
  $("message").value = Object.hasOwn(messages, p.id)
    ? messages[p.id]
    : p.message;
  $("details").textContent =
    `${p.recipientName}\n${p.recipientEmail}\n${money(p.amountCents)}\n\n` +
    p.articles
      .map(
        (a) =>
          `${a.title} · ${a.issue}\n${a.items.map((i) => `${i.description}: ${money(i.amountCents)}`).join("\n")}`,
      )
      .join("\n\n");
  $("warnings").replaceChildren();
  const warnings = paymentWarnings(batch, p);
  if (hasSentArticles(p, Object.keys(sentArticles))) {
    const receipt = Object.values(paymentReceipts).find((entry) =>
      entry.data.payment.articles.some((a) =>
        p.articles.some((b) => b.id === a.id),
      ),
    );
    warnings.push(
      receipt?.synced
        ? `Already recorded in OTEManager with reference ${receipt.data.receipt.reference}. Choose another unpaid article.`
        : receipt
          ? "This payment has a saved bank send receipt. Check its write-back status below before preparing another article."
          : "Already recorded as sent in this session. Check its OTEManager record before continuing.",
    );
  }
  for (const warning of warnings) {
    const li = document.createElement("li");
    li.textContent = warning;
    $("warnings").append(li);
  }
  updateButtons();
}
function render() {
  $("work").hidden = !batch && !liveMode;
  $("empty-state").hidden = !!batch || liveMode;
  $("payment").replaceChildren();
  if (batch) {
    $("batch-info").textContent =
      `${batch.grouping === "article" ? "Separate transfers per article" : "Combined transfers per author"} · ${liveMode ? "updated" : "exported"} ${new Date(batch.createdAt).toLocaleString()}`;
    for (const p of batch.payments) {
      const option = document.createElement("option");
      option.value = p.id;
      option.textContent = `${hasSentArticles(p, Object.keys(sentArticles)) ? "Recorded sent · " : ""}${p.recipientName} · ${money(p.amountCents)} · ${p.articles[0].title}`;
      $("payment").append(option);
    }
    if (batch.payments.some((p) => p.id === state.selectedId))
      $("payment").value = state.selectedId;
    showPayment();
  }
  renderChecks();
  renderPreset();
  renderAccounts();
  renderReceipts();
  renderAutoNext();
  renderLive();
  renderBankConnection();
}
function renderBankConnection() {
  $("connection-status").textContent =
    bankConnectionError ||
    (connectedBankTabId
      ? "Vancity tab connected. Choose a payment below to prepare."
      : "Select your Vancity tab and click Connect Vancity below.");
  $("connect-bank").textContent =
    bankAccessGranted && !bankConnectionError
      ? "Use this Vancity tab"
      : "Connect Vancity";
  $("bank-access-note").textContent = bankAccessGranted
    ? "Access to my.vancity.com is allowed. You can remove it in Settings."
    : "Connect asks Chrome for access only to my.vancity.com, so the sidebar can read and fill bank forms. Final Send/Confirm remains yours.";
}

function renderLive() {
  $("live-filters").hidden = !liveMode;
  const options = (id, values, selected, all) => {
    $(id).replaceChildren();
    for (const [value, text] of [["", all], ...values]) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = text;
      $(id).append(option);
    }
    $(id).value = selected === null ? "" : String(selected);
  };
  options(
    "live-volume",
    publications.map((p) => [p.volume, `Volume ${p.volume}`]),
    liveFilters.volume,
    "All volumes",
  );
  const issues = [
    ...new Set(
      publications
        .filter((p) => !liveFilters.volume || p.volume === liveFilters.volume)
        .flatMap((p) => p.issues),
    ),
  ].sort((a, b) => a - b);
  options(
    "live-issue",
    issues.map((n) => [n, `Issue ${n}`]),
    liveFilters.issue,
    "All issues",
  );
  $("live-search").value = liveFilters.search;
  $("live-grouping").value = liveFilters.grouping;
  $("live-status").textContent =
    liveError ||
    (batch
      ? `${batch.payments.length} unpaid payment${batch.payments.length === 1 ? "" : "s"} · ${batch.skipped.length} requiring attention or excluded. Refreshes every minute while idle and checks current records before Prepare.`
      : "Connecting to OTEManager…");
  $("live-status").className = liveError ? "error" : "note";
  updateButtons();
}
async function refreshLive({ quiet = false } = {}) {
  if (!liveMode || !liveSite) return;
  if (quiet && autoNextState?.phase === "preparing") return;
  if (
    quiet &&
    (await chrome.storage.session.get("pendingPayment")).pendingPayment
  ) {
    $("live-status").textContent =
      "A prepared payment is waiting for your bank confirmation. Live refresh is paused.";
    return;
  }
  const result = await requestManager(liveSite, liveFilters, readLivePayments);
  const fresh = validateBatch(result.batch, { allowEmpty: true });
  if (
    !Array.isArray(result.publications) ||
    result.publications.length > 1000 ||
    !result.publications.every(
      (p) =>
        Number.isSafeInteger(p.volume) &&
        p.volume > 0 &&
        Array.isArray(p.issues) &&
        p.issues.length <= 1000 &&
        p.issues.every((n) => Number.isSafeInteger(n) && n > 0),
    )
  )
    throw new Error("OTEManager returned an invalid publication list.");
  publications = result.publications;
  managerConnection = result.connection;
  autoWriteBack = state.autoWriteBack !== false;
  batch = fresh;
  liveError = "";
  await chrome.storage.session.set({
    batch,
    managerConnection,
    autoWriteBack,
    liveFilters,
    publications,
  });
  render();
  if (!quiet)
    status(
      `Connected to ${liveSite.origin}. Choose the volume, issue, and payment to start with.`,
    );
}
async function bankAction(action, payment = null, message = "") {
  const { pendingPayment: waiting } =
    await chrome.storage.session.get("pendingPayment");
  const tab = await resolveBankingTab(
    waiting?.bankTabId || connectedBankTabId,
    { locked: !!waiting },
  ).catch((error) => {
    bankConnectionError = error.message;
    throw error;
  });
  await rememberBankTab(tab, waiting);
  let preset = null;
  if (
    [
      "prepare",
      "fill-contact",
      "fill-payment",
      "open-review",
      "ensure-contact",
    ].includes(action)
  ) {
    const saved = (await chrome.storage.local.get("securityPreset"))
      .securityPreset;
    preset = saved ? validateSecurityPreset(saved) : null;
  }
  let sourceAccount = null;
  if (["prepare", "fill-payment", "open-review"].includes(action)) {
    const saved = (await chrome.storage.local.get("defaultSourceAccount"))
      .defaultSourceAccount;
    sourceAccount = saved ? validateSourceAccount(saved) : null;
  }
  const injected = await chrome.scripting
    .executeScript({
      target: { tabId: tab.id },
      func: executeBankAction,
      args: [
        action,
        payment
          ? {
              recipientName: payment.recipientName,
              recipientEmail: payment.recipientEmail,
              amountCents: payment.amountCents,
            }
          : null,
        message,
        preset,
        sourceAccount,
      ],
    })
    .catch((error) => {
      if (
        /cannot access|missing host permission|not have permission|not been granted/i.test(
          error.message,
        )
      )
        throw new Error(BANK_ACCESS_MESSAGE);
      throw error;
    });
  const result = injected[0]?.result;
  if (!result)
    throw new Error("No result from Vancity. Check the active bank page.");
  if (result.status === "error") throw new Error(result.message);
  return result;
}
async function rememberBankTab(tab, waiting) {
  if (waiting && waiting.bankTabId !== tab.id)
    throw new Error(
      "A payment is waiting on the previous bank tab. Check its confirmation before connecting another tab.",
    );
  connectedBankTabId = tab.id;
  bankConnectionError = "";
  await chrome.storage.session.set({ bankTabId: tab.id });
  const { autoNextConfig: currentConfig } =
    await chrome.storage.local.get("autoNextConfig");
  if (
    currentConfig?.enabled &&
    !waiting &&
    currentConfig.bankTabId !== tab.id
  ) {
    autoNextConfig = { ...currentConfig, bankTabId: tab.id };
    await chrome.storage.local.set({ autoNextConfig });
  }
}
async function task(work) {
  if (busy) return;
  busy = true;
  updateButtons();
  try {
    await work();
  } catch (error) {
    status(error.message, true);
  } finally {
    busy = false;
    updateButtons();
    renderBankConnection();
  }
}
$("navigate").addEventListener("click", () =>
  task(async () => status((await bankAction("navigate")).message)),
);
$("save-surface").addEventListener("click", () =>
  task(async () => {
    const result = await chrome.runtime.sendMessage({
      kind: "ote-set-surface",
      surface: $("helper-surface").value,
    });
    if (result?.error) throw new Error(result.error);
    if (!result?.surface)
      throw new Error(
        "The window preference was not saved. Reload the updated helper and try again.",
      );
    $("surface-status").textContent =
      `${result.surface === "sidepanel" ? "Sidebar" : "Popover"} saved. Close this helper window and click its toolbar icon to reopen it.`;
  }),
);
$("connect-bank").addEventListener("click", () =>
  task(async () => {
    // Request the exact bank origin while still in the button's user gesture.
    if (
      !(await chrome.permissions.request({ origins: [BANK_SITE_PERMISSION] }))
    )
      throw new Error(
        "Vancity access was not allowed. Click Connect Vancity when you want to enable sidebar form preparation.",
      );
    bankAccessGranted = true;
    const tab = await activeBankingTab();
    const { pendingPayment: waiting } =
      await chrome.storage.session.get("pendingPayment");
    await rememberBankTab(tab, waiting);
    render();
    status(
      "Vancity connected. Choose a payment and click Prepare; the helper will stop on Review.",
    );
  }),
);
$("remove-bank-access").addEventListener("click", () =>
  task(async () => {
    if (!(await chrome.permissions.remove({ origins: [BANK_SITE_PERMISSION] })))
      throw new Error(
        "Chrome did not confirm removal of the Vancity site access.",
      );
    bankAccessGranted = false;
    if (!pendingPayment) {
      connectedBankTabId = null;
      await chrome.storage.session.remove("bankTabId");
    }
    const { autoNextConfig: config } =
      await chrome.storage.local.get("autoNextConfig");
    if (config?.enabled) {
      autoNextConfig = { ...config, enabled: false };
      await chrome.storage.local.set({ autoNextConfig });
    }
    bankConnectionError = BANK_ACCESS_MESSAGE;
    render();
    status(
      "Removed Vancity site access and stopped automatic preparation. Saved presets, pending payment details and receipts remain available.",
    );
  }),
);
$("workspace").addEventListener("click", () =>
  task(async () => {
    const tab = connectedBankTabId
      ? await chrome.tabs.get(connectedBankTabId)
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    const bank =
      tab?.id &&
      tab.url &&
      new URL(tab.url).origin === "https://my.vancity.com";
    await chrome.tabs.create({
      url: chrome.runtime.getURL(
        bank ? `popup.html?bankTabId=${tab.id}` : "popup.html?workspace=1",
      ),
    });
  }),
);
$("connect-live").addEventListener("click", () =>
  task(async () => {
    const site = managerSite($("manager-url").value.trim());
    // Keep this request in the Connect click's user gesture. Chrome asks for
    // access to the chosen site rather than granting access to every site.
    if (!(await chrome.permissions.request({ origins: [site.permission] })))
      throw new Error(
        "Site access was not granted. Click Connect when you want to enable live payments.",
      );
    liveSite = site;
    liveMode = true;
    managerConnection = null;
    autoWriteBack = true;
    state.autoWriteBack = true;
    messages = {};
    contactChecks = {};
    state.selectedId = null;
    await chrome.storage.local.set({
      managerSiteUrl: site.url,
      liveMode: true,
    });
    await chrome.storage.session.set({
      messages,
      contactChecks,
      selectedId: null,
      autoWriteBack: true,
    });
    renderLive();
    await refreshLive();
    setView(false);
  }),
);
$("disconnect-live").addEventListener("click", () =>
  task(async () => {
    liveMode = false;
    await chrome.storage.local.set({ liveMode: false });
    await disconnectManager();
    batch = null;
    await chrome.storage.session.remove("batch");
    if (liveSite)
      await chrome.permissions.remove({ origins: [liveSite.permission] });
    render();
    status(
      "Disconnected live payments. Saved bank receipts remain on this device.",
    );
  }),
);
$("refresh-live").addEventListener("click", () =>
  task(async () => {
    liveFilters.search = $("live-search").value.trim();
    await refreshLive();
  }),
);
for (const id of ["live-volume", "live-issue", "live-grouping"])
  $(id).addEventListener("change", () =>
    task(async () => {
      liveFilters.volume = $("live-volume").value
        ? Number($("live-volume").value)
        : null;
      liveFilters.issue =
        id === "live-volume"
          ? null
          : $("live-issue").value
            ? Number($("live-issue").value)
            : null;
      liveFilters.grouping = $("live-grouping").value;
      liveFilters.search = $("live-search").value.trim();
      state.selectedId = null;
      await chrome.storage.session.set({ selectedId: null });
      await refreshLive();
    }),
  );
$("live-search").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("refresh-live").click();
});
$("import-manager").addEventListener("click", () =>
  task(async () => {
    const tab = (
      await chrome.tabs.query({ active: true, currentWindow: true })
    )[0];
    if (!tab?.id || !tab.url)
      throw new Error("Open the helper on OTEManager's Payment Manager page.");
    const url = new URL(tab.url);
    const local =
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      ["http:", "https:"].includes(url.protocol);
    if (
      !(local || url.origin === "https://otemanager.k8s.overtheedgepaper.ca") ||
      url.pathname.replace(/\/$/, "") !== "/utilities/payment-manager"
    )
      throw new Error(
        "Open this helper from the local or hosted OTEManager Payment Manager tab to import its selected payments.",
      );
    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readPaymentManagerExport,
    });
    const result = injected[0]?.result;
    if (result?.status !== "export")
      throw new Error(
        result?.message ||
          "OTEManager did not provide an export. Click Preview export first.",
      );
    batch = validateBatch(result.batch);
    liveMode = false;
    await chrome.storage.local.set({ liveMode: false });
    managerConnection = result.connection
      ? { ...result.connection, tabId: tab.id, origin: url.origin }
      : null;
    autoWriteBack = !!managerConnection;
    messages = {};
    contactChecks = {};
    state.selectedId = null;
    await chrome.storage.session.set({
      batch,
      messages,
      contactChecks,
      selectedId: null,
      managerConnection,
      autoWriteBack,
    });
    render();
    status(
      `Imported ${batch.payments.length} selected payments directly from OTEManager. Open the full workspace to prepare them on the connected Vancity tab.`,
    );
    setView(false);
  }),
);
$("reconnect-manager").addEventListener("click", () =>
  task(async () => {
    const tab = (
      await chrome.tabs.query({ active: true, currentWindow: true })
    )[0];
    if (!tab?.id || !tab.url)
      throw new Error(
        "Open the helper on the original OTEManager Payment Manager tab.",
      );
    const url = new URL(tab.url);
    const local =
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      ["http:", "https:"].includes(url.protocol);
    if (
      !(local || url.origin === "https://otemanager.k8s.overtheedgepaper.ca") ||
      url.pathname.replace(/\/$/, "") !== "/utilities/payment-manager"
    )
      throw new Error(
        "Open the helper on the original OTEManager Payment Manager tab.",
      );
    const result = (
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: readPaymentManagerExport,
        args: [true],
      })
    )[0]?.result;
    if (result?.status !== "connected")
      throw new Error(
        result?.message || "The page does not support receipt write-back.",
      );
    managerConnection = {
      ...result.connection,
      tabId: tab.id,
      origin: url.origin,
    };
    autoWriteBack = true;
    await chrome.storage.session.set({ managerConnection, autoWriteBack });
    renderReceipts();
    status(
      "Reconnected OTEManager. Retry write-back for any saved receipts from this same environment.",
    );
  }),
);
$("auto-record").addEventListener("change", async () => {
  autoWriteBack = $("auto-record").checked && !!managerConnection;
  state.autoWriteBack = autoWriteBack;
  await chrome.storage.session.set({ autoWriteBack });
  renderReceipts();
});
async function disconnectManager() {
  liveMode = false;
  await chrome.storage.local.set({ liveMode: false });
  managerConnection = null;
  autoWriteBack = false;
  await chrome.storage.session.remove(["managerConnection", "autoWriteBack"]);
}
$("import-paste").addEventListener("click", () =>
  task(async () => {
    if ($("json-paste").value.length > 2 * 1024 * 1024)
      throw new Error("Payment export is too large.");
    batch = validateBatch(JSON.parse($("json-paste").value));
    await disconnectManager();
    messages = {};
    contactChecks = {};
    state.selectedId = null;
    await chrome.storage.session.set({
      batch,
      messages,
      contactChecks,
      selectedId: null,
    });
    $("json-paste").value = "";
    render();
    setView(false);
    status(
      `Imported ${batch.payments.length} payments. Prepare one payment, or check all recipient emails first.`,
    );
  }),
);
$("import").addEventListener("change", async () => {
  await task(async () => {
    const file = $("import").files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024)
      throw new Error("Payment export is too large (maximum 2 MiB).");
    batch = validateBatch(JSON.parse(await file.text()));
    await disconnectManager();
    messages = {};
    contactChecks = {};
    state.selectedId = null;
    await chrome.storage.session.set({
      batch,
      messages,
      contactChecks,
      selectedId: null,
    });
    render();
    status(
      `Imported ${batch.payments.length} payments. Prepare one payment, or check all recipient emails first.`,
    );
    setView(false);
  });
  $("import").value = "";
});
$("clear").addEventListener("click", () =>
  task(async () => {
    await chrome.storage.session.remove([
      "batch",
      "messages",
      "selectedId",
      "contactChecks",
    ]);
    batch = null;
    await disconnectManager();
    messages = {};
    contactChecks = {};
    render();
    status(
      "Cleared the imported file. Captured bank receipts remain saved on this device.",
    );
  }),
);
$("payment").addEventListener("change", async () => {
  state.selectedId = $("payment").value;
  await chrome.storage.session.set({ selectedId: state.selectedId });
  showPayment();
});
$("message").addEventListener("input", async () => {
  const p = selectedPayment();
  if (p) {
    messages = { ...messages, [p.id]: $("message").value };
    await chrome.storage.session.set({ messages });
  }
  updateButtons();
});
$("sent-confirm").addEventListener("change", updateButtons);
for (const button of document.querySelectorAll("[data-action]"))
  button.addEventListener("click", () => {
    if (button.disabled) return;
    task(async () => {
      const payment = selectedPayment(),
        expectedMessage = $("message").value;
      if (
        liveMode &&
        ["prepare", "fill-payment"].includes(button.dataset.action)
      ) {
        const original = JSON.stringify(payment);
        state.selectedId = payment.id;
        await chrome.storage.session.set({ selectedId: payment.id });
        await refreshLive({ quiet: false });
        if (JSON.stringify(selectedPayment()) !== original)
          throw new Error(
            "This payment changed or was paid in OTEManager. Review the refreshed details, then Prepare again.",
          );
        if (hasSentArticles(payment, Object.keys(sentArticles)))
          throw new Error(
            "This article already has a saved bank receipt. Reconcile it before preparing another transfer.",
          );
      }
      const result = await bankAction(
        button.dataset.action,
        payment,
        expectedMessage,
      );
      status(result.message);
      if (
        ["prepare", "fill-payment"].includes(button.dataset.action) &&
        result.status === "filled"
      ) {
        const watched = await chrome.runtime.sendMessage({
          kind: "ote-arm-receipt",
          bankTabId: connectedBankTabId,
          batch,
          paymentId: payment.id,
          expectedMessage,
        });
        if (watched?.error)
          throw new Error(`Payment form prepared. ${watched.error}`);
        if (!watched?.watching)
          throw new Error(
            "Payment form prepared, but receipt capture did not start.",
          );
        const completed =
          button.dataset.action === "prepare"
            ? await bankAction("open-review", payment, expectedMessage)
            : result;
        if (
          button.dataset.action === "prepare" &&
          completed.status !== "reviewed"
        )
          throw new Error(
            "Receipt capture is ready, but payment Review was not verified. Check Vancity before sending.",
          );
        status(
          completed.message +
            (autoWriteBack
              ? " After you send, the matching bank receipt will record this payment in OTEManager."
              : " After you send, the bank receipt will be saved on this device."),
        );
      }
    });
  });
$("bulk-check").addEventListener("click", () =>
  task(async () => {
    const payments = [
      ...new Map(
        batch.payments
          .filter((p) => !hasSentArticles(p, Object.keys(sentArticles)))
          .map((p) => [p.recipientEmail, p]),
      ).values(),
    ];
    checkingAll = true;
    $("cancel-bulk").textContent = "Stop contact check";
    cancelBulk = false;
    updateButtons();
    try {
      for (let i = 0; i < payments.length && !cancelBulk; i++) {
        status(
          `Checking recipient ${i + 1} of ${payments.length}… Keep the helper open.`,
        );
        const p = payments[i];
        const result = await bankAction("search", p);
        contactChecks = {
          ...contactChecks,
          [p.recipientEmail]: {
            status: result.status,
            checkedAt: new Date().toISOString(),
          },
        };
        await chrome.storage.session.set({ contactChecks });
        renderChecks();
      }
      $("bulk-details").open = true;
      status(
        cancelBulk
          ? "Stopped the contact check. Completed results are saved for this session."
          : "Contact check complete. Prepare each payment to re-check its recipient and open the right form.",
      );
    } finally {
      checkingAll = false;
      cancelBulk = false;
      updateButtons();
    }
  }),
);
$("bulk-create").addEventListener("click", () =>
  task(async () => {
    pendingPayment =
      (await chrome.storage.session.get("pendingPayment")).pendingPayment ||
      null;
    if (pendingPayment)
      throw new Error(
        "Finish or reconcile the prepared payment before creating other contacts.",
      );
    if (liveMode) await refreshLive();
    const payments = missingContacts();
    if (!payments.length) {
      status("No checked missing contacts remain in the current payment list.");
      return;
    }
    checkingAll = true;
    cancelBulk = false;
    $("cancel-bulk").textContent = "Stop after this contact";
    updateButtons();
    let created = 0,
      existing = 0,
      ambiguous = 0;
    try {
      for (let i = 0; i < payments.length && !cancelBulk; i++) {
        const payment = payments[i];
        status(
          `Contact ${i + 1} of ${payments.length}: checking or creating ${payment.recipientName}… Keep the workspace open.`,
        );
        let result;
        try {
          result = await bankAction("ensure-contact", payment);
          if (!["created", "matched", "ambiguous"].includes(result.status))
            throw new Error(
              result.message || "Contact was not saved and verified.",
            );
        } catch (error) {
          contactChecks[payment.recipientEmail] = {
            status: "error",
            checkedAt: new Date().toISOString(),
            message: error.message,
          };
          await chrome.storage.session.set({ contactChecks });
          renderChecks();
          throw new Error(
            `Stopped at ${payment.recipientName}. ${created} created, ${existing} already existed. ${error.message} Review the bank screen before running the contact scan again.`,
          );
        }
        contactChecks[payment.recipientEmail] = {
          status: result.status,
          ...(result.contactName ? { contactName: result.contactName } : {}),
          checkedAt: new Date().toISOString(),
        };
        await chrome.storage.session.set({ contactChecks });
        if (result.status === "created") created++;
        else if (result.status === "matched") existing++;
        else ambiguous++;
        renderChecks();
      }
      $("bulk-details").open = true;
      status(
        `${cancelBulk ? "Stopped after the current contact" : "Contact creation complete"}: ${created} created and verified, ${existing} already existed, ${ambiguous} need manual selection. Choose a payment when ready.`,
      );
    } finally {
      checkingAll = false;
      cancelBulk = false;
      updateButtons();
    }
  }),
);
$("cancel-bulk").addEventListener("click", () => {
  cancelBulk = true;
  updateButtons();
});
for (const id of ["auto-next-enabled", "auto-next-volume", "auto-next-issue"])
  $(id).addEventListener("input", () => {
    autoNextDraftDirty = true;
  });
$("save-auto-next").addEventListener("click", () =>
  task(async () => {
    if ($("auto-next-enabled").checked) {
      if (
        !liveMode ||
        !liveSite ||
        !managerConnection?.live ||
        !autoWriteBack ||
        !connectedBankTabId
      )
        throw new Error(
          "Connect live OTEManager payments, enable automatic recording, and open the helper on Vancity first.",
        );
      autoNextConfig = validateAutoNext({
        enabled: true,
        volume: Number($("auto-next-volume").value),
        issue: Number($("auto-next-issue").value),
        origin: liveSite.origin,
        bankTabId: connectedBankTabId,
      });
    } else if (autoNextConfig)
      autoNextConfig = { ...autoNextConfig, enabled: false };
    await chrome.storage.local.set({ autoNextConfig });
    if (autoNextConfig?.enabled) {
      const result = await chrome.runtime.sendMessage({
        kind: "ote-update-next-scope",
      });
      if (result?.error) throw new Error(result.error);
    }
    autoNextDraftDirty = false;
    renderAutoNext();
    status(
      autoNextConfig?.enabled
        ? "Automatic preparation enabled. Return to Payments and choose Prepare next unpaid article now, or send a payment prepared through the helper to continue automatically."
        : "Automatic next-payment preparation stopped.",
    );
  }),
);
$("start-auto-next").addEventListener("click", () =>
  task(async () => {
    status("Refreshing the issue and preparing its next unpaid article…");
    const result = await chrome.runtime.sendMessage({ kind: "ote-start-next" });
    if (result?.error) throw new Error(result.error);
    status(
      result?.message || "Check Vancity and the automatic preparation status.",
    );
  }),
);
$("stop-auto-next").addEventListener("click", async () => {
  if (autoNextConfig) {
    autoNextConfig = { ...autoNextConfig, enabled: false };
    await chrome.storage.local.set({ autoNextConfig });
  }
  autoNextDraftDirty = false;
  renderAutoNext();
  status(
    "Automatic preparation stopped. Any current bank step will finish; no payment is sent automatically.",
  );
});
$("save-preset").addEventListener("click", () =>
  task(async () => {
    const preset = validateSecurityPreset({
      question: $("preset-question").value,
      answer: $("preset-answer").value,
    });
    await chrome.storage.local.set({ securityPreset: preset });
    securityPreset = preset;
    presetRevealed = false;
    presetDraftDirty = false;
    renderPreset(true);
    status("Saved the question and answer on this device. No unlock needed.");
  }),
);
$("show-preset").addEventListener("click", () => {
  presetRevealed = !presetRevealed;
  renderPreset();
});
function setView(settings) {
  $("payments-view").hidden = settings;
  $("settings-view").hidden = !settings;
  $("payments-tab").setAttribute("aria-selected", String(!settings));
  $("settings-tab").setAttribute("aria-selected", String(settings));
  presetRevealed = false;
  renderPreset();
}
$("payments-tab").addEventListener("click", () => setView(false));
$("settings-tab").addEventListener("click", () => setView(true));
$("open-settings").addEventListener("click", () => setView(true));
for (const id of ["preset-question", "preset-answer"])
  $(id).addEventListener("input", () => {
    presetDraftDirty = true;
    $("preset-status").textContent =
      "Unsaved changes. Save to use this question and answer.";
    updateButtons();
  });
$("forget-preset").addEventListener("click", () =>
  task(async () => {
    await chrome.storage.local.remove(["securityPreset", "securityVault"]);
    await chrome.storage.session.remove("securityPreset");
    securityPreset = null;
    presetRevealed = false;
    presetDraftDirty = false;
    renderPreset(true);
    status("Removed the saved question and answer.");
  }),
);
$("read-accounts").addEventListener("click", () =>
  task(async () => {
    const result = await bankAction("list-accounts");
    accountChoices = result.accounts.map((account) => ({
      ...validateSourceAccount(account),
      availableBalance:
        typeof account.availableBalance === "string"
          ? account.availableBalance
          : "",
    }));
    renderAccounts();
    status(
      "Read Vancity's source accounts. Choose one and Save default account.",
    );
  }),
);
$("use-current-account").addEventListener("click", () =>
  task(async () => {
    defaultSourceAccount = validateSourceAccount(
      (await bankAction("current-account")).account,
    );
    await chrome.storage.local.set({ defaultSourceAccount });
    if (
      !accountChoices.some(
        (account) =>
          account.accountNumber === defaultSourceAccount.accountNumber,
      )
    )
      accountChoices.push(defaultSourceAccount);
    renderAccounts();
    status(
      `Remembered ${defaultSourceAccount.name} as the default source account on this device.`,
    );
  }),
);
$("save-account").addEventListener("click", () =>
  task(async () => {
    const selected = $("source-account").value;
    defaultSourceAccount = selected
      ? validateSourceAccount(
          accountChoices.find((account) => account.accountNumber === selected),
        )
      : null;
    if (defaultSourceAccount)
      await chrome.storage.local.set({ defaultSourceAccount });
    else await chrome.storage.local.remove("defaultSourceAccount");
    renderAccounts();
    status(
      defaultSourceAccount
        ? "Saved the default source account on this device."
        : "The helper will use Vancity's selected account.",
    );
  }),
);
$("forget-account").addEventListener("click", () =>
  task(async () => {
    await chrome.storage.local.remove("defaultSourceAccount");
    defaultSourceAccount = null;
    renderAccounts();
    status(
      "Removed the helper's default source account. Vancity's own default stays as set in the bank.",
    );
  }),
);
$("sent").addEventListener("click", async () => {
  const p = selectedPayment();
  if ($("sent").disabled || !p || !$("sent-confirm").checked) return;
  for (const a of p.articles)
    sentArticles = {
      ...sentArticles,
      [a.id]: {
        reference: $("reference").value.trim(),
        recordedAt: new Date().toISOString(),
      },
    };
  await chrome.storage.session.set({ sentArticles });
  render();
  status(
    "Recorded your confirmation for this session. Mark the included articles paid in OTEManager after checking the bank confirmation.",
  );
});
render();
if (liveMode && liveSite) {
  await task(async () => {
    try {
      await refreshLive({ quiet: true });
    } catch (error) {
      liveError = error.message;
      renderLive();
      throw error;
    }
  });
}
setInterval(() => {
  if (
    liveMode &&
    !busy &&
    autoNextState?.phase !== "preparing" &&
    document.visibilityState !== "hidden"
  )
    void task(async () => {
      try {
        await refreshLive({ quiet: true });
      } catch (error) {
        liveError = error.message;
        renderLive();
      }
    });
}, 60000);
$("check-receipt").addEventListener("click", () =>
  task(async () => {
    const result = await chrome.runtime.sendMessage({
      kind: "ote-check-receipt",
    });
    if (result?.error) throw new Error(result.error);
    status(
      `Captured bank reference ${result.reference}. Check the receipt status below for OTEManager write-back.`,
    );
  }),
);
$("retry-receipts").addEventListener("click", () =>
  task(async () => {
    const result = await chrome.runtime.sendMessage({
      kind: "ote-retry-receipts",
    });
    if (result?.error) throw new Error(result.error);
    status("Retried saved receipts. Check their OTEManager status below.");
  }),
);
$("match-history").addEventListener("click", () =>
  task(async () => {
    const active = (
      await chrome.tabs.query({ active: true, currentWindow: true })
    )[0];
    const tabId =
      active?.url && new URL(active.url).origin === "https://my.vancity.com"
        ? active.id
        : connectedBankTabId;
    const result = await chrome.runtime.sendMessage({
      kind: "ote-match-sent-transfer",
      bankTabId: tabId,
    });
    if (result?.error) throw new Error(result.error);
    if (!result?.matched)
      throw new Error("No matching saved receipt was returned.");
    status(result.message);
  }),
);
$("download-receipts").addEventListener("click", () => {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          {
            kind: "ote-bank-receipts",
            schemaVersion: 1,
            receipts: Object.values(paymentReceipts),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "ote-bank-receipts.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
chrome.storage.onChanged?.addListener(async (changes, area) => {
  if (area === "local" && changes.autoNextConfig) {
    autoNextConfig = changes.autoNextConfig.newValue || null;
    renderAutoNext();
  }
  if (area === "session" && changes.autoNextStatus) {
    autoNextState = changes.autoNextStatus.newValue || null;
    renderAutoNext();
  }
  if (area === "session" && changes.pendingPayment) {
    pendingPayment = changes.pendingPayment.newValue || null;
    updateButtons();
  }
  if (area === "local" && changes.paymentReceipts) {
    paymentReceipts = changes.paymentReceipts.newValue || {};
    mergeCapturedSent();
    render();
  }
  if (area === "session" && changes.sentArticles) {
    sentArticles = changes.sentArticles.newValue || {};
    mergeCapturedSent();
    render();
  }
  if (
    area === "session" &&
    (changes.batch ||
      changes.managerConnection ||
      changes.autoWriteBack ||
      changes.liveFilters ||
      changes.publications)
  ) {
    const fresh = await chrome.storage.session.get([
      "batch",
      "managerConnection",
      "autoWriteBack",
      "messages",
      "selectedId",
      "contactChecks",
      "liveFilters",
      "publications",
    ]);
    try {
      batch = fresh.batch
        ? validateBatch(fresh.batch, {
            allowEmpty: fresh.managerConnection?.live === true,
          })
        : null;
    } catch {
      batch = null;
    }
    managerConnection = fresh.managerConnection || null;
    autoWriteBack = fresh.autoWriteBack === true && !!managerConnection;
    state.autoWriteBack = fresh.autoWriteBack;
    messages = fresh.messages || {};
    contactChecks = fresh.contactChecks || {};
    state.selectedId = fresh.selectedId;
    liveFilters = fresh.liveFilters || liveFilters;
    publications = fresh.publications || publications;
    render();
  }
});
