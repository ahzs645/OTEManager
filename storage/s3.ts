import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import path from "path";
import type { StorageProvider, UploadResult } from "./types";

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private endpoint: string;

  constructor() {
    this.endpoint = process.env.S3_ENDPOINT || "http://localhost:9000";
    this.bucket = process.env.S3_BUCKET || "ote-articles";

    this.client = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: this.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
      },
    });
  }

  private sanitizeFilename(filename: string): string {
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

  async upload(
    buffer: Buffer,
    filename: string,
    directory: string
  ): Promise<UploadResult> {
    try {
      const uniqueFilename = this.generateUniqueFilename(filename);
      const key = `${directory}/${uniqueFilename}`;
      const mimeType = this.getMimeType(filename);

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        })
      );

      return {
        success: true,
        file: {
          name: uniqueFilename,
          path: key,
          size: buffer.length,
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
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: filePath,
        })
      );
      const stream = response.Body;
      if (!stream) return null;
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  async delete(filePath: string): Promise<boolean> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: filePath,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: filePath,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  async saveFile(filePath: string, buffer: Buffer): Promise<boolean> {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = this.getMimeType(filePath);

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: filePath,
          Body: buffer,
          ContentType: mimeType,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  getUrl(filePath: string): string {
    return `/api/files/${filePath}`;
  }
}
