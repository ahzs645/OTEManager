import { Store } from "../lib/store";
import { DEFAULT_RATES } from "./queries";
import { calculatePayment } from "../../app/lib/payment-calculator";
import type { Articles, RowMap, TableName } from "../../shared/model";
import { recordBankPayment } from "./paymentReceipts";
import { isIssueStudioFileReferenced } from "../lib/issueStudioFiles";
import {
  syncIssueStudioArticle,
  detachIssueStudioArticle,
  deleteIssueStudio,
  invalidateIssueStudioMetadata,
} from "./issueStudio";
const success = { success: true as const };
const now = () => new Date();
const fields = (data: Record<string, any>, keys: readonly string[]) =>
  Object.fromEntries(
    keys.filter((k) => data[k] !== undefined).map((k) => [k, data[k]]),
  );
async function updateArticle(
  s: Store,
  id: string,
  values: Record<string, any>,
) {
  const affectsLayout = [
    "title",
    "content",
    "prefersAnonymity",
    "authorId",
    "issueId",
  ].some((key) => Object.hasOwn(values, key));
  const previous = affectsLayout ? await s.require("articles", id) : null;
  await s.patch("articles", id, { ...values, updatedAt: now() });
  if (affectsLayout) await syncIssueStudioArticle(s, id, previous?.issueId);
  return success;
}
async function removeFileIfUnused(s: Store, path: string) {
  if ((await s.by("attachments", "filePath", path)).length) return;
  if (await isIssueStudioFileReferenced(s, path)) return;
  const doc = await s.ctx.db
    .query("storedFiles")
    .withIndex("by_path", (q) => q.eq("path", path))
    .unique();
  if (doc && "delete" in s.ctx.db && "delete" in s.ctx.storage) {
    await s.ctx.storage.delete(doc.storageId);
    await s.ctx.db.delete(doc._id);
  }
}
export async function deleteAttachmentRecord(
  s: Store,
  id: string,
  syncStudio = true,
) {
  const a = await s.require("attachments", id);
  await s.delete("attachments", id);
  if (syncStudio) await syncIssueStudioArticle(s, a.articleId);
  await removeFileIfUnused(s, a.filePath);
  return success;
}
export async function deleteArticleRecord(s: Store, id: string) {
  await s.require("articles", id);
  for (const a of await s.by("attachments", "articleId", id))
    await deleteAttachmentRecord(s, a.id, false);
  for (const table of [
    "articleMultimediaTypes",
    "articleNotes",
    "statusHistory",
  ] as const)
    for (const row of await s.by(table, "articleId", id))
      await s.delete(table, row.id);
  await detachIssueStudioArticle(s, id);
  await s.delete("articles", id);
  return success;
}
async function calculate(s: Store, id: string, force = false) {
  const a = await s.require("articles", id);
  if (a.paymentStatus)
    throw new Error(
      "Payment has already been completed. The recorded amount cannot be recalculated.",
    );
  if (a.paymentIsManual && !force)
    throw new Error(
      "Article has manual payment set. Use recalculate to override.",
    );
  const config = (await s.all("paymentRateConfig"))[0] || DEFAULT_RATES;
  const multimedia = await s.by("articleMultimediaTypes", "articleId", id);
  const calculation = calculatePayment(
    a.articleTier || "Tier 1 (Basic)",
    {
      hasMultimedia:
        a.hasMultimediaBonus ??
        multimedia.some((m) =>
          ["Photo", "Graphic", "Video"].includes(m.multimediaType),
        ),
      hasResearchBonus: !!a.hasResearchBonus,
      hasTimeSensitiveBonus: !!a.hasTimeSensitiveBonus,
      hasProfessionalPhotos: !!a.hasProfessionalPhotos,
      hasProfessionalGraphics: !!a.hasProfessionalGraphics,
    },
    config,
  );
  await updateArticle(s, id, {
    paymentAmount: calculation.totalAmount,
    paymentRateSnapshot: JSON.stringify(calculation),
    paymentCalculatedAt: now(),
    paymentIsManual: false,
  });
  return { ...success, calculation };
}
function amount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Payment amount must be nonnegative whole cents");
}
async function clearDefaults(s: Store) {
  for (const v of await s.all("savedArticleViews"))
    if (v.isDefault)
      await s.patch("savedArticleViews", v.id, { isDefault: false });
  return success;
}
export const mutations = {
  recordBankPayment,
  submitArticle,
  async createArticle(s: Store, data: any) {
    // A client-generated UUID makes a retried create-and-assign request atomic and idempotent.
    if (
      data.creationId !== undefined &&
      (typeof data.creationId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          data.creationId,
        ))
    )
      throw new Error("Invalid article creation ID");
    if (data.creationId) {
      const existing = await s.get("articles", data.creationId);
      if (existing) {
        const author = await s.require("authors", existing.authorId);
        const sameAuthor = data.authorId
          ? data.authorId === author.id
          : data.authorEmail?.trim().toLowerCase() ===
            author.email.trim().toLowerCase();
        if (
          !sameAuthor ||
          existing.title !== data.title ||
          existing.issueId !== (data.issueId || null) ||
          !!existing.prefersAnonymity !== !!data.prefersAnonymity
        )
          throw new Error(
            "Article creation ID was already used for a different request",
          );
        await syncIssueStudioArticle(s, existing.id);
        return { ...success, articleId: existing.id };
      }
    }
    const destination = data.issueId
      ? await s.require("issues", data.issueId)
      : null;
    const volume = destination
      ? await s.require("volumes", destination.volumeId)
      : null;
    let authorId = data.authorId;
    if (!authorId) {
      if (
        !data.authorEmail?.trim() ||
        !data.authorGivenName?.trim() ||
        !data.authorSurname?.trim()
      )
        throw new Error("Author information is required");
      const email = data.authorEmail.trim();
      const existing = (await s.all("authors")).find(
        (a) => a.email.toLowerCase() === email.toLowerCase(),
      );
      authorId =
        existing?.id ||
        (
          await s.insert("authors", {
            email,
            givenName: data.authorGivenName,
            surname: data.authorSurname,
            role: "Guest Contributor",
          })
        ).id;
    }
    const a = await s.insert("articles", {
      ...(data.creationId ? { id: data.creationId } : {}),
      issueId: destination?.id || null,
      volume: volume?.volumeNumber ?? null,
      issue: destination?.issueNumber ?? null,
      title: data.title,
      authorId,
      articleTier: data.articleTier || "Tier 1 (Basic)",
      prefersAnonymity: data.prefersAnonymity || false,
      internalStatus: "Draft",
      automationStatus: "Completed",
      submittedAt: now(),
    });
    await s.insert("statusHistory", {
      articleId: a.id,
      fromStatus: null,
      toStatus: "Draft",
      changedBy: "Manual Entry",
      notes: "Article created manually",
    });
    await syncIssueStudioArticle(s, a.id);
    return { ...success, articleId: a.id };
  },
  async updateArticleStatus(s: Store, data: any) {
    const a = await s.require("articles", data.articleId);
    await updateArticle(s, a.id, { internalStatus: data.status });
    await s.insert("statusHistory", {
      articleId: a.id,
      fromStatus: a.internalStatus,
      toStatus: data.status,
      changedBy: data.changedBy || null,
    });
    return success;
  },
  async updateArticle(s: Store, data: any) {
    return updateArticle(
      s,
      data.articleId,
      fields(data, [
        "title",
        "articleTier",
        "prefersAnonymity",
        "paymentStatus",
        "paymentAmount",
        "volume",
        "issue",
      ]),
    );
  },
  async updateArticleContent(s: Store, data: any) {
    return updateArticle(s, data.articleId, { content: data.content });
  },
  async updateArticleFeedbackLetter(s: Store, data: any) {
    return updateArticle(s, data.articleId, {
      feedbackLetter: data.feedbackLetter,
    });
  },
  async updateArticleTier(s: Store, data: any) {
    return updateArticle(s, data.articleId, { articleTier: data.tier });
  },
  async toggleArticleFeatured(s: Store, data: any) {
    return updateArticle(s, data.articleId, { isFeatured: data.isFeatured });
  },
  async updateArticleIssue(s: Store, data: any) {
    const issue = data.issueId ? await s.require("issues", data.issueId) : null;
    const volume = issue ? await s.require("volumes", issue.volumeId) : null;
    return updateArticle(s, data.articleId, {
      issueId: issue?.id || null,
      volume: volume?.volumeNumber ?? null,
      issue: issue?.issueNumber ?? null,
    });
  },
  async deleteArticle(s: Store, data: { articleId: string } | string) {
    return deleteArticleRecord(
      s,
      typeof data === "string" ? data : data.articleId,
    );
  },
  async updateAttachmentCaption(s: Store, data: any) {
    const attachment = await s.patch("attachments", data.attachmentId, {
      caption: data.caption,
    });
    await syncIssueStudioArticle(s, attachment.articleId);
    return success;
  },
  async setAttachmentsIncludeInExport(
    s: Store,
    data: { attachmentIds: string[]; includeInExport: boolean },
  ) {
    for (const id of data.attachmentIds)
      await s.patch("attachments", id, {
        includeInExport: data.includeInExport,
      });
    return success;
  },
  async deleteAttachment(s: Store, data: { attachmentId: string }) {
    return deleteAttachmentRecord(s, data.attachmentId);
  },
  async addArticleNote(s: Store, data: any) {
    return {
      ...success,
      note: await s.insert(
        "articleNotes",
        fields(data, ["articleId", "content", "createdBy"]),
      ),
    };
  },
  async updateArticleNote(s: Store, data: any) {
    return {
      ...success,
      note: await s.patch("articleNotes", data.noteId, {
        content: data.content,
      }),
    };
  },
  async deleteArticleNote(s: Store, data: any) {
    await s.delete("articleNotes", data.noteId);
    return success;
  },
  async updateAuthorPaymentInfo(s: Store, data: any) {
    const previous = await s.require("authors", data.authorId);
    const author = await s.patch("authors", data.authorId, {
      ...fields(data, [
        "givenName",
        "surname",
        "email",
        "authorType",
        "studentType",
        "autoDepositAvailable",
        "etransferEmail",
      ]),
      updatedAt: now(),
    });
    if (
      previous.givenName !== author.givenName ||
      previous.surname !== author.surname
    )
      for (const article of await s.by("articles", "authorId", author.id))
        await syncIssueStudioArticle(s, article.id);
    return success;
  },
  async updatePaymentRateConfig(s: Store, data: any) {
    const values = fields(data, Object.keys(DEFAULT_RATES));
    for (const n of Object.values(values)) amount(n);
    const current = (await s.all("paymentRateConfig"))[0];
    const config = {
      ...values,
      updatedAt: now(),
      updatedBy: data.updatedBy || null,
    };
    if (current) await s.patch("paymentRateConfig", current.id, config);
    else await s.insert("paymentRateConfig", config);
    await s.insert("paymentRateHistory", {
      ratesSnapshot: JSON.stringify(config),
      changedBy: data.updatedBy || null,
      notes: data.notes || null,
    });
    return success;
  },
  async calculateArticlePayment(s: Store, data: any) {
    return calculate(s, data.articleId, !!data.recalculate);
  },
  async setManualPayment(s: Store, data: any) {
    amount(data.amount);
    const a = await s.require("articles", data.articleId);
    if (a.paymentStatus)
      throw new Error("Completed payments cannot be overwritten");
    return updateArticle(s, a.id, {
      paymentAmount: data.amount,
      paymentIsManual: true,
    });
  },
  async markPaymentComplete(s: Store, data: any) {
    amount(data.amount);
    const a = await s.require("articles", data.articleId);
    if (a.paymentStatus) {
      if (a.paymentAmount !== data.amount)
        throw new Error("Completed payments cannot be overwritten");
      return success;
    }
    return updateArticle(s, a.id, {
      paymentStatus: true,
      paymentAmount: data.amount,
      paidAt: now(),
    });
  },
  async updateArticleBonusFlags(s: Store, data: any) {
    await updateArticle(
      s,
      data.articleId,
      fields(data, [
        "hasResearchBonus",
        "hasTimeSensitiveBonus",
        "hasProfessionalPhotos",
        "hasProfessionalGraphics",
        "hasMultimediaBonus",
      ]),
    );
    const a = await s.require("articles", data.articleId);
    if (a.paymentStatus || a.paymentIsManual)
      return { ...success, calculation: undefined };
    return calculate(s, a.id);
  },
  async createVolume(s: Store, data: any) {
    return {
      ...success,
      volume: await s.insert(
        "volumes",
        fields(data, [
          "volumeNumber",
          "year",
          "startDate",
          "endDate",
          "description",
        ]),
      ),
    };
  },
  async updateVolume(s: Store, data: any) {
    const previous = await s.require("volumes", data.id);
    const volume = await s.patch("volumes", data.id, {
      ...fields(data, [
        "volumeNumber",
        "year",
        "startDate",
        "endDate",
        "description",
      ]),
      updatedAt: now(),
    });
    if (
      previous.volumeNumber !== volume.volumeNumber ||
      previous.year !== volume.year
    )
      for (const issue of await s.by("issues", "volumeId", volume.id))
        await invalidateIssueStudioMetadata(s, issue.id);
    return success;
  },
  async deleteVolume(s: Store, data: any) {
    for (const i of await s.by("issues", "volumeId", data.id))
      await mutations.deleteIssue(s, { id: i.id });
    await s.delete("volumes", data.id);
    return success;
  },
  async createIssue(s: Store, data: any) {
    return {
      ...success,
      issue: await s.insert(
        "issues",
        fields(data, [
          "volumeId",
          "issueNumber",
          "title",
          "releaseDate",
          "description",
        ]),
      ),
    };
  },
  async updateIssue(s: Store, data: any) {
    const previous = await s.require("issues", data.id);
    const issue = await s.patch("issues", data.id, {
      ...fields(data, ["issueNumber", "title", "releaseDate", "description"]),
      updatedAt: now(),
    });
    if (
      previous.title !== issue.title ||
      previous.issueNumber !== issue.issueNumber ||
      previous.releaseDate?.getTime() !== issue.releaseDate?.getTime()
    )
      await invalidateIssueStudioMetadata(s, issue.id);
    return success;
  },
  async deleteIssue(s: Store, data: any) {
    for (const a of await s.by("articles", "issueId", data.id))
      await updateArticle(s, a.id, {
        issueId: null,
        volume: null,
        issue: null,
      });
    await deleteIssueStudio(s, data.id);
    await s.delete("issues", data.id);
    return success;
  },
  async migrateLegacyVolumeIssues(s: Store) {
    const created = { volumes: 0, issues: 0 };
    let linked = 0;
    for (const a of await s.all("articles")) {
      if (a.volume === null || a.issue === null || a.issueId) continue;
      let v = (await s.by("volumes", "volumeNumber", a.volume))[0];
      if (!v) {
        v = await s.insert("volumes", { volumeNumber: a.volume });
        created.volumes++;
      }
      let i = (await s.by("issues", "volumeId", v.id)).find(
        (i) => i.issueNumber === a.issue,
      );
      if (!i) {
        i = await s.insert("issues", { volumeId: v.id, issueNumber: a.issue });
        created.issues++;
      }
      await updateArticle(s, a.id, { issueId: i.id });
      linked++;
    }
    return { ...success, message: "Migration complete", created, linked };
  },
  async createSavedView(s: Store, data: any) {
    if (data.setAsDefault) await clearDefaults(s);
    return {
      ...success,
      view: await s.insert("savedArticleViews", {
        name: data.name,
        isDefault: !!data.setAsDefault,
        ...fields(data.config, [
          "status",
          "tier",
          "search",
          "sortBy",
          "sortOrder",
          "viewMode",
        ]),
      }),
    };
  },
  async updateSavedView(s: Store, data: any) {
    return {
      ...success,
      view: await s.patch("savedArticleViews", data.id, {
        ...fields(data, ["name"]),
        ...fields(data.config || {}, [
          "status",
          "tier",
          "search",
          "sortBy",
          "sortOrder",
          "viewMode",
        ]),
        updatedAt: now(),
      }),
    };
  },
  async setDefaultView(s: Store, data: any) {
    await s.require("savedArticleViews", data.id);
    await clearDefaults(s);
    await s.patch("savedArticleViews", data.id, {
      isDefault: true,
      updatedAt: now(),
    });
    return success;
  },
  clearDefaultView: clearDefaults,
  async deleteSavedView(s: Store, data: any) {
    await s.delete("savedArticleViews", data.id);
    return success;
  },
  async addAttachment(s: Store, data: any) {
    const photoNumber =
      data.attachmentType === "photo"
        ? (await s.by("attachments", "articleId", data.articleId))
            .filter((a) => a.attachmentType === "photo")
            .reduce((n, a) => Math.max(n, a.photoNumber || 0), 0) + 1
        : null;
    const attachment = await s.insert("attachments", { ...data, photoNumber });
    await syncIssueStudioArticle(s, data.articleId);
    return { attachment };
  },
};
export async function submitArticle(s: Store, data: any) {
  if (data.formResponseId) {
    const existing = (await s.all("articles")).find((a) =>
      (a.formResponseId || "").split(",").includes(data.formResponseId),
    );
    if (existing) return { articleId: existing.id, existing: true };
  }
  const email = data.author.email.trim();
  let author = (await s.all("authors")).find(
    (a) => a.email.toLowerCase() === email.toLowerCase(),
  );
  if (!author)
    author = await s.insert("authors", {
      ...data.author,
      email,
      autoDepositAvailable: data.autoDepositAvailable || false,
      etransferEmail: data.etransferEmail || null,
    });
  const destination = data.issueId
    ? await s.require("issues", data.issueId)
    : null;
  const volume = destination
    ? await s.require("volumes", destination.volumeId)
    : null;
  const article = await s.insert("articles", {
    issueId: destination?.id || null,
    volume: volume?.volumeNumber ?? null,
    issue: destination?.issueNumber ?? null,
    title: data.title,
    authorId: author.id,
    articleTier: data.articleTier,
    internalStatus: "Pending Review",
    automationStatus: "Pending Review",
    prefersAnonymity: !!data.prefersAnonymity,
    formResponseId: data.formResponseId || null,
    submittedAt: data.submittedAt ? new Date(data.submittedAt) : new Date(),
  });
  for (const type of new Set(data.multimediaTypes || []))
    await s.insert("articleMultimediaTypes", {
      articleId: article.id,
      multimediaType: type as any,
    });
  for (const attachment of data.attachments || [])
    await s.insert("attachments", { ...attachment, articleId: article.id });
  await calculate(s, article.id);
  await syncIssueStudioArticle(s, article.id);
  return { articleId: article.id, existing: false };
}
