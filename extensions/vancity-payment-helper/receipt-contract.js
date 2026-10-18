// Shared by the extension and OTEManager: strip unknown fields and validate
// the exact prepared payment before a bank observation can be reconciled.
export const receiptText = (value) => value.replace(/\s+/g, " ").trim();

export function validateConfirmation(input) {
  const fail = (message) => {
    throw new Error(message);
  };
  const text = (value, max, label) => {
    if (typeof value !== "string" || !value.trim() || value.length > max)
      fail(`Invalid ${label}.`);
    return value.trim();
  };
  const cents = (value, zero = false) => {
    if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1))
      fail("Invalid receipt amount.");
    return value;
  };
  const email = (value) => {
    const result = text(value, 64, "recipient email").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))
      fail("Invalid recipient email.");
    return result;
  };
  if (!input || typeof input !== "object" || !input.payment || !input.receipt)
    fail("A prepared payment and bank receipt are required.");
  const p = input.payment,
    r = input.receipt;
  if (r.bank !== "Vancity" || r.status !== "sent" || r.currency !== "CAD")
    fail("A successful Vancity CAD send receipt is required.");
  const reference = text(r.reference, 40, "bank reference");
  if (!/^\d{20}$/.test(reference))
    fail("The Vancity bank reference is not recognised.");
  if (
    !Array.isArray(p.articles) ||
    !p.articles.length ||
    p.articles.length > 100
  )
    fail("Include between 1 and 100 articles.");
  const articles = p.articles.map((a) => ({
    id: text(a?.id, 100, "article ID"),
    title: text(a?.title, 1000, "article title"),
    issue: text(a?.issue, 100, "publication"),
    amountCents: cents(a?.amountCents),
  }));
  if (new Set(articles.map((a) => a.id)).size !== articles.length)
    fail("Duplicate article in payment.");
  const payment = {
    id: text(p.id, 200, "payment ID"),
    authorId: text(p.authorId, 100, "author ID"),
    recipientEmail: email(p.recipientEmail),
    amountCents: cents(p.amountCents),
    articles,
  };
  const receipt = {
    bank: "Vancity",
    status: "sent",
    currency: "CAD",
    reference,
    recipientEmail: email(r.recipientEmail),
    amountCents: cents(r.amountCents),
    feeCents: cents(r.feeCents, true),
    message: text(r.message, 400, "bank message"),
    transferDate: text(r.transferDate, 64, "transfer date"),
    receiptDate: text(r.receiptDate, 64, "receipt date"),
    recipientName: text(r.recipientName, 120, "bank recipient name"),
    sourceAccountLastFour: text(r.sourceAccountLastFour, 4, "source account"),
  };
  if (!/^\d{4}$/.test(receipt.sourceAccountLastFour))
    fail("Invalid source account.");
  const expectedMessage = text(input.expectedMessage, 400, "prepared message");
  if (
    receipt.recipientEmail !== payment.recipientEmail ||
    receipt.amountCents !== payment.amountCents ||
    receiptText(receipt.message) !== receiptText(expectedMessage) ||
    articles.reduce((n, a) => n + a.amountCents, 0) !== payment.amountCents
  )
    fail(
      "Bank receipt does not match the prepared email, amount, article total, and message.",
    );
  return {
    batchId: text(input.batchId, 100, "batch ID"),
    exportedAt: text(input.exportedAt, 64, "export date"),
    expectedMessage,
    payment,
    receipt,
  };
}
