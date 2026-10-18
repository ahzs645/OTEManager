// Reads only a transfer detail already opened by the user in Vancity's Sent
// view. No buttons, bank requests, security fields, or account balances.
export function readSentTransfer() {
  try {
    if (
      location.origin !== "https://my.vancity.com" ||
      location.pathname.replace(/\/$/, "") !==
        "/banking/etransfers-space/etransfers"
    )
      throw new Error(
        "Open Vancity → e-Transfers → Sent, then open the transfer details.",
      );
    const visible = (el) =>
      !!el?.getClientRects().length &&
      getComputedStyle(el).visibility !== "hidden" &&
      !el.closest('[hidden],[aria-hidden="true"]');
    const clean = (s) => s.replace(/\s+/g, " ").trim();
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(
      visible,
    );
    if (
      dialogs.length !== 1 ||
      !/Transfer details/.test(dialogs[0].textContent)
    )
      throw new Error(
        "Open one transfer's details in Vancity's Sent list first.",
      );
    const fields = new Map();
    for (const row of dialogs[0].querySelectorAll(
      ".scheduled-bill-details-content-item",
    )) {
      if (!visible(row)) continue;
      const label = clean(row.querySelector(".item-title")?.textContent || "");
      if (fields.has(label))
        throw new Error(
          "The transfer details contain repeated labels. Check Vancity.",
        );
      const parts = [...row.querySelectorAll(".item-value")].map((el) =>
        clean(el.textContent),
      );
      fields.set(label, parts.join(" "));
    }
    const amount = (fields.get("Amount") || "")
      .replace(/^Minus\s*/, "")
      .match(/^-\s*\$\s*(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/);
    const account = (fields.get("Sent from") || "").match(/\b(\d{8,20})\b/);
    const email = (fields.get("Notified by") || "").toLowerCase();
    const date = fields.get("Transaction date") || "";
    const status = fields.get("Status") || "";
    const message = fields.get("Message") || "";
    if (
      !amount ||
      !account ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^\d{1,2} [A-Za-z]{3} \d{4} \d{2}:\d{2}$/.test(date) ||
      ![
        "Pending",
        "Completed",
        "Deposited",
        "Accepted",
        "Cancelled",
        "Canceled",
        "Expired",
        "Declined",
        "Returned",
      ].includes(status) ||
      !message ||
      message.length > 400 ||
      !fields.get("Sent to")
    )
      throw new Error(
        "The open Sent transfer is incomplete or unsupported. Use the original send receipt.",
      );
    const amountCents =
      Number(amount[1].replaceAll(",", "")) * 100 + Number(amount[2]);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0)
      throw new Error("Invalid transfer amount.");
    return {
      status: "history-detail",
      detail: {
        recipientEmail: email,
        recipientName: fields.get("Sent to"),
        amountCents,
        message,
        transactionDate: date,
        bankStatus: status,
        sourceAccountLastFour: account[1].slice(-4),
      },
    };
  } catch (error) {
    return { status: "error", message: error.message };
  }
}

export function matchSentTransfer(detail, receipts) {
  const clean = (s) => s.replace(/\s+/g, " ").trim();
  const matches = Object.entries(receipts).filter(([, entry]) => {
    const receipt = entry.data?.receipt;
    return (
      receipt &&
      detail.recipientEmail === receipt.recipientEmail &&
      detail.amountCents === receipt.amountCents &&
      clean(detail.message) === clean(receipt.message) &&
      detail.sourceAccountLastFour === receipt.sourceAccountLastFour &&
      detail.transactionDate === clean(receipt.receiptDate.replace(" - ", " "))
    );
  });
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? "More than one saved receipt matches these details. Review the original references."
        : "No saved send receipt matches the email, amount, message, date and source account. History alone does not supply the original bank receipt reference.",
    );
  return { reference: matches[0][0], entry: matches[0][1] };
}
