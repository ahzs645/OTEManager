import { createServerFn } from "@tanstack/react-start";

// Create a new volume
export const createVolume = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      volumeNumber: number;
      year?: number;
      startDate?: string;
      endDate?: string;
      description?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("createVolume", data);
  });

// Update a volume
export const updateVolume = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      volumeNumber?: number;
      year?: number | null;
      startDate?: string | null;
      endDate?: string | null;
      description?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("updateVolume", data);
  });

// Delete a volume (cascades to issues)
export const deleteVolume = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("deleteVolume", data);
  });

// Create a new issue
export const createIssue = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      volumeId: string;
      issueNumber: number;
      title?: string;
      releaseDate?: string;
      description?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("createIssue", data);
  });

// Update an issue
export const updateIssue = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      issueNumber?: number;
      title?: string | null;
      releaseDate?: string | null;
      description?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("updateIssue", data);
  });

// Delete an issue
export const deleteIssue = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("deleteIssue", data);
  });

// Migrate legacy volume/issue data to new tables
export const migrateLegacyVolumeIssues = createServerFn({
  method: "POST",
}).handler(async () => {
  const { mutationResult } = await import("../../../server/convex");
  return mutationResult("migrateLegacyVolumeIssues");
});
