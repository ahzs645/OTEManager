export function validateFilePath(path: string): string {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((s) => s === ".." || s === "." || !s) ||
    /^[a-z]:/i.test(path)
  )
    throw new Error("Invalid attachment path");
  return path;
}
