import { createServerFn } from "@tanstack/react-start";

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
    const { query } = await import("../../../server/convex");
    return query("getSavedViews");
  },
);

// Get default view (for initial page load)
export const getDefaultView = createServerFn({ method: "GET" }).handler(
  async () => {
    const { query } = await import("../../../server/convex");
    return query("getDefaultView");
  },
);

// Create a new saved view
export const createSavedView = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { name: string; config: SavedViewConfig; setAsDefault?: boolean }) =>
      data,
  )
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("createSavedView", data);
  });

// Update a saved view
export const updateSavedView = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { id: string; name?: string; config?: SavedViewConfig }) => data,
  )
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("updateSavedView", data);
  });

// Set a view as default
export const setDefaultView = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("setDefaultView", data);
  });

// Clear default view
export const clearDefaultView = createServerFn({ method: "POST" }).handler(
  async () => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("clearDefaultView");
  },
);

// Delete a saved view
export const deleteSavedView = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("deleteSavedView", data);
  });
