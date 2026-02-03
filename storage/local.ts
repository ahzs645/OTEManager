import { promises as fs } from "fs";
import path from "path";
import type { StorageProvider, UploadResult } from "./types";

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;
  private baseUrl: string;

  constructor(baseDir?: string, baseUrl?: string) {
    // Environment variables take priority over provided config
    this.baseDir = process.env.UPLOAD_DIR || baseDir || "./uploads";
    this.baseUrl = baseUrl || "/api/files";
  }

  private async ensureDirectory(dir: string): Promise<void> {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // Directory already exists or other error
    }
  }

  private sanitizeFilename(filename: string): string {
    // Remove potentially dangerous characters and normalize
    return filename
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_{2,}/g, "_")
      .substring(0, 255);
  }

  private generateUniqueFilename(filename: string): string {
    const ext = path.extname(filename);
    const name = path.basename(filename, ext);
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${this.sanitizeFilename(name)}_${timestamp}_${random}${ext}`;
  }

  async upload(
    buffer: Buffer,
    filename: string,
    directory: string
  ): Promise<UploadResult> {
    try {
      const fullDir = path.join(this.baseDir, directory);
      await this.ensureDirectory(fullDir);

      const uniqueFilename = this.generateUniqueFilename(filename);
      const filePath = path.join(fullDir, uniqueFilename);
      const relativePath = path.join(directory, uniqueFilename);

      await fs.writeFile(filePath, buffer);

      // Get file stats
      const stats = await fs.stat(filePath);

      // Determine MIME type from extension
      const mimeType = this.getMimeType(filename);

      return {
        success: true,
        file: {
          name: uniqueFilename,
          path: relativePath,
          size: stats.size,
          mimeType,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown upload error",
      };
    }
  }

  async getFile(filePath: string): Promise<Buffer | null> {
    try {
      const fullPath = path.join(this.baseDir, filePath);
      return await fs.readFile(fullPath);
    } catch {
      return null;
    }
  }

  async delete(filePath: string): Promise<boolean> {
    try {
      const fullPath = path.join(this.baseDir, filePath);
      await fs.unlink(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      const fullPath = path.join(this.baseDir, filePath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async saveFile(filePath: string, buffer: Buffer): Promise<boolean> {
    try {
      const fullPath = path.join(this.baseDir, filePath);
      await this.ensureDirectory(path.dirname(fullPath));
      await fs.writeFile(fullPath, buffer);
      return true;
    } catch {
      return false;
    }
  }

  getUrl(filePath: string): string {
    return `${this.baseUrl}/${filePath}`;
  }

  private getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
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
    };
    return mimeTypes[ext] || "application/octet-stream";
  }
}
