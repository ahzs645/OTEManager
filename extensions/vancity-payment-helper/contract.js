const text = (value, max = 10000) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const cents = (value) => Number.isSafeInteger(value) && value > 0;
const email = (value) =>
  text(value, 64) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function validateBatch(batch, { allowEmpty = false } = {}) {
  const fail = () => {
    throw new Error(
      "Invalid OTE payment export. Export a fresh file from Payment Manager.",
    );
  };
  if (
    !batch ||
    batch.kind !== "ote-payment-batch" ||
    batch.schemaVersion !== 1 ||
    batch.currency !== "CAD" ||
    !["article", "author"].includes(batch.grouping) ||
    !text(batch.batchId, 200) ||
    !text(batch.createdAt, 100) ||
    !Number.isFinite(Date.parse(batch.createdAt)) ||
    !Array.isArray(batch.payments) ||
    (!allowEmpty && !batch.payments.length) ||
    batch.payments.length > 1000
  )
    fail();
  const ids = new Set();
  const articles = new Set();
  for (const p of batch.payments) {
    if (
      !p ||
      !text(p.id, 300) ||
      ids.has(p.id) ||
      !text(p.authorId, 200) ||
      !text(p.recipientName, 200) ||
      !email(p.recipientEmail) ||
      !cents(p.amountCents) ||
      !["etransfer", "author"].includes(p.emailSource) ||
      typeof p.autoDepositRecorded !== "boolean" ||
      !text(p.message, 100000) ||
      !Array.isArray(p.warnings) ||
      !p.warnings.every((w) => text(w)) ||
      !Array.isArray(p.articles) ||
      !p.articles.length ||
      (batch.grouping === "article" && p.articles.length !== 1)
    )
      fail();
    ids.add(p.id);
    let total = 0;
    for (const a of p.articles) {
      if (
        !a ||
        !text(a.id, 200) ||
        articles.has(a.id) ||
        !text(a.title) ||
        !text(a.issue, 200) ||
        !cents(a.amountCents) ||
        !Array.isArray(a.items) ||
        !a.items.length ||
        !a.items.every(
          (i) => i && text(i.description) && cents(i.amountCents),
        ) ||
        a.items.reduce((sum, i) => sum + i.amountCents, 0) !== a.amountCents
      )
        fail();
      articles.add(a.id);
      total += a.amountCents;
    }
    if (total !== p.amountCents || !cents(total)) fail();
  }
  return batch;
}

export function paymentWarnings(batch, payment, now = Date.now()) {
  const warnings = [...payment.warnings];
  if (payment.emailSource === "author")
    warnings.push(
      "Confirm the author email is the intended e-transfer address.",
    );
  if (
    now - Date.parse(batch.createdAt) > 24 * 60 * 60 * 1000 ||
    Date.parse(batch.createdAt) > now + 60000
  )
    warnings.push(
      "This export is old or has a future date. Check the current unpaid amounts in OTEManager.",
    );
  return [...new Set(warnings)];
}

export function hasSentArticles(payment, sentArticleIds) {
  return payment.articles.some((a) => sentArticleIds.includes(a.id));
}
