import type {
  LivePaymentCatalog,
  LivePaymentFilter,
  PaymentExportBatch,
} from "../../shared/payment-export";
import {
  validateConfirmation,
  type PaymentConfirmation,
} from "../../extensions/vancity-payment-helper/receipt-contract.js";

type Recorded = {
  success: true;
  reference: string;
  articleIds: string[];
  alreadyRecorded: boolean;
};
type Result = Recorded | { success: false; error: string };

/** Same-page bridge to the existing authenticated application-server path.
 * No server credential, bank script, account number or security answer crosses
 * this bridge. The backend rechecks current records in one transaction. */
export function installPaymentHelperConnection({
  document,
  currentBatch,
  listPayments,
  record,
  onRecorded,
}: {
  document: Document;
  currentBatch: () => PaymentExportBatch | null;
  listPayments?: (filter: LivePaymentFilter) => Promise<LivePaymentCatalog>;
  record: (data: PaymentConfirmation) => Promise<Result>;
  onRecorded: (result: Recorded) => void;
}) {
  const win = document.defaultView!;
  const bridgeId = crypto.randomUUID();
  const marker = document.createElement("script");
  marker.id = "ote-payment-helper-connection";
  marker.type = "application/json";
  marker.textContent = JSON.stringify({
    protocolVersion: 1,
    bridgeId,
    capabilities: listPayments ? ["live-payments"] : [],
  });
  document.body.append(marker);
  let disposed = false;
  const running = new Set<string>();
  const liveBatches = new Map<string, PaymentExportBatch>();
  const listHandler = async (event: Event) => {
    let node: HTMLElement | null = null;
    let requestId = "";
    try {
      const detail = (event as CustomEvent).detail;
      if (!listPayments || typeof detail !== "string" || detail.length > 300)
        return;
      const request = JSON.parse(detail);
      if (
        request.bridgeId !== bridgeId ||
        !/^[\w-]{1,100}$/.test(request.requestId)
      )
        return;
      requestId = request.requestId;
      node = document.getElementById(`ote-payment-list-${requestId}`);
      if (
        !node ||
        node.tagName !== "SCRIPT" ||
        node.getAttribute("type") !== "application/json" ||
        !node.textContent ||
        node.textContent.length > 1000 ||
        running.has(requestId)
      )
        return;
      running.add(requestId);
      const filter = JSON.parse(node.textContent);
      // Field types only: lets support diagnose bridge/version mismatches
      // without exposing search text, recipients or bank details.
      marker.setAttribute(
        "data-live-filter-shape",
        JSON.stringify(
          Object.fromEntries(
            ["grouping", "volume", "issue", "search"].map((key) => [
              key,
              filter?.[key] === null ? "null" : typeof filter?.[key],
            ]),
          ),
        ),
      );
      const catalog = await listPayments(filter);
      if (disposed)
        throw new Error(
          "OTEManager's page changed. Refresh the live connection.",
        );
      const result = JSON.stringify({ success: true, catalog });
      if (result.length > 2 * 1024 * 1024)
        throw new Error(
          "Payment list is too large. Narrow the publication filter.",
        );
      liveBatches.set(catalog.batch.batchId, catalog.batch);
      // Live refresh pauses once a payment is prepared. A small bounded set
      // also allows recent lists to receive their matching bank confirmation.
      if (liveBatches.size > 10)
        liveBatches.delete(liveBatches.keys().next().value!);
      node.setAttribute("data-result", result);
    } catch (error) {
      node?.setAttribute(
        "data-result",
        JSON.stringify({
          success: false,
          error:
            error instanceof Error ? error.message : "Unable to load payments.",
        }),
      );
    } finally {
      running.delete(requestId);
    }
  };
  const handler = async (event: Event) => {
    let requestId = "",
      node: HTMLElement | null = null;
    try {
      const detail = (event as CustomEvent).detail;
      if (typeof detail !== "string" || detail.length > 300) return;
      const request = JSON.parse(detail);
      if (
        request.bridgeId !== bridgeId ||
        !/^[\w-]{1,100}$/.test(request.requestId)
      )
        return;
      requestId = request.requestId;
      node = document.getElementById(`ote-payment-receipt-${requestId}`);
      if (
        !node ||
        node.tagName !== "SCRIPT" ||
        node.getAttribute("type") !== "application/json" ||
        !node.textContent ||
        node.textContent.length > 100_000 ||
        running.has(requestId)
      )
        return;
      running.add(requestId);
      const payload = JSON.parse(node.textContent);
      const data = validateConfirmation(payload.data);
      // An explicit retry may use a durable receipt after the old preview was
      // closed. The extension pins retries to their original OTEManager origin.
      // All article identities, amounts and prior references are rechecked by
      // recordBankPayment; retrying cannot substitute a different article.
      if (payload.retry !== true) {
        const batch = liveBatches.get(data.batchId) || currentBatch();
        const expected =
          batch?.batchId === data.batchId
            ? batch.payments.find((p) => p.id === data.payment.id)
            : null;
        if (
          !expected ||
          expected.authorId !== data.payment.authorId ||
          expected.recipientEmail !== data.payment.recipientEmail ||
          expected.amountCents !== data.payment.amountCents ||
          JSON.stringify(
            expected.articles.map(({ id, title, issue, amountCents }) => ({
              id,
              title,
              issue,
              amountCents,
            })),
          ) !== JSON.stringify(data.payment.articles)
        )
          throw new Error(
            "The selected OTEManager preview changed. Keep its original preview open or reconnect and retry the saved receipt.",
          );
      }
      const result = await record(data);
      if (
        result.success &&
        (result.reference !== data.receipt.reference ||
          JSON.stringify([...result.articleIds].sort()) !==
            JSON.stringify(data.payment.articles.map((a) => a.id).sort()))
      )
        throw new Error("OTEManager returned a different payment result.");
      node.setAttribute("data-result", JSON.stringify(result));
      if (result.success && !disposed) onRecorded(result);
    } catch (error) {
      node?.setAttribute(
        "data-result",
        JSON.stringify({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Unable to record the bank receipt.",
        }),
      );
    } finally {
      running.delete(requestId);
    }
  };
  win.addEventListener("ote:payment-confirmation", handler);
  win.addEventListener("ote:payment-list", listHandler);
  return () => {
    disposed = true;
    win.removeEventListener("ote:payment-confirmation", handler);
    win.removeEventListener("ote:payment-list", listHandler);
    liveBatches.clear();
    marker.remove();
  };
}
