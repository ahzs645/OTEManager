import fs from "fs";
import path from "path";
import type { StorageProvider } from "./types";
import { LocalStorageProvider } from "./local";
import { S3StorageProvider } from "./s3";

// Path to saved config file (same as in connectionMutations.ts)
const CONFIG_FILE_PATH = path.join(process.cwd(), ".env.local.json");

interface SavedConfig {
  storage?: {
    type?: "local" | "s3";
    uploadDir?: string;
    endpoint?: string;
    region?: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
}

function loadSavedConfig(): SavedConfig | null {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const content = fs.readFileSync(CONFIG_FILE_PATH, "utf-8");
      return JSON.parse(content);
    }
  } catch {
    // Ignore file read errors
  }
  return null;
}

let storageInstance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!storageInstance) {
    const savedConfig = loadSavedConfig();

    // Check saved config first, then fall back to environment variables
    const useS3FromConfig = savedConfig?.storage?.type === "s3";
    const useS3FromEnv = !!(process.env.S3_BUCKET && process.env.AWS_ACCESS_KEY_ID);
    const useS3 = useS3FromConfig || useS3FromEnv;

    if (useS3) {
      // Pass saved config to S3 provider if available
      storageInstance = new S3StorageProvider(savedConfig?.storage);
    } else {
      const uploadDir = savedConfig?.storage?.uploadDir || process.env.UPLOAD_DIR;
      storageInstance = new LocalStorageProvider(uploadDir);
    }
  }
  return storageInstance;
}

// Allow resetting the storage instance (useful after config changes)
export function resetStorage(): void {
  storageInstance = null;
}

export type { StorageProvider, StorageFile, UploadResult } from "./types";
export { LocalStorageProvider } from "./local";
export { S3StorageProvider } from "./s3";
