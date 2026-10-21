import { createHash } from "node:crypto";
import JSZip from "jszip";
import { mutate, query } from "./convex";
import { getStorage } from "../storage";

/** Manual native edits are stored as a distinct immutable artifact, never written over a recipe. */
export async function handleIssueStudioFork(request: Request, issueId: string) {
  try {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(issueId)) throw new Error("Invalid issue ID");
    const form = await request.formData(), file = form.get("file");
    const expectedRevision = Number(form.get("expectedRevision"));
    const name = String(form.get("name") || (file instanceof File ? file.name : "Manual edit")).trim().slice(0, 200);
    if (!(file instanceof File) || !/\.(designcraft|idml|indd|indt)$/i.test(file.name) || file.size < 1 || file.size > 64 * 1024 * 1024)
      throw new Error("Choose a saved DesignCraft, IDML, INDD or INDT document up to 64 MB");
    const studio = await query("getIssueStudio", { issueId });
    if (!studio.plan || studio.plan.revision !== expectedRevision) throw new Error("Issue Studio revision conflict: reload before saving the manual edit");
    const bytes = Buffer.from(await file.arrayBuffer());
    // Bounded structural check only. Saving a fork does not claim it passes preflight.
    if (/\.(designcraft|idml)$/i.test(file.name)) {
      const zip = await JSZip.loadAsync(bytes);
      const entries = Object.keys(zip.files);
      if (entries.length > 20_000 || entries.some(path => path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")))
        throw new Error("Invalid native document archive");
      if (file.name.toLowerCase().endsWith(".idml") && !zip.file("designmap.xml")) throw new Error("The IDML is missing designmap.xml");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const extension = file.name.toLowerCase().split(".").pop()!;
    const path = `issue-studio/${issueId}/forks/${sha256}.${extension}`;
    const storage = getStorage();
    if (!(await storage.exists(path))) await storage.saveFile(path, bytes);
    return Response.json(await mutate("recordNativeFork", { issueId, expectedRevision, name, path, sha256 }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Manual document could not be saved" }, { status: 400 });
  }
}
