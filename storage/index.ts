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

    // Environment variables take priority over saved config
    const useS3FromEnv = !!(process.env.S3_BUCKET && process.env.AWS_ACCESS_KEY_ID);
    const useS3FromConfig = savedConfig?.storage?.type === "s3";
    const useS3 = useS3FromEnv || useS3FromConfig;

    if (useS3) {
      // Build config with env vars taking priority over saved config
      const s3Config = {
        endpoint: process.env.S3_ENDPOINT || savedConfig?.storage?.endpoint,
        region: process.env.S3_REGION || savedConfig?.storage?.region,
        bucket: process.env.S3_BUCKET || savedConfig?.storage?.bucket,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || savedConfig?.storage?.accessKeyId,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || savedConfig?.storage?.secretAccessKey,
      };
      storageInstance = new S3StorageProvider(s3Config);
    } else {
      const uploadDir = process.env.UPLOAD_DIR || savedConfig?.storage?.uploadDir;
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
