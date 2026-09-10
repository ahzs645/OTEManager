import { createServerFn } from "@tanstack/react-start";

// Add note to article
export const addArticleNote = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { articleId: string; content: string; createdBy?: string }) => data,
  )
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("addArticleNote", data);
  });

// Update an article note
export const updateArticleNote = createServerFn({ method: "POST" })
  .inputValidator((data: { noteId: string; content: string }) => data)
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("updateArticleNote", data);
  });

// Delete an article note
export const deleteArticleNote = createServerFn({ method: "POST" })
  .inputValidator((data: { noteId: string }) => data)
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("deleteArticleNote", data);
  });
