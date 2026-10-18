import { validateBatch } from "./contract.js";
import { validateConfirmation } from "./receipt-contract.js";
import { watchBankReceipt } from "./bank-receipt.js";
import { writePaymentConfirmation, readLivePayments } from "./manager-page.js";
import { managerSite, requestManager } from "./manager-client.js";
import { executeBankAction } from "./bank.js";
import { initializeHelperSurface, saveHelperSurface } from "./surface.js";
import { readSentTransfer, matchSentTransfer } from "./bank-history.js";
import { isBankingTab } from "./bank-tab.js";
import { validateSecurityPreset } from "./security-preset.js";
import { validateSourceAccount } from "./account-preset.js";
import {
  validateAutoNext,
  sameAutoNext,
  inAutoNextScope,
  nextUnpaidPayment,
} from "./auto-next.js";

const bankTab = isBankingTab;
const extensionPage = (sender) =>
  sender.id === chrome.runtime.id &&
  sender.url?.split("?")[0] === chrome.runtime.getURL("popup.html");

void initializeHelperSurface().catch(() => {});

async function sync(reference, retry = false) {
  const { paymentReceipts = {} } =
    await chrome.storage.local.get("paymentReceipts");
  const entry = paymentReceipts[reference];
  if (!entry || entry.synced || !entry.connection) return entry;
  try {
    const { managerConnection, autoWriteBack } =
      await chrome.storage.session.get(["managerConnection", "autoWriteBack"]);
    if (!autoWriteBack)
      throw new Error(
        "Automatic OTEManager recording is off. Enable it to retry this receipt.",
      );
    let connection = retry ? managerConnection : entry.connection;
    // The saved origin is immutable for each receipt. In live mode, a reload
    // or closed app tab can be reopened without a manual import/reconnect.
    if (entry.connection.live) {
      const { managerSiteUrl, liveMode } = await chrome.storage.local.get([
        "managerSiteUrl",
        "liveMode",
      ]);
      const site = managerSite(managerSiteUrl);
      if (!liveMode || site.origin !== entry.connection.origin)
        throw new Error(
          "Reconnect the original OTEManager site before retrying this receipt.",
        );
      const fresh = await requestManager(
        site,
        { connectionOnly: true },
        readLivePayments,
      );
      connection = fresh.connection;
      retry = true;
      await chrome.storage.session.set({ managerConnection: connection });
    }
    if (!connection || connection.origin !== entry.connection.origin)
      throw new Error(
        "Reconnect the original OTEManager site before retrying. Receipts cannot be written to another environment.",
      );
    const tab = await chrome.tabs.get(connection.tabId);
    const url = new URL(tab.url || "");
    if (
      url.origin !== connection.origin ||
      url.pathname.replace(/\/$/, "") !== "/utilities/payment-manager"
    )
      throw new Error(
        "The connected OTEManager tab is unavailable. Reopen it, reconnect, and retry.",
      );
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: writePaymentConfirmation,
      args: [entry.data, connection, retry],
    });
    const result = results[0]?.result;
    if (!result?.success)
      throw new Error(result?.error || "OTEManager did not return a result.");
    const ids = entry.data.payment.articles.map((a) => a.id).sort();
    if (
      result.reference !== reference ||
      JSON.stringify([...result.articleIds].sort()) !== JSON.stringify(ids)
    )
      throw new Error(
        "OTEManager returned a different payment result. Review the saved receipt.",
      );
    entry.synced = true;
    entry.syncedAt = new Date().toISOString();
    entry.error = "";
  } catch (error) {
    entry.error = error.message;
  }
  await chrome.storage.local.set({ paymentReceipts });
  await chrome.action.setBadgeText({ text: entry.synced ? "✓" : "!" });
  if (entry.synced && entry.autoNext) await prepareNext(reference, true);
  return entry;
}
async function capture(receipt, pending) {
  const data = validateConfirmation({ ...pending.data, receipt });
  const { paymentReceipts = {} } =
    await chrome.storage.local.get("paymentReceipts");
  const previous = paymentReceipts[receipt.reference];
  if (previous && JSON.stringify(previous.data) !== JSON.stringify(data))
    throw new Error(
      "That reference is already stored for a different payment.",
    );
  if (!previous && Object.keys(paymentReceipts).length >= 500)
    throw new Error(
      "The saved receipt journal is full. Download the receipts, then manage this extension’s local data before recording more.",
    );
  if (!previous)
    paymentReceipts[receipt.reference] = {
      data,
      connection: pending.connection,
      capturedAt: new Date().toISOString(),
      synced: false,
      error: "",
      bankTabId: pending.bankTabId,
      autoNext: pending.autoNext || null,
    };
  // Save durable evidence before attempting any write-back. A failed app
  // connection cannot turn a confirmed bank transfer back into "unsent".
  await chrome.storage.local.set({ paymentReceipts });
  const { sentArticles = {} } =
    await chrome.storage.session.get("sentArticles");
  for (const a of data.payment.articles)
    sentArticles[a.id] = {
      reference: receipt.reference,
      recordedAt: paymentReceipts[receipt.reference].capturedAt,
    };
  await chrome.storage.session.set({ sentArticles });
  await chrome.storage.session.remove("pendingPayment");
  if (pending.connection) await sync(receipt.reference);
  else await chrome.action.setBadgeText({ text: "✓" });
  return { captured: true, reference: receipt.reference };
}
async function armReceipt(message) {
  const tab = await chrome.tabs.get(message.bankTabId);
  if (!bankTab(tab)) throw new Error("The connected bank tab is unavailable.");
  const batch = validateBatch(message.batch);
  const payment = batch.payments.find((p) => p.id === message.paymentId);
  if (
    !payment ||
    !message.expectedMessage?.trim() ||
    message.expectedMessage.length > 400
  )
    throw new Error("A valid prepared payment is required.");
  const { paymentReceipts = {} } =
    await chrome.storage.local.get("paymentReceipts");
  if (
    Object.values(paymentReceipts).some((e) =>
      e.data.payment.articles.some((a) =>
        payment.articles.some((b) => a.id === b.id),
      ),
    )
  )
    throw new Error(
      "An included article already has a captured bank receipt. Reconcile it before preparing another transfer.",
    );
  const { managerConnection, autoWriteBack } = await chrome.storage.session.get(
    ["managerConnection", "autoWriteBack"],
  );
  const { pendingPayment: previousPending } =
    await chrome.storage.session.get("pendingPayment");
  if (
    previousPending &&
    (previousPending.bankTabId !== tab.id ||
      previousPending.data.payment.id !== payment.id)
  )
    throw new Error(
      "Another prepared payment is waiting for confirmation. Finish or reconcile it first.",
    );
  const { autoNextConfig } = await chrome.storage.local.get("autoNextConfig");
  const config = autoNextConfig?.enabled
    ? validateAutoNext(autoNextConfig)
    : null;
  const pendingPayment = {
    bankTabId: tab.id,
    watchId: crypto.randomUUID(),
    connection: autoWriteBack ? managerConnection || null : null,
    autoNext:
      config &&
      autoWriteBack &&
      managerConnection?.live &&
      managerConnection.origin === config.origin &&
      config.bankTabId === tab.id &&
      inAutoNextScope(payment, config)
        ? config
        : null,
    data: {
      batchId: batch.batchId,
      exportedAt: batch.createdAt,
      expectedMessage: message.expectedMessage,
      payment: {
        id: payment.id,
        authorId: payment.authorId,
        recipientEmail: payment.recipientEmail,
        amountCents: payment.amountCents,
        articles: payment.articles.map(({ id, title, issue, amountCents }) => ({
          id,
          title,
          issue,
          amountCents,
        })),
      },
    },
  };
  await chrome.storage.session.set({ pendingPayment });
  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: watchBankReceipt,
    args: [pendingPayment.watchId],
  });
  if (result[0]?.result?.status !== "watching")
    throw new Error(
      "The bank receipt watcher could not start. Use Check bank confirmation after sending.",
    );
  return { watching: true };
}

async function autoNextStatus(phase, message, extra = {}) {
  await chrome.storage.session.set({
    autoNextStatus: {
      phase,
      message,
      ...extra,
      updatedAt: new Date().toISOString(),
    },
  });
}
async function saveAttempt(reference, patch) {
  const { paymentReceipts = {} } =
    await chrome.storage.local.get("paymentReceipts");
  if (!paymentReceipts[reference])
    throw new Error("The recorded receipt is unavailable.");
  paymentReceipts[reference].nextPreparation = {
    ...paymentReceipts[reference].nextPreparation,
    ...patch,
  };
  await chrome.storage.local.set({ paymentReceipts });
}
async function checkAutoNext(config) {
  const local = await chrome.storage.local.get([
    "autoNextConfig",
    "managerSiteUrl",
    "liveMode",
  ]);
  const { autoWriteBack } = await chrome.storage.session.get("autoWriteBack");
  if (
    !local.autoNextConfig?.enabled ||
    !sameAutoNext(local.autoNextConfig, config)
  )
    throw new Error(
      "Automatic next-payment preparation was stopped or its scope changed.",
    );
  if (
    !local.liveMode ||
    !autoWriteBack ||
    managerSite(local.managerSiteUrl).origin !== config.origin
  )
    throw new Error(
      "Automatic preparation requires live payments and receipt recording on the original OTEManager site.",
    );
  const tab = await chrome.tabs.get(config.bankTabId);
  if (!bankTab(tab) || new URL(tab.url).pathname.includes("/http-status/"))
    throw new Error(
      "The connected Vancity tab is unavailable. Sign in and reconnect the helper.",
    );
  return managerSite(local.managerSiteUrl);
}
async function autoBank(config, action, payment = null, receipt = null) {
  await checkAutoNext(config);
  const saved = await chrome.storage.local.get([
    "securityPreset",
    "defaultSourceAccount",
  ]);
  const result = await chrome.scripting.executeScript({
    target: { tabId: config.bankTabId },
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
      payment?.message || "",
      saved.securityPreset
        ? validateSecurityPreset(saved.securityPreset)
        : null,
      saved.defaultSourceAccount
        ? validateSourceAccount(saved.defaultSourceAccount)
        : null,
      receipt,
    ],
  });
  if (!result[0]?.result || result[0].result.status === "error")
    throw new Error(
      result[0]?.result?.message ||
        "Vancity did not return a preparation result.",
    );
  return result[0].result;
}
let preparingNext = false;
// A persisted claim prevents replay after a worker restart. Surface an
// interrupted attempt so the user can inspect the bank instead of leaving
// the workspace locked in a stale "preparing" state.
const startupRecovery = (async () => {
  const { autoNextStatus: status } =
    await chrome.storage.session.get("autoNextStatus");
  if (status?.phase !== "preparing") return;
  const message =
    "Automatic preparation was interrupted. Check Vancity and use Prepare manually for the selected article; this receipt will not replay bank steps.";
  const { paymentReceipts = {} } =
    await chrome.storage.local.get("paymentReceipts");
  if (paymentReceipts[status.reference]?.nextPreparation)
    await saveAttempt(status.reference, { phase: "error", error: message });
  await autoNextStatus("error", message, { reference: status.reference });
})();
async function prepareNext(reference, automatic = false) {
  if (preparingNext) return { busy: true };
  preparingNext = true;
  let claimed = false;
  try {
    const { autoNextConfig, paymentReceipts = {} } =
      await chrome.storage.local.get(["autoNextConfig", "paymentReceipts"]);
    if (automatic && !autoNextConfig?.enabled) return { skipped: true };
    const config = validateAutoNext(autoNextConfig);
    const entry = paymentReceipts[reference];
    if (
      !config.enabled ||
      !entry?.synced ||
      !entry.connection?.live ||
      entry.connection.origin !== config.origin ||
      !inAutoNextScope(entry.data.payment, config)
    )
      throw new Error(
        "A payment recorded in this live OTEManager issue is required before preparing the next article.",
      );
    if (
      automatic &&
      (!sameAutoNext(entry.autoNext, config) ||
        entry.bankTabId !== config.bankTabId)
    )
      return { skipped: true };
    if (
      entry.nextPreparation &&
      (automatic ||
        entry.nextPreparation.phase !== "error" ||
        entry.nextPreparation.bankStarted)
    )
      return {
        skipped: true,
        message:
          "Next preparation already ran for this receipt. Check the bank form or prepare its selected payment manually.",
      };
    const { pendingPayment, sentArticles = {} } =
      await chrome.storage.session.get(["pendingPayment", "sentArticles"]);
    if (pendingPayment)
      throw new Error(
        "A prepared payment is already waiting for bank confirmation. Finish or reconcile it first.",
      );
    const site = await checkAutoNext(config);
    await saveAttempt(reference, {
      phase: "preparing",
      bankStarted: false,
      startedAt: new Date().toISOString(),
    });
    claimed = true;
    await autoNextStatus(
      "preparing",
      `OTEManager recorded the payment. Refreshing Volume ${config.volume}, Issue ${config.issue} for the next unpaid article.`,
      { reference },
    );
    const filters = {
      volume: config.volume,
      issue: config.issue,
      grouping: "article",
      search: "",
    };
    const catalog = await requestManager(site, filters, readLivePayments);
    await checkAutoNext(config);
    const next = nextUnpaidPayment(
      catalog.batch,
      config,
      paymentReceipts,
      sentArticles,
    );
    await chrome.storage.session.set({
      batch: catalog.batch,
      managerConnection: catalog.connection,
      liveFilters: filters,
      publications: catalog.publications || [],
      selectedId: next?.id || null,
      messages: {},
    });
    if (!next) {
      const message = `No eligible unpaid articles remain in Volume ${config.volume}, Issue ${config.issue}${catalog.batch.skipped?.length ? `; ${catalog.batch.skipped.length} excluded or needing attention` : ""}.`;
      await saveAttempt(reference, { phase: "complete" });
      await autoNextStatus("complete", message, { reference });
      return { complete: true, message };
    }
    if ((await chrome.storage.session.get("pendingPayment")).pendingPayment)
      throw new Error(
        "Another payment was prepared while refreshing. Review Vancity before continuing.",
      );
    await checkAutoNext(config);
    await saveAttempt(reference, {
      bankStarted: true,
      paymentId: next.id,
      articleId: next.articles[0].id,
    });
    await autoNextStatus(
      "preparing",
      `Preparing ${next.recipientName} · ${next.articles[0].title}. Final Send/Confirm remains yours.`,
      { reference, paymentId: next.id },
    );
    await autoBank(config, "leave-recorded-receipt", null, entry.data.receipt);
    const filled = await autoBank(config, "prepare", next);
    if (filled.status !== "filled")
      throw new Error(
        filled.message || "The next payment needs manual preparation.",
      );
    await checkAutoNext(config);
    await armReceipt({
      bankTabId: config.bankTabId,
      batch: catalog.batch,
      paymentId: next.id,
      expectedMessage: next.message,
    });
    const review = await autoBank(config, "open-review", next);
    if (review.status !== "reviewed")
      throw new Error(
        "The next payment Review was not verified. Check Vancity.",
      );
    await saveAttempt(reference, { phase: "review" });
    const message = `Ready on Review: ${next.recipientName} · ${next.articles[0].title}. Review and click the final Send/Confirm yourself.`;
    await autoNextStatus("review", message, { reference, paymentId: next.id });
    await chrome.action.setBadgeText({ text: "R" });
    // Activating an existing tab is optional; the verified Review remains
    // ready even if Chrome cannot bring that window forward.
    await chrome.tabs
      .update(config.bankTabId, { active: true })
      .catch(() => {});
    return { prepared: true, message };
  } catch (error) {
    if (claimed)
      await saveAttempt(reference, { phase: "error", error: error.message });
    const { autoNextConfig } = await chrome.storage.local.get("autoNextConfig");
    await autoNextStatus(
      autoNextConfig?.enabled ? "error" : "paused",
      error.message,
      { reference },
    );
    await chrome.action.setBadgeText({
      text: autoNextConfig?.enabled ? "!" : "",
    });
    return { error: error.message };
  } finally {
    preparingNext = false;
  }
}

export async function handleReceiptMessage(message, sender) {
  await startupRecovery;
  if (message?.kind === "ote-bank-receipt") {
    const { pendingPayment } =
      await chrome.storage.session.get("pendingPayment");
    if (
      sender.id !== chrome.runtime.id ||
      sender.frameId !== 0 ||
      !bankTab(sender.tab) ||
      !pendingPayment ||
      pendingPayment.bankTabId !== sender.tab.id ||
      pendingPayment.watchId !== message.watchId
    )
      throw new Error(
        "No matching prepared payment is waiting for this bank tab.",
      );
    return capture(message.receipt, pendingPayment);
  }
  if (!extensionPage(sender))
    throw new Error("Only the payment helper can request this action.");
  if (message?.kind === "ote-set-surface")
    return saveHelperSurface(message.surface);
  if (message?.kind === "ote-match-sent-transfer") {
    const tab = await chrome.tabs.get(message.bankTabId);
    if (!bankTab(tab))
      throw new Error("Open the helper on the Vancity Sent history tab first.");
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readSentTransfer,
    });
    const result = results[0]?.result;
    if (result?.status !== "history-detail")
      throw new Error(
        result?.message || "The Sent transfer could not be read.",
      );
    const { paymentReceipts = {} } =
      await chrome.storage.local.get("paymentReceipts");
    const { reference, entry } = matchSentTransfer(
      result.detail,
      paymentReceipts,
    );
    entry.historyCheck = {
      bankStatus: result.detail.bankStatus,
      transactionDate: result.detail.transactionDate,
      checkedAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ paymentReceipts });
    const { pendingPayment } =
      await chrome.storage.session.get("pendingPayment");
    if (
      pendingPayment &&
      pendingPayment.data.expectedMessage === entry.data.expectedMessage &&
      pendingPayment.data.payment.recipientEmail ===
        entry.data.payment.recipientEmail &&
      pendingPayment.data.payment.amountCents ===
        entry.data.payment.amountCents &&
      JSON.stringify(
        pendingPayment.data.payment.articles.map((a) => a.id).sort(),
      ) === JSON.stringify(entry.data.payment.articles.map((a) => a.id).sort())
    )
      await chrome.storage.session.remove("pendingPayment");
    const changed = [
      "Cancelled",
      "Canceled",
      "Expired",
      "Declined",
      "Returned",
    ].includes(result.detail.bankStatus);
    return {
      matched: true,
      reference,
      message: `${result.detail.recipientName}: Sent history matches receipt ${reference}. Bank status: ${result.detail.bankStatus}. ${changed ? "Review this changed bank status and reconcile the article in OTEManager." : entry.synced ? "Already recorded in OTEManager; no duplicate payment record was added." : "Use Retry OTEManager write-back to record the saved original receipt."}`,
    };
  }
  if (message?.kind === "ote-auto-next-status") {
    return chrome.storage.session.get("autoNextStatus");
  }
  if (message?.kind === "ote-update-next-scope") {
    const { autoNextConfig } = await chrome.storage.local.get("autoNextConfig");
    const config = validateAutoNext(autoNextConfig);
    const { pendingPayment } =
      await chrome.storage.session.get("pendingPayment");
    // This runs in the same serial queue as capture, so enabling the option
    // cannot resurrect a pending payment that has just been recorded.
    if (
      config.enabled &&
      pendingPayment?.connection?.live &&
      pendingPayment.connection.origin === config.origin &&
      pendingPayment.bankTabId === config.bankTabId &&
      inAutoNextScope(pendingPayment.data.payment, config)
    ) {
      pendingPayment.autoNext = config;
      await chrome.storage.session.set({ pendingPayment });
    }
    return { updated: true };
  }
  if (message?.kind === "ote-start-next") {
    const { autoNextConfig, paymentReceipts = {} } =
      await chrome.storage.local.get(["autoNextConfig", "paymentReceipts"]);
    const config = validateAutoNext(autoNextConfig);
    const latest = Object.entries(paymentReceipts)
      .filter(
        ([, e]) =>
          e.synced &&
          e.connection?.live &&
          e.connection.origin === config.origin &&
          inAutoNextScope(e.data.payment, config),
      )
      .sort(([, a], [, b]) => b.capturedAt.localeCompare(a.capturedAt))[0];
    if (!latest)
      throw new Error(
        "Prepare and record a payment in this issue first, then start automatic next preparation.",
      );
    return prepareNext(latest[0]);
  }
  if (message?.kind === "ote-arm-receipt") return armReceipt(message);
  if (message?.kind === "ote-check-receipt") {
    const { pendingPayment } =
      await chrome.storage.session.get("pendingPayment");
    if (!pendingPayment)
      throw new Error(
        "No prepared payment is waiting for confirmation. Prepare through the helper first.",
      );
    const tab = await chrome.tabs.get(pendingPayment.bankTabId);
    if (!bankTab(tab))
      throw new Error("The connected bank tab is unavailable.");
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: watchBankReceipt,
      args: [pendingPayment.watchId, true],
    });
    const result = results[0]?.result;
    if (result?.status !== "receipt")
      throw new Error(
        result?.message || "No complete send receipt is visible.",
      );
    return capture(result.receipt, pendingPayment);
  }
  if (message?.kind === "ote-retry-receipts") {
    const { paymentReceipts = {} } =
      await chrome.storage.local.get("paymentReceipts");
    for (const [reference, entry] of Object.entries(paymentReceipts))
      if (entry.connection && !entry.synced) await sync(reference, true);
    return { retried: true };
  }
  throw new Error("Unknown payment receipt action.");
}
let serial = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    ![
      "ote-bank-receipt",
      "ote-arm-receipt",
      "ote-check-receipt",
      "ote-retry-receipts",
      "ote-start-next",
      "ote-auto-next-status",
      "ote-update-next-scope",
      "ote-set-surface",
      "ote-match-sent-transfer",
    ].includes(message?.kind)
  )
    return;
  const work = serial.then(() => handleReceiptMessage(message, sender));
  serial = work.catch(() => {});
  work.then(respond, (error) => respond({ error: error.message }));
  return true;
});
