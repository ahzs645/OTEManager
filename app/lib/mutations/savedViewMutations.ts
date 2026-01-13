import { createServerFn } from "@tanstack/start";

// Type for view configuration
export type SavedViewConfig = {
  status?: string;
  tier?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  viewMode?: string;
};

export type SavedView = {
  id: string;
  name: string;
  isDefault: boolean | null;
  createdAt: Date;
  updatedAt: Date;
} & SavedViewConfig;

// Get all saved views
export const getSavedViews = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      const { db, savedArticleViews } = await import("@db/index");
      const { desc } = await import("drizzle-orm");

      const views = await db
        .select()
        .from(savedArticleViews)
        .orderBy(desc(savedArticleViews.isDefault), desc(savedArticleViews.updatedAt));

      return { success: true, views };
    } catch (error) {
      console.error("Failed to get saved views:", error);
      return { success: false, views: [] };
    }
  }
);

// Get default view (for initial page load)
export const getDefaultView = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      const { db, savedArticleViews } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      const [defaultView] = await db
        .select()
        .from(savedArticleViews)
        .where(eq(savedArticleViews.isDefault, true))
        .limit(1);

      return { success: true, view: defaultView || null };
    } catch (error) {
      console.error("Failed to get default view:", error);
      return { success: false, view: null };
    }
  }
);

// Create a new saved view
export const createSavedView = createServerFn({ method: "POST" })
  .validator(
    (data: { name: string; config: SavedViewConfig; setAsDefault?: boolean }) =>
      data
  )
  .handler(async ({ data }) => {
    try {
      const { db, savedArticleViews } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      // If setting as default, clear other defaults first
      if (data.setAsDefault) {
        await db
          .update(savedArticleViews)
          .set({ isDefault: false })
          .where(eq(savedArticleViews.isDefault, true));
      }

      const [newView] = await db
        .insert(savedArticleViews)
        .values({
          name: data.name,
          isDefault: data.setAsDefault || false,
          status: data.config.status || null,
          tier: data.config.tier || null,
          search: data.config.search || null,
          sortBy: data.config.sortBy || null,
          sortOrder: data.config.sortOrder || null,
          viewMode: data.config.viewMode || "list",
        })
        .returning();

      return { success: true, view: newView };
    } catch (error) {
      console.error("Failed to create saved view:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Update a saved view
export const updateSavedView = createServerFn({ method: "POST" })
  .validator(
    (data: { id: string; name?: string; config?: SavedViewConfig }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, savedArticleViews } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      const updateData: Record<string, unknown> = { updatedAt: new Date() };

      if (data.name !== undefined) updateData.name = data.name;
      if (data.config) {
        if (data.config.status !== undefined)
          updateData.status = data.config.status || null;
        if (data.config.tier !== undefined)
          updateData.tier = data.config.tier || null;
        if (data.config.search !== undefined)
          updateData.search = data.config.search || null;
        if (data.config.sortBy !== undefined)
          updateData.sortBy = data.config.sortBy || null;
        if (data.config.sortOrder !== undefined)
          updateData.sortOrder = data.config.sortOrder || null;
        if (data.config.viewMode !== undefined)
          updateData.viewMode = data.config.viewMode || "list";
      }

      const [updatedView] = await db
        .update(savedArticleViews)
        .set(updateData)
        .where(eq(savedArticleViews.id, data.id))
        .returning();

      return { success: true, view: updatedView };
    } catch (error) {
      console.error("Failed to update saved view:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Set a view as default
export const setDefaultView = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, savedArticleViews } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      // Clear all defaults
      await db
        .update(savedArticleViews)
        .set({ isDefault: false })
        .where(eq(savedArticleViews.isDefault, true));

      // Set new default
      await db
        .update(savedArticleViews)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(savedArticleViews.id, data.id));

      return { success: true };
    } catch (error) {
      console.error("Failed to set default view:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Clear default view
export const clearDefaultView = createServerFn({ method: "POST" }).handler(
  async () => {
    try {
      const { db, savedArticleViews } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      await db
        .update(savedArticleViews)
        .set({ isDefault: false })
        .where(eq(savedArticleViews.isDefault, true));

      return { success: true };
    } catch (error) {
      console.error("Failed to clear default view:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
);

// Delete a saved view
export const deleteSavedView = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, savedArticleViews } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      await db.delete(savedArticleViews).where(eq(savedArticleViews.id, data.id));

      return { success: true };
    } catch (error) {
      console.error("Failed to delete saved view:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
