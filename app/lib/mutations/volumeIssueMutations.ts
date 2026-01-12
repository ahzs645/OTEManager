import { createServerFn } from "@tanstack/start";

// Create a new volume
export const createVolume = createServerFn({ method: "POST" })
  .validator(
    (data: {
      volumeNumber: number;
      year?: number;
      startDate?: string;
      endDate?: string;
      description?: string;
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, volumes } = await import("@db/index");

      const [newVolume] = await db
        .insert(volumes)
        .values({
          volumeNumber: data.volumeNumber,
          year: data.year || null,
          startDate: data.startDate ? new Date(data.startDate) : null,
          endDate: data.endDate ? new Date(data.endDate) : null,
          description: data.description || null,
        })
        .returning();

      return { success: true, volume: newVolume };
    } catch (error) {
      console.error("Failed to create volume:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Update a volume
export const updateVolume = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: string;
      volumeNumber?: number;
      year?: number | null;
      startDate?: string | null;
      endDate?: string | null;
      description?: string | null;
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, volumes } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      const { id, ...updateData } = data;

      await db
        .update(volumes)
        .set({
          ...updateData,
          startDate: updateData.startDate ? new Date(updateData.startDate) : null,
          endDate: updateData.endDate ? new Date(updateData.endDate) : null,
          updatedAt: new Date(),
        })
        .where(eq(volumes.id, id));

      return { success: true };
    } catch (error) {
      console.error("Failed to update volume:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Delete a volume (cascades to issues)
export const deleteVolume = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, volumes } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      await db.delete(volumes).where(eq(volumes.id, data.id));

      return { success: true };
    } catch (error) {
      console.error("Failed to delete volume:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Create a new issue
export const createIssue = createServerFn({ method: "POST" })
  .validator(
    (data: {
      volumeId: string;
      issueNumber: number;
      title?: string;
      releaseDate?: string;
      description?: string;
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, issues } = await import("@db/index");

      const [newIssue] = await db
        .insert(issues)
        .values({
          volumeId: data.volumeId,
          issueNumber: data.issueNumber,
          title: data.title || null,
          releaseDate: data.releaseDate ? new Date(data.releaseDate) : null,
          description: data.description || null,
        })
        .returning();

      return { success: true, issue: newIssue };
    } catch (error) {
      console.error("Failed to create issue:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Update an issue
export const updateIssue = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: string;
      issueNumber?: number;
      title?: string | null;
      releaseDate?: string | null;
      description?: string | null;
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const { db, issues } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      const { id, ...updateData } = data;

      await db
        .update(issues)
        .set({
          ...updateData,
          releaseDate: updateData.releaseDate ? new Date(updateData.releaseDate) : null,
          updatedAt: new Date(),
        })
        .where(eq(issues.id, id));

      return { success: true };
    } catch (error) {
      console.error("Failed to update issue:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Delete an issue
export const deleteIssue = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, issues } = await import("@db/index");
      const { eq } = await import("drizzle-orm");

      await db.delete(issues).where(eq(issues.id, data.id));

      return { success: true };
    } catch (error) {
      console.error("Failed to delete issue:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

// Migrate legacy volume/issue data to new tables
export const migrateLegacyVolumeIssues = createServerFn({ method: "POST" }).handler(
  async () => {
    try {
      const { db, articles, volumes, issues } = await import("@db/index");
      const { sql, isNotNull, and, eq } = await import("drizzle-orm");

      // Get all unique volume/issue combinations from articles
      const legacyData = await db
        .selectDistinct({
          volume: articles.volume,
          issue: articles.issue,
        })
        .from(articles)
        .where(and(isNotNull(articles.volume), isNotNull(articles.issue)));

      if (legacyData.length === 0) {
        return { success: true, message: "No legacy data to migrate", created: { volumes: 0, issues: 0 } };
      }

      // Group by volume
      const volumeMap = new Map<number, Set<number>>();
      for (const row of legacyData) {
        if (row.volume !== null && row.issue !== null) {
          if (!volumeMap.has(row.volume)) {
            volumeMap.set(row.volume, new Set());
          }
          volumeMap.get(row.volume)!.add(row.issue);
        }
      }

      let volumesCreated = 0;
      let issuesCreated = 0;

      // Create volumes and issues
      for (const [volumeNumber, issueNumbers] of volumeMap) {
        // Check if volume already exists
        let existingVolume = await db.query.volumes.findFirst({
          where: eq(volumes.volumeNumber, volumeNumber),
        });

        if (!existingVolume) {
          // Create the volume
          const [newVolume] = await db
            .insert(volumes)
            .values({
              volumeNumber,
            })
            .returning();
          existingVolume = newVolume;
          volumesCreated++;
        }

        // Create issues for this volume
        for (const issueNumber of issueNumbers) {
          // Check if issue already exists
          const existingIssue = await db.query.issues.findFirst({
            where: and(
              eq(issues.volumeId, existingVolume.id),
              eq(issues.issueNumber, issueNumber)
            ),
          });

          if (!existingIssue) {
            // Create the issue
            const [newIssue] = await db
              .insert(issues)
              .values({
                volumeId: existingVolume.id,
                issueNumber,
              })
              .returning();
            issuesCreated++;

            // Update articles with this volume/issue to use the new issueId
            await db
              .update(articles)
              .set({
                issueId: newIssue.id,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(articles.volume, volumeNumber),
                  eq(articles.issue, issueNumber)
                )
              );
          }
        }
      }

      return {
        success: true,
        message: `Migration complete`,
        created: { volumes: volumesCreated, issues: issuesCreated },
      };
    } catch (error) {
      console.error("Failed to migrate legacy volume/issue data:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
);
