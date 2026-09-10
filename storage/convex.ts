import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { makeFunctionReference } from "convex/server";
import { connection } from "../server/convex";
import { validateFilePath } from "../shared/file-path";
import type { StorageProvider, UploadResult } from "./types";
export function mimeType(filename: string) {
  return (
    (
      {
        ".docx":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".mp4": "video/mp4",
        ".mp3": "audio/mpeg",
      } as Record<string, string>
    )[path.extname(filename).toLowerCase()] || "application/octet-stream"
  );
}
export class ConvexStorageProvider implements StorageProvider {
  async info(
    filePath: string,
  ): Promise<{
    path: string;
    size: number;
    mimeType: string;
    sha256: string | null;
    url: string | null;
  } | null> {
    validateFilePath(filePath);
    const { client, secret } = connection();
    return client.query(makeFunctionReference<"query">("files:info"), {
      secret,
      path: filePath,
    });
  }
  async upload(
    buffer: Buffer,
    filename: string,
    directory: string,
  ): Promise<UploadResult> {
    try {
      const name = `${path
        .basename(filename, path.extname(filename))
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(0, 150)}_${randomUUID()}${path.extname(filename)}`;
      const filePath = validateFilePath(`${directory}/${name}`);
      await this.store(filePath, buffer, mimeType(filename));
      return {
        success: true,
        file: {
          name,
          path: filePath,
          size: buffer.length,
          mimeType: mimeType(filename),
        },
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Upload failed",
      };
    }
  }
  async store(filePath: string, buffer: Buffer, type = mimeType(filePath)) {
    validateFilePath(filePath);
    const { client, secret } = connection();
    const url = await client.mutation(
      makeFunctionReference<"mutation">("files:uploadUrl"),
      { secret },
    );
    const response = await fetch(url, {
      method: "POST",
      body: new Uint8Array(buffer),
      headers: { "Content-Type": type },
    });
    if (!response.ok)
      throw new Error(`Convex upload failed (${response.status})`);
    const { storageId } = await response.json();
    try {
      await client.mutation(
        makeFunctionReference<"mutation">("files:finalize"),
        {
          secret,
          path: filePath,
          storageId,
          size: buffer.length,
          mimeType: type,
          sha256: createHash("sha256").update(buffer).digest("hex"),
        },
      );
    } catch (e) {
      await client
        .mutation(makeFunctionReference<"mutation">("files:discardUpload"), {
          secret,
          storageId,
        })
        .catch(() => {});
      throw e;
    }
  }
  async getFile(filePath: string) {
    const info = await this.info(filePath);
    if (!info?.url) return null;
    const r = await fetch(info.url);
    if (!r.ok) throw new Error(`Convex download failed (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }
  async delete(filePath: string) {
    const { client, secret } = connection();
    return client.mutation(makeFunctionReference<"mutation">("files:remove"), {
      secret,
      path: validateFilePath(filePath),
    });
  }
  async exists(filePath: string) {
    return !!(await this.info(filePath))?.url;
  }
  async saveFile(filePath: string, buffer: Buffer) {
    await this.store(filePath, buffer);
    return true;
  }
  getUrl(filePath: string) {
    return `/api/files/${validateFilePath(filePath).split("/").map(encodeURIComponent).join("/")}`;
  }
}
