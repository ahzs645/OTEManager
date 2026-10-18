import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Download,
  Eye,
  Link2,
  Loader2,
  WalletCards,
} from "lucide-react";
import {
  buildPaymentExport,
  buildLivePaymentCatalog,
  serializePaymentPageExport,
  type ExportableArticle,
  type PaymentExportBatch,
  type PaymentGrouping,
} from "../../shared/payment-export";
import { formatCents } from "~/lib/payment-calculator";
import { recordBankPayment } from "~/lib/mutations/paymentMutations";
import { installPaymentHelperConnection } from "~/lib/payment-helper-connection";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PaymentExportPanel({
  getFreshArticles,
  getLiveArticles,
}: {
  getFreshArticles: () => Promise<ExportableArticle[]>;
  getLiveArticles: () => Promise<ExportableArticle[]>;
}) {
  const [grouping, setGrouping] = useState<PaymentGrouping>("article");
  const [batch, setBatch] = useState<PaymentExportBatch | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyAction, setBusyAction] = useState<"preview" | "helper" | null>(
    null,
  );
  const busy = busyAction !== null;
  const [error, setError] = useState("");
  const [recorded, setRecorded] = useState("");
  const selectedBatch = batch
    ? { ...batch, payments: batch.payments.filter((p) => selected.has(p.id)) }
    : null;
  const batchRef = useRef(selectedBatch);
  batchRef.current = selectedBatch;
  const freshRef = useRef(getFreshArticles);
  freshRef.current = getFreshArticles;
  const liveRef = useRef(getLiveArticles);
  liveRef.current = getLiveArticles;
  useEffect(
    () =>
      installPaymentHelperConnection({
        document,
        currentBatch: () => batchRef.current,
        listPayments: async (filter) =>
          buildLivePaymentCatalog(await liveRef.current(), filter),
        record: (data) => recordBankPayment({ data }),
        onRecorded: (result) => {
          setRecorded(result.reference);
          const ids = new Set(result.articleIds);
          const paymentIds = new Set(
            (batchRef.current?.payments || [])
              .filter((p) => p.articles.some((a) => ids.has(a.id)))
              .map((p) => p.id),
          );
          setBatch((prev) =>
            prev
              ? {
                  ...prev,
                  payments: prev.payments.filter(
                    (p) => !p.articles.some((a) => ids.has(a.id)),
                  ),
                }
              : null,
          );
          setSelected(
            (prev) => new Set([...prev].filter((id) => !paymentIds.has(id))),
          );
          void freshRef
            .current()
            .catch((err) =>
              setError(
                err instanceof Error ? err.message : "Refresh the unpaid list.",
              ),
            );
        },
      }),
    [],
  );

  async function prepare() {
    setBusyAction("preview");
    setError("");
    setBatch(null);
    try {
      const fresh = buildPaymentExport(await getFreshArticles(), grouping);
      setBatch(fresh);
      setSelected(new Set(fresh.payments.map((p) => p.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to prepare export");
    } finally {
      setBusyAction(null);
    }
  }

  async function downloadHelper() {
    setBusyAction("helper");
    setError("");
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const name of [
        "manifest.json",
        "popup.html",
        "popup.css",
        "popup.js",
        "bank.js",
        "contract.js",
        "security-preset.js",
        "account-preset.js",
        "manager-page.js",
        "manager-client.js",
        "bank-receipt.js",
        "receipt-contract.js",
        "background.js",
        "auto-next.js",
        "surface.js",
        "bank-history.js",
        "bank-tab.js",
        "README.md",
      ]) {
        const response = await fetch(`/payment-helper/${name}`);
        if (!response.ok)
          throw new Error("Unable to download the Chrome helper");
        zip.file(`ote-payment-helper/${name}`, await response.text());
      }
      download(
        await zip.generateAsync({ type: "blob" }),
        "ote-payment-helper.zip",
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to download helper",
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section
      aria-labelledby="vancity-payments-title"
      className="surface mb-6 overflow-hidden shadow-sm"
    >
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: "var(--accent-subtle)",
                color: "var(--accent)",
              }}
            >
              <WalletCards className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="vancity-payments-title"
                className="text-base font-semibold tracking-tight"
              >
                Prepare payments for Vancity
              </h2>
              <p
                className="mt-1 max-w-xl text-sm"
                style={{ color: "var(--fg-muted)" }}
              >
                Connect the Chrome helper to this site to check contacts and
                fill transfers. Review and send each payment in Vancity.
              </p>
            </div>
          </div>
          <button
            className="btn btn-primary w-full shrink-0 self-start sm:w-auto"
            onClick={downloadHelper}
            disabled={busy}
          >
            {busyAction === "helper" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            {busyAction === "helper"
              ? "Downloading…"
              : "Download Chrome helper"}
          </button>
        </div>
        <p
          className="mt-4 flex items-start gap-2 text-xs leading-5"
          style={{ color: "var(--fg-muted)" }}
        >
          <Link2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          In connected mode, confirmed sends save the bank reference and mark
          articles paid here.
        </p>
        {recorded && (
          <div
            role="status"
            className="mt-4 flex items-start gap-2.5 rounded-md px-3 py-2.5 text-sm"
            style={{
              background: "var(--status-success-bg)",
              color: "var(--status-success)",
            }}
          >
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="font-medium">Payment recorded as paid</p>
              <p className="mt-0.5 text-xs">
                Vancity reference:{" "}
                <span className="font-mono break-all">{recorded}</span>
              </p>
            </div>
          </div>
        )}
      </div>
      <div
        className="flex flex-col gap-3 border-t px-5 py-4 sm:px-6 lg:flex-row lg:items-end lg:justify-between"
        style={{
          borderColor: "var(--border-default)",
          background: "var(--bg-root)",
        }}
      >
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 sm:w-72">
            <label
              htmlFor="payment-export-grouping"
              className="mb-1.5 block text-xs font-medium"
              style={{ color: "var(--fg-secondary)" }}
            >
              Transfer grouping
            </label>
            <select
              id="payment-export-grouping"
              className="input w-full"
              value={grouping}
              disabled={busy}
              onChange={(e) => {
                setGrouping(e.target.value as PaymentGrouping);
                setBatch(null);
              }}
            >
              <option value="article">Separate transfer per article</option>
              <option value="author">Combine articles per author</option>
            </select>
          </div>
          <button
            className="btn btn-secondary w-full shrink-0 sm:w-auto"
            onClick={prepare}
            disabled={busy}
          >
            {busyAction === "preview" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
            {busyAction === "preview" ? "Preparing…" : "Preview export"}
          </button>
        </div>
        <p
          className="max-w-xs text-xs leading-5"
          style={{ color: "var(--fg-muted)" }}
        >
          Prefer a file? Preview and export payments from the current article
          filters.
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="mx-5 my-4 rounded-md px-3 py-2.5 text-sm sm:mx-6"
          style={{
            background: "var(--status-error-bg)",
            color: "var(--status-error)",
          }}
        >
          {error}
        </p>
      )}
      {batch && (
        <div
          className="border-t p-5 sm:p-6"
          style={{ borderColor: "var(--border-default)" }}
        >
          {selectedBatch && (
            <script
              id="ote-payment-helper-export"
              type="application/json"
              dangerouslySetInnerHTML={{
                __html: serializePaymentPageExport(selectedBatch),
              }}
            />
          )}
          <p className="text-sm mb-2">
            {batch.payments.length} transfer
            {batch.payments.length === 1 ? "" : "s"} available ·{" "}
            {batch.skipped.length} article
            {batch.skipped.length === 1 ? "" : "s"} excluded
          </p>
          <div className="space-y-3 max-h-96 overflow-auto">
            {batch.payments.map((payment) => (
              <div
                key={payment.id}
                className="p-3 rounded border"
                style={{ borderColor: "var(--border-default)" }}
              >
                <label className="flex gap-2 items-start">
                  <input
                    type="checkbox"
                    checked={selected.has(payment.id)}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(payment.id);
                        else next.delete(payment.id);
                        return next;
                      })
                    }
                  />
                  <span className="text-sm">
                    <strong>
                      {payment.recipientName} ·{" "}
                      {formatCents(payment.amountCents)}
                    </strong>
                    <br />
                    {payment.recipientEmail}
                    <br />
                    {payment.articles.map((a) => a.title).join("; ")}
                  </span>
                </label>
                <p className="text-sm mt-2 whitespace-pre-wrap">
                  {payment.message}
                </p>
                {payment.warnings.map((warning) => (
                  <p
                    key={warning}
                    className="text-sm mt-1"
                    style={{ color: "var(--status-warning)" }}
                  >
                    {warning}
                  </p>
                ))}
              </div>
            ))}
          </div>
          {batch.skipped.length > 0 && (
            <details className="text-sm mt-3">
              <summary>Articles requiring attention or excluded</summary>
              <ul className="list-disc pl-5 mt-2">
                {batch.skipped.map((a) => (
                  <li key={a.articleId}>
                    {a.title}: {a.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button
            className="btn btn-primary mt-3"
            disabled={selected.size === 0}
            onClick={() => {
              download(
                new Blob([JSON.stringify(selectedBatch, null, 2)], {
                  type: "application/json",
                }),
                `ote-payments-${batch.batchId}.json`,
              );
            }}
          >
            <Download className="w-4 h-4" /> Export {selected.size} selected
            transfer{selected.size === 1 ? "" : "s"}
          </button>
          <p className="text-sm mt-3" style={{ color: "var(--fg-muted)" }}>
            Or open the Chrome helper on this page and choose Import from
            OTEManager. It imports these selected payments directly, including
            when OTEManager runs on localhost. Keep this tab open to receive the
            bank confirmation and record the payment automatically after you
            send it.
          </p>
          <p className="text-xs mt-2" style={{ color: "var(--fg-muted)" }}>
            Exporting does not mark articles paid. The file contains recipient
            emails and payment details; keep it private.
          </p>
        </div>
      )}
    </section>
  );
}
