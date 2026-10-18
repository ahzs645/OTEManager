import { validateBatch, hasSentArticles } from "./contract.js";

export function validateAutoNext(config) {
  if (
    !config ||
    typeof config.enabled !== "boolean" ||
    ![config.volume, config.issue, config.bankTabId].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    )
  )
    throw new Error(
      "Choose a volume, issue, and connected Vancity tab for automatic preparation.",
    );
  const url = new URL(config.origin);
  if (
    url.origin !== config.origin ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    ) ||
    url.hostname === "my.vancity.com"
  )
    throw new Error("Connect to the original OTEManager site first.");
  return {
    enabled: config.enabled,
    volume: config.volume,
    issue: config.issue,
    bankTabId: config.bankTabId,
    origin: config.origin,
  };
}
export const sameAutoNext = (a, b) =>
  !!a &&
  !!b &&
  a.volume === b.volume &&
  a.issue === b.issue &&
  a.origin === b.origin &&
  a.bankTabId === b.bankTabId;

export function inAutoNextScope(payment, config) {
  return (
    payment?.articles?.length > 0 &&
    payment.articles.every(
      (a) => a.issue === `Vol ${config.volume}, Issue ${config.issue}`,
    )
  );
}

export function nextUnpaidPayment(batch, config, receipts, sentArticles = {}) {
  validateBatch(batch, { allowEmpty: true });
  if (
    batch.grouping !== "article" ||
    batch.payments.some((p) => !inAutoNextScope(p, config))
  )
    throw new Error(
      "OTEManager returned payments outside the automatic preparation scope.",
    );
  const sent = new Set(Object.keys(sentArticles));
  for (const entry of Object.values(receipts))
    for (const article of entry.data?.payment?.articles || [])
      sent.add(article.id);
  const next = batch.payments.find((p) => !hasSentArticles(p, [...sent]));
  if (next && (next.warnings.length || next.message.length > 400))
    throw new Error(
      `Review ${next.articles[0].title} in the helper before preparing it: ${next.warnings.join("; ") || "the bank message exceeds 400 characters"}.`,
    );
  return next || null;
}
