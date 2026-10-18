import { Store } from "../lib/store";
import { hasPassedApproval, NON_PAID_AUTHOR_TYPES } from "../../shared/model";
import {
  receiptText,
  validateConfirmation,
} from "../../extensions/vancity-payment-helper/receipt-contract.js";

/** One Convex transaction: either every included article and reference is
 * recorded, or none are. A repeated bank reference is an idempotent retry. */
export async function recordBankPayment(s: Store, input: unknown) {
  const data = validateConfirmation(input);
  const { payment, receipt } = data;
  if (JSON.stringify(data).length * payment.articles.length > 1_000_000)
    throw new Error(
      "This combined receipt is too large for one automatic record. Reconcile its articles manually using the saved reference.",
    );
  const ids = payment.articles.map((a) => a.id).sort();
  const existing = await s.ctx.db
    .query("articles")
    .withIndex("by_paymentBankReference", (q) =>
      q.eq("paymentBankReference", receipt.reference),
    )
    .take(101);
  if (existing.length) {
    if (
      JSON.stringify(existing.map((a) => a.id).sort()) !==
        JSON.stringify(ids) ||
      existing.some(
        (a) => !a.paymentStatus || a.paymentReceipt !== JSON.stringify(data),
      )
    )
      throw new Error(
        "This bank reference is already associated with a different payment. Review it in OTEManager.",
      );
    return {
      success: true as const,
      reference: receipt.reference,
      articleIds: ids,
      alreadyRecorded: true,
    };
  }
  const rows = [];
  for (const expected of payment.articles) {
    const article = await s.require("articles", expected.id);
    const author = await s.require("authors", article.authorId);
    const issue = article.issueId
      ? await s.require("issues", article.issueId)
      : null;
    const volume = issue
      ? (await s.require("volumes", issue.volumeId)).volumeNumber
      : article.volume;
    const issueNumber = issue?.issueNumber ?? article.issue;
    const publication =
      volume && issueNumber
        ? `Vol ${volume}, Issue ${issueNumber}`
        : "Unassigned issue";
    if (article.paymentStatus)
      throw new Error(
        "An included article is already paid. Review its existing payment before attaching this receipt.",
      );
    if (article.paymentBankReference || article.paymentReceipt)
      throw new Error(
        "An included article retains a previous bank receipt. Review it before recording another reference.",
      );
    if (
      !hasPassedApproval(article.internalStatus) ||
      NON_PAID_AUTHOR_TYPES.includes(author.authorType as any) ||
      article.authorId !== payment.authorId ||
      (author.etransferEmail?.trim() || author.email.trim()).toLowerCase() !==
        payment.recipientEmail ||
      article.paymentAmount !== expected.amountCents ||
      receiptText(article.title) !== receiptText(expected.title) ||
      publication !== expected.issue
    )
      throw new Error(
        "OTEManager's current author, email, article, publication, eligibility, or saved amount differs from the prepared payment. Nothing was changed.",
      );
    rows.push(article);
  }
  const recordedAt = new Date();
  for (const article of rows) {
    await s.patch("articles", article.id, {
      paymentStatus: true,
      paidAt: recordedAt,
      updatedAt: recordedAt,
      paymentBankReference: receipt.reference,
      paymentReceipt: JSON.stringify(data),
    });
    await s.insert("articleNotes", {
      articleId: article.id,
      createdBy: null,
      createdAt: recordedAt,
      content: `Vancity payment sent ${receipt.transferDate}: CAD $${(receipt.amountCents / 100).toFixed(2)} to ${receipt.recipientName}. Bank reference: ${receipt.reference}. Article allocation: CAD $${(article.paymentAmount! / 100).toFixed(2)}. Service fee: CAD $${(receipt.feeCents / 100).toFixed(2)}. Recorded automatically from the connected payment helper's matching send-success receipt.`,
    });
  }
  return {
    success: true as const,
    reference: receipt.reference,
    articleIds: ids,
    alreadyRecorded: false,
  };
}
