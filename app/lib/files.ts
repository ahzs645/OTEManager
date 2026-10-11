/**
 * URL for a stored file. Each path segment is encoded so names containing
 * "#", "?" or "%" still resolve. Pass `width` for a downscaled image preview.
 */
export function fileUrl(filePath: string, width?: 240 | 480 | 960) {
  const path = filePath.split("/").map(encodeURIComponent).join("/");
  return `/api/files/${path}${width ? `?w=${width}` : ""}`;
}
