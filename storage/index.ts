import type { StorageProvider } from "./types";
import { LocalStorageProvider } from "./local";

// Storage provider instance - swap this for S3 when ready
let storageInstance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!storageInstance) {
    // Check if S3 is configured
    const useS3 = process.env.S3_BUCKET && process.env.AWS_ACCESS_KEY_ID;

    if (useS3) {
      // Future: Initialize S3 provider
      // storageInstance = new S3StorageProvider();
      console.warn("S3 configured but not implemented yet, using local storage");
      storageInstance = new LocalStorageProvider();
    } else {
      storageInstance = new LocalStorageProvider();
    }
  }
  return storageInstance;
}

// Re-export types
export type { StorageProvider, StorageFile, UploadResult } from "./types";
export { LocalStorageProvider } from "./local";
