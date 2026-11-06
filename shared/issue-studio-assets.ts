import { validateFilePath } from "./file-path";

export interface BackupFileReference {
  path: string;
  fileSize: number | null;
  mimeType: string | null;
}

/** Include live and historical assets, including art with no article attachment. */
export function collectBackupFiles(data: Record<string, unknown>): BackupFileReference[] {
  const found = new Map<string, BackupFileReference>();
  function add(path: unknown, fileSize: unknown = null, mimeType: unknown = null) {
    if (typeof path !== "string" || !path) return;
    validateFilePath(path);
    const old = found.get(path);
    found.set(path, {
      path,
      fileSize: typeof fileSize === "number" ? fileSize : old?.fileSize ?? null,
      mimeType: typeof mimeType === "string" ? mimeType : old?.mimeType ?? null,
    });
  }
  for (const file of (Array.isArray(data.referencedFiles) ? data.referencedFiles : []))
    if (file && typeof file === "object") add(file.path, file.fileSize, file.mimeType);
  for (const file of (Array.isArray(data.attachments) ? data.attachments : []))
    if (file && typeof file === "object") add(file.filePath, file.fileSize, file.mimeType);
  let nodes = 0;
  const visit = (value: unknown, depth = 0): void => {
    if (++nodes > 500_000 || depth > 64) throw new Error("Issue Studio asset references exceed backup limits");
    if (typeof value === "string" && (value.startsWith("{") || value.startsWith("["))) {
      let decoded: unknown;
      try { decoded = JSON.parse(value); } catch { return; }
      visit(decoded, depth + 1);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
    } else if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      if (typeof object.filePath === "string") add(object.filePath, object.fileSize, object.mimeType);
      for (const key of ["artworkPath", "outputPath", "documentPath", "nativePath", "idmlPath", "pdfPath"]) add(object[key]);
      if (object.assetRefs && typeof object.assetRefs === "object")
        for (const path of Object.values(object.assetRefs)) add(path);
      if (Array.isArray(object.artifacts))
        for (const artifact of object.artifacts)
          if (artifact && typeof artifact === "object") add(artifact.path, artifact.size, artifact.mimeType);
      if (object.fork && typeof object.fork === "object") add((object.fork as Record<string, unknown>).path);
      for (const child of Object.values(object)) visit(child, depth + 1);
    }
  };
  for (const name of ["issueDesignPlans", "issuePages", "issuePlacements", "issueReservations", "issueDesignRevisions", "compositionJobs"])
    if (data[name]) visit(data[name]);
  return [...found.values()];
}
