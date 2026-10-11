// Downscaled previews for photo grids. Phone photos are often 12+ megapixels;
// rendering a dozen of them at full size makes article pages blank out.

/** Widths the file route will generate, so arbitrary sizes can't fill the cache. */
export const THUMBNAIL_WIDTHS = [240, 480, 960] as const;
const THUMBNAIL_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function thumbnailWidth(requested: string | null): number | null {
  if (!requested) return null;
  const width = Number(requested);
  // Round up to the nearest supported width
  return THUMBNAIL_WIDTHS.find((w) => w >= width) ?? null;
}

export function canThumbnail(mimeType: string) {
  return THUMBNAIL_TYPES.has(mimeType);
}

// Small in-memory LRU; thumbnails are ~20-60 KB each
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const cache = new Map<string, Buffer>();
let cacheBytes = 0;

function remember(key: string, value: Buffer) {
  cache.set(key, value);
  cacheBytes += value.length;
  for (const [oldKey, oldValue] of cache) {
    if (cacheBytes <= MAX_CACHE_BYTES) break;
    cache.delete(oldKey);
    cacheBytes -= oldValue.length;
  }
}

/**
 * Returns a WebP thumbnail no wider or taller than `width`, or null when the
 * image can't be processed (the caller then serves the original).
 */
export async function getThumbnail(
  key: string,
  width: number,
  load: () => Promise<Buffer | null>,
): Promise<Buffer | null> {
  const cacheKey = `${width}:${key}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    // Refresh recency
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return cached;
  }
  const original = await load();
  if (!original) return null;
  try {
    const { default: sharp } = await import("sharp");
    const thumbnail = await sharp(original, { failOn: "none" })
      .rotate() // apply EXIF orientation before the metadata is stripped
      .resize({
        width,
        height: width,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 78 })
      .toBuffer();
    remember(cacheKey, thumbnail);
    return thumbnail;
  } catch (error) {
    console.error("Thumbnail generation failed:", error);
    return null;
  }
}
