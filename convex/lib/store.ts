import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { RowMap, TableName } from "../../shared/model";
import {
  fromDocument,
  normalizeRecord,
  toDocument,
} from "../../shared/records";

export class Store {
  constructor(readonly ctx: GenericQueryCtx<any> | GenericMutationCtx<any>) {}
  async all<T extends TableName>(table: T): Promise<RowMap[T][]> {
    return (await this.ctx.db.query(table).collect()).map((d) =>
      fromDocument(table, d),
    );
  }
  async by<T extends TableName>(
    table: T,
    field: keyof RowMap[T] & string,
    value: any,
  ): Promise<RowMap[T][]> {
    return (
      await this.ctx.db
        .query(table)
        .withIndex(`by_${field}`, (q) => q.eq(field, value))
        .collect()
    ).map((d) => fromDocument(table, d));
  }
  private async doc(table: TableName, id: string) {
    return this.ctx.db
      .query(table)
      .withIndex("by_legacy_id", (q) => q.eq("id", id))
      .unique();
  }
  async get<T extends TableName>(
    table: T,
    id: string,
  ): Promise<RowMap[T] | null> {
    const doc = await this.doc(table, id);
    return doc ? fromDocument(table, doc) : null;
  }
  async require<T extends TableName>(table: T, id: string): Promise<RowMap[T]> {
    const row = await this.get(table, id);
    if (!row) throw new Error(`${table} record not found`);
    return row;
  }
  private get writer() {
    if (!("insert" in this.ctx.db)) throw new Error("Cannot write in a query");
    return this.ctx.db;
  }
  async insert<T extends TableName>(
    table: T,
    input: Partial<RowMap[T]>,
  ): Promise<RowMap[T]> {
    // Math.random is seeded by Convex and safe across transaction retries.
    const id =
      input.id ||
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.floor(Math.random() * 16);
        return (c === "x" ? r : (r & 3) | 8).toString(16);
      });
    if (await this.doc(table, id)) throw new Error(`Duplicate ${table} ID`);
    const row = normalizeRecord(table, { ...input, id });
    await this.validateRelations(table, row);
    await this.writer.insert(table, toDocument(table, row));
    return row;
  }
  async patch<T extends TableName>(
    table: T,
    id: string,
    values: Partial<RowMap[T]>,
  ): Promise<RowMap[T]> {
    const doc = await this.doc(table, id);
    if (!doc) throw new Error(`${table} record not found`);
    const row = normalizeRecord(table, {
      ...fromDocument(table, doc),
      ...Object.fromEntries(
        Object.entries(values).filter(([, v]) => v !== undefined),
      ),
      id,
    });
    await this.validateRelations(table, row);
    await this.writer.replace(doc._id, toDocument(table, row));
    return row;
  }
  async delete(table: TableName, id: string) {
    const doc = await this.doc(table, id);
    if (doc) await this.writer.delete(doc._id);
  }
  private async validateRelations(table: TableName, row: any) {
    if (table === "issueDesignPlans") {
      await this.require("issues", row.issueId);
      if (
        (await this.by("issueDesignPlans", "issueId", row.issueId)).some(
          (p) => p.id !== row.id,
        )
      )
        throw new Error("An issue can only have one Issue Studio plan");
    }
    if (
      [
        "issuePages",
        "issuePlacements",
        "issueReservations",
        "issueDesignRevisions",
        "compositionJobs",
      ].includes(table)
    ) {
      const plan = await this.require("issueDesignPlans", row.planId);
      if (plan.issueId !== row.issueId)
        throw new Error("Issue Studio object belongs to a different issue");
      if (table === "issuePlacements") {
        const article = await this.require("articles", row.articleId);
        if (article.issueId !== row.issueId)
          throw new Error("Placement article is not assigned to this issue");
      }
    }
    if (table === "authors") {
      const email = row.email.trim().toLowerCase();
      const others = await this.all("authors");
      if (
        others.some(
          (a) => a.id !== row.id && a.email.trim().toLowerCase() === email,
        )
      )
        throw new Error("An author with that email already exists");
    }
    if (
      table === "volumes" &&
      (await this.by("volumes", "volumeNumber", row.volumeNumber)).some(
        (v) => v.id !== row.id,
      )
    )
      throw new Error("Volume number already exists");
    if (table === "issues") {
      await this.require("volumes", row.volumeId);
      if (
        (await this.by("issues", "volumeId", row.volumeId)).some(
          (i) => i.id !== row.id && i.issueNumber === row.issueNumber,
        )
      )
        throw new Error("Issue number already exists in this volume");
    }
    if (table === "articles") {
      await this.require("authors", row.authorId);
      if (row.issueId) await this.require("issues", row.issueId);
    }
    if (
      [
        "attachments",
        "articleNotes",
        "articleMultimediaTypes",
        "statusHistory",
      ].includes(table)
    )
      await this.require("articles", row.articleId);
  }
}
export const newest = <T extends { createdAt: Date }>(rows: T[]) =>
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
export const sumPayments = (rows: { paymentAmount: number | null }[]) =>
  rows.reduce((n, a) => n + (a.paymentAmount || 0), 0);
