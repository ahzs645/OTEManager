import type { StorageProvider } from "./types";
import { LocalStorageProvider } from "./local";
import { S3StorageProvider } from "./s3";

let storageInstance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!storageInstance) {
    const useS3 = process.env.S3_BUCKET && process.env.AWS_ACCESS_KEY_ID;

    if (useS3) {
      storageInstance = new S3StorageProvider();
    } else {
      storageInstance = new LocalStorageProvider();
    }
  }
  return storageInstance;
}

export type { StorageProvider, StorageFile, UploadResult } from "./types";
export { LocalStorageProvider } from "./local";
export { S3StorageProvider } from "./s3";
