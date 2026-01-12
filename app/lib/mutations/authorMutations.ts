import { createServerFn } from "@tanstack/start";

// Update author payment info
export const updateAuthorPaymentInfo = createServerFn({ method: "POST" })
  .validator(
    (data: {
      authorId: string;
      autoDepositAvailable?: boolean;
      etransferEmail?: string;
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, authors } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      const { authorId, ...updateData } = data;

      await db
        .update(authors)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(authors.id, authorId));

      return { success: true };
    } catch (error) {
      console.error("Failed to update author:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
