// Injected in Chrome's isolated world. Reads only the visible send-success
// dialog; it never clicks a bank control or reads question/answer inputs.
export function watchBankReceipt(watchId, once = false) {
  if (
    location.origin !== "https://my.vancity.com" ||
    !location.pathname.startsWith("/banking/")
  )
    return {
      status: "error",
      message: "Open the connected Vancity banking tab.",
    };
  const visible = (el) =>
    !!el?.getClientRects().length &&
    getComputedStyle(el).visibility !== "hidden" &&
    !el.closest('[hidden],[aria-hidden="true"]');
  const clean = (s) => s.replace(/\s+/g, " ").trim();
  const money = (s) => {
    const m = clean(s).match(/^(?:CAD\s*)?\$\s*([\d,]+)\.(\d{2})$/);
    if (!m || !/^\d+(?:,\d{3})*$/.test(m[1])) return null;
    const n = Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]);
    return Number.isSafeInteger(n) ? n : null;
  };
  function read() {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(
      visible,
    );
    const matches = [];
    for (const dialog of dialogs) {
      const success = dialog.querySelector(".ETRANSFERSENDMONEY.success");
      const description = success?.querySelector(
        ".confirmation-description-text",
      );
      if (
        !visible(success) ||
        !visible(description) ||
        clean(
          description.getAttribute("aria-label") || description.textContent,
        ) !== "Your transfer has been sent."
      )
        continue;
      const values = new Map();
      for (const row of success.querySelectorAll(
        "app-display-label-value-control",
      )) {
        if (!visible(row)) continue;
        const label = row.querySelector("mat-label");
        const value = row.querySelector("fpx-display-text");
        if (!label || !value) continue;
        const key = clean(
          label.getAttribute("aria-label") || label.textContent,
        );
        if (values.has(key)) return null;
        values.set(key, clean(value.textContent));
      }
      const val = (key) => values.get(key) || "";
      const amountCents = money(val("Amount")),
        feeCents = money(val("Service fee"));
      const source = val("Sent from").match(/\b(\d{8,20})\b/);
      if (
        val("Transaction Type") !== "Send Money" ||
        val("Notify by") !== "Email" ||
        !/^\d{20}$/.test(val("Reference #")) ||
        amountCents === null ||
        amountCents <= 0 ||
        feeCents === null ||
        !source ||
        !val("Message") ||
        !val("Transfer date") ||
        !val("Date")
      )
        continue;
      matches.push({
        bank: "Vancity",
        status: "sent",
        currency: "CAD",
        reference: val("Reference #"),
        recipientEmail: val("Email address").toLowerCase(),
        recipientName: val("Send to"),
        amountCents,
        feeCents,
        message: val("Message"),
        transferDate: val("Transfer date"),
        receiptDate: val("Date"),
        sourceAccountLastFour: source[1].slice(-4),
      });
    }
    return matches.length === 1 ? matches[0] : null;
  }
  if (once) {
    const receipt = read();
    return receipt
      ? { status: "receipt", receipt }
      : {
          status: "waiting",
          message:
            "No complete Vancity send-success receipt is visible. Leave the confirmation open after sending.",
        };
  }
  globalThis.__oteReceiptWatch?.stop();
  let timer, debounce;
  let stopped = false;
  const attempted = new Set();
  const observer = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(scan, 100);
  });
  function stop() {
    stopped = true;
    observer.disconnect();
    clearTimeout(timer);
    clearTimeout(debounce);
  }
  async function scan() {
    if (stopped) return;
    const receipt = read();
    if (!receipt || attempted.has(receipt.reference)) return;
    attempted.add(receipt.reference);
    try {
      const result = await chrome.runtime.sendMessage({
        kind: "ote-bank-receipt",
        watchId,
        receipt,
      });
      if (result?.captured) stop();
    } catch {
      attempted.delete(receipt.reference);
    }
  }
  // Ignore a receipt already open when a new form is armed. The explicit
  // Check confirmation action can recover a receipt after a page reload.
  const existing = read();
  if (existing) attempted.add(existing.reference);
  globalThis.__oteReceiptWatch = { stop };
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
  timer = setTimeout(stop, 30 * 60 * 1000);
  return { status: "watching" };
}
