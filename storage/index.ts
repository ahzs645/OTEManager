import { ConvexStorageProvider } from "./convex";
const storage = new ConvexStorageProvider();
export function getStorage() {
  return storage;
}
export type { StorageProvider, StorageFile, UploadResult } from "./types";
