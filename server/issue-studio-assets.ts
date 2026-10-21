import { createHash } from "node:crypto";
import { get } from "./records";
import { getStorage } from "../storage";

/** Immutable issue-owned artwork. Original filenames never select storage paths. */
export async function handleIssueStudioAsset(request: Request, issueId: string) {
  try {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(issueId))
      return Response.json({ error: "Invalid issue ID" }, { status: 400 });
    if (!(await get("issues", issueId)))
      return Response.json({ error: "Issue not found" }, { status: 404 });
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > 17 * 1024 * 1024)
      return Response.json({ error: "Artwork must be 16 MB or smaller" }, { status: 413 });
    const form = await request.formData();
    const file = form.get("file"), path = form.get("path");
    if (!(file instanceof File) || typeof path !== "string" ||
      !/^assets\/(?:user-[a-zA-Z0-9_.-]+|cover-photo\.[a-zA-Z0-9]+)$/.test(path))
      return Response.json({ error: "Choose a planner artwork file" }, { status: 400 });
    if (file.size < 1 || file.size > 16 * 1024 * 1024)
      return Response.json({ error: "Artwork must contain 1 byte to 16 MB" }, { status: 413 });
    const extension = path.split(".").pop()?.toLowerCase();
    if (!extension || !["png", "jpg", "jpeg", "webp", "gif", "tif", "tiff", "pdf"].includes(extension))
      return Response.json({ error: "Use PNG, JPEG, WebP, GIF, TIFF or PDF artwork" }, { status: 400 });
    const data = Buffer.from(await file.arrayBuffer());
    const hash = createHash("sha256").update(data).digest("hex");
    const storagePath = `issue-studio/${issueId}/${hash}.${extension}`;
    const storage = getStorage();
    if (!(await storage.exists(storagePath))) await storage.saveFile(storagePath, data);
    return Response.json({ success: true, path: storagePath, sha256: hash, size: data.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Artwork could not be saved" }, { status: 400 });
  }
}
