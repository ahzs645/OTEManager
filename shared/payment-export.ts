import { NON_PAID_AUTHOR_TYPES } from "./model";

export type PaymentGrouping = "article" | "author";

export interface ExportableArticle {
  id: string;
  title: string;
  articleTier: string;
  paymentStatus: boolean;
  paymentAmount: number | null;
  paymentIsManual: boolean;
  paymentRateSnapshot: string | null;
  author: {
    id: string;
    givenName: string;
    surname: string;
    email: string;
    etransferEmail: string | null;
    authorType: string | null;
    autoDepositAvailable: boolean | null;
  };
  issue: {
    issueNumber: number;
    volume: { volumeNumber: number };
  } | null;
  volume: number | null;
  issueNumber: number | null;
}

export interface PaymentExportArticle {
  id: string;
  title: string;
  issue: string;
  amountCents: number;
  items: { description: string; amountCents: number }[];
}

export interface PaymentExportEntry {
  id: string;
  authorId: string;
  recipientName: string;
  recipientEmail: string;
  emailSource: "etransfer" | "author";
  autoDepositRecorded: boolean;
  amountCents: number;
  articles: PaymentExportArticle[];
  message: string;
  warnings: string[];
}

export interface PaymentExportBatch {
  kind: "ote-payment-batch";
  schemaVersion: 1;
  batchId: string;
  createdAt: string;
  currency: "CAD";
  grouping: PaymentGrouping;
  payments: PaymentExportEntry[];
  skipped: { articleId: string; title: string; reason: string }[];
}

export type LivePaymentFilter = {
  grouping: PaymentGrouping;
  volume: number | null;
  issue: number | null;
  search: string;
};
export type LivePaymentCatalog = {
  batch: PaymentExportBatch;
  publications: { volume: number; issues: number[] }[];
};
/** Live lists always use current saved amounts, independent of the page's UI filter. */
export function buildLivePaymentCatalog(
  articles: ExportableArticle[],
  input: LivePaymentFilter,
): LivePaymentCatalog {
  // Older/partial UI settings and empty select values mean "all". Normalize
  // these at the page boundary before validating publication numbers.
  const scope = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    return typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : (value as number);
  };
  input = {
    grouping: input?.grouping ?? "article",
    volume: scope(input?.volume),
    issue: scope(input?.issue),
    search: input?.search ?? "",
  };
  if (
    !input ||
    !["article", "author"].includes(input.grouping) ||
    ![input.volume, input.issue].every(
      (n) => n === null || (Number.isSafeInteger(n) && n > 0),
    ) ||
    typeof input.search !== "string" ||
    input.search.length > 200
  )
    throw new Error("Invalid live payment filter.");
  const publications = new Map<number, Set<number>>();
  const publication = (a: ExportableArticle) => ({
    volume: a.issue?.volume.volumeNumber ?? a.volume,
    issue: a.issue?.issueNumber ?? a.issueNumber,
  });
  for (const a of articles) {
    const { volume, issue } = publication(a);
    if (volume && issue) {
      if (!publications.has(volume)) publications.set(volume, new Set());
      publications.get(volume)!.add(issue);
    }
  }
  const search = input.search.trim().toLowerCase();
  return {
    publications: [...publications]
      .sort((a, b) => b[0] - a[0])
      .map(([volume, issues]) => ({
        volume,
        issues: [...issues].sort((a, b) => a - b),
      })),
    batch: buildPaymentExport(
      articles.filter((a) => {
        const { volume, issue } = publication(a);
        return (
          (!input.volume || volume === input.volume) &&
          (!input.issue || issue === input.issue) &&
          (!search ||
            [
              a.title,
              a.author.givenName,
              a.author.surname,
              a.author.email,
              a.author.etransferEmail || "",
            ]
              .join(" ")
              .toLowerCase()
              .includes(search))
        );
      }),
      input.grouping,
    ),
  };
}

/** Keep article text from ending the inert JSON script used by the helper. */
export function serializePaymentPageExport(batch: PaymentExportBatch) {
  return JSON.stringify(batch).replace(/</g, "\\u003c");
}

const validEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 64;
const validCents = (amount: unknown): amount is number =>
  typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0;
const dollars = (amount: number) => `$${(amount / 100).toFixed(2)}`;
const cleanText = (value: string) => value.replace(/\s+/g, " ").trim();

function savedItems(article: ExportableArticle) {
  const amount = article.paymentAmount!;
  if (article.paymentIsManual) {
    return { items: [{ description: "Manual payment", amountCents: amount }] };
  }
  try {
    const snapshot = JSON.parse(article.paymentRateSnapshot || "null");
    if (
      snapshot &&
      snapshot.tierName === article.articleTier &&
      snapshot.totalAmount === amount &&
      validCents(snapshot.baseAmount) &&
      Array.isArray(snapshot.bonuses) &&
      snapshot.bonuses.every(
        (bonus: any) =>
          typeof bonus.type === "string" &&
          bonus.type.trim() &&
          validCents(bonus.amount),
      ) &&
      snapshot.baseAmount +
        snapshot.bonuses.reduce((sum: number, b: any) => sum + b.amount, 0) ===
        amount
    ) {
      return {
        items: [
          {
            description: article.articleTier,
            amountCents: snapshot.baseAmount,
          },
          ...snapshot.bonuses.map((b: any) => ({
            description: `${cleanText(b.type)} bonus`,
            amountCents: b.amount,
          })),
        ],
      };
    }
  } catch {
    // An old or corrupt snapshot must not fabricate a breakdown.
  }
  return {
    items: [{ description: "Article payment", amountCents: amount }],
    warning: `Verify the breakdown for "${article.title}": no matching saved calculation.`,
  };
}

/** Uses saved amounts from the approved/unpaid query; never calculates or marks paid. */
export function buildPaymentExport(
  articles: ExportableArticle[],
  grouping: PaymentGrouping = "article",
  options: { batchId?: string; createdAt?: string } = {},
): PaymentExportBatch {
  const batch: PaymentExportBatch = {
    kind: "ote-payment-batch",
    schemaVersion: 1,
    batchId: options.batchId || crypto.randomUUID(),
    createdAt: options.createdAt || new Date().toISOString(),
    currency: "CAD",
    grouping,
    payments: [],
    skipped: [],
  };
  const seen = new Set<string>();
  for (const article of articles) {
    if (seen.has(article.id)) continue;
    seen.add(article.id);
    const name = cleanText(
      `${article.author.givenName} ${article.author.surname}`,
    );
    const preferred = article.author.etransferEmail?.trim();
    const email = preferred || article.author.email.trim();
    let reason = "";
    if (article.paymentStatus) reason = "Already paid";
    else if (NON_PAID_AUTHOR_TYPES.includes(article.author.authorType as any))
      reason = "Author is not eligible for payment";
    else if (!validCents(article.paymentAmount))
      reason = "Set and review a positive payment amount first";
    else if (!name || !article.title.trim())
      reason = "Missing recipient name or article title";
    else if (!validEmail(email))
      reason = "Set a valid e-transfer email (maximum 64 characters)";
    if (reason) {
      batch.skipped.push({
        articleId: article.id,
        title: article.title,
        reason,
      });
      continue;
    }
    const detail = savedItems(article);
    const volume = article.issue?.volume.volumeNumber ?? article.volume;
    const issue = article.issue?.issueNumber ?? article.issueNumber;
    const item: PaymentExportArticle = {
      id: article.id,
      title: cleanText(article.title),
      issue:
        volume && issue ? `Vol ${volume}, Issue ${issue}` : "Unassigned issue",
      amountCents: article.paymentAmount!,
      items: detail.items,
    };
    const warnings = detail.warning ? [detail.warning] : [];
    if (!preferred)
      warnings.push(
        "Uses the author email; confirm it is their e-transfer address.",
      );
    if (name.length > 35)
      warnings.push(
        "Contact name exceeds Vancity's 35-character limit; enter a shorter name yourself.",
      );
    let payment =
      grouping === "author"
        ? batch.payments.find(
            (p) =>
              p.authorId === article.author.id &&
              p.recipientEmail === email.toLowerCase(),
          )
        : undefined;
    if (!payment) {
      payment = {
        id:
          grouping === "article"
            ? article.id
            : `${article.author.id}:${email.toLowerCase()}`,
        authorId: article.author.id,
        recipientName: name,
        recipientEmail: email.toLowerCase(),
        emailSource: preferred ? "etransfer" : "author",
        autoDepositRecorded: article.author.autoDepositAvailable === true,
        amountCents: 0,
        articles: [],
        message: "",
        warnings: [],
      };
      batch.payments.push(payment);
    }
    payment.articles.push(item);
    payment.amountCents += item.amountCents;
    payment.warnings.push(...warnings);
    if (!Number.isSafeInteger(payment.amountCents))
      throw new Error("Combined payment exceeds the supported amount range.");
  }
  for (const payment of batch.payments) {
    payment.message =
      "Over The Edge: " +
      payment.articles
        .map(
          (a) =>
            `${a.title} (${a.issue}) — ${a.items.map((i) => `${i.description} ${dollars(i.amountCents)}`).join(" + ")}`,
        )
        .join("; ");
    if (payment.message.length > 400)
      payment.warnings.push(
        "Message exceeds 400 characters; shorten it in the helper before filling.",
      );
    payment.warnings = [...new Set(payment.warnings)];
  }
  return batch;
}
