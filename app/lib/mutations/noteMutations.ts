import { createServerFn } from "@tanstack/start";

// Add note to article
export const addArticleNote = createServerFn({ method: "POST" })
  .validator(
    (data: { articleId: string; content: string; createdBy?: string }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, articleNotes } = await import("@db/index");

      const [note] = await db
        .insert(articleNotes)
        .values({
          articleId: data.articleId,
          content: data.content,
          createdBy: data.createdBy,
        })
        .returning();

      return { success: true, note };
    } catch (error) {
      console.error("Failed to add note:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Update an article note
export const updateArticleNote = createServerFn({ method: "POST" })
  .validator((data: { noteId: string; content: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articleNotes } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      const [note] = await db
        .update(articleNotes)
        .set({
          content: data.content,
        })
        .where(eq(articleNotes.id, data.noteId))
        .returning();

      return { success: true, note };
    } catch (error) {
      console.error("Failed to update note:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Delete an article note
export const deleteArticleNote = createServerFn({ method: "POST" })
  .validator((data: { noteId: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articleNotes } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      await db.delete(articleNotes).where(eq(articleNotes.id, data.noteId));

      return { success: true };
    } catch (error) {
      console.error("Failed to delete note:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
