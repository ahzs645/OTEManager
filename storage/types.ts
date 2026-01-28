export interface StorageFile {
  name: string;
  path: string;
  size: number;
  mimeType: string;
}

export interface UploadResult {
  success: boolean;
  file?: StorageFile;
  error?: string;
}

export interface StorageProvider {
  /**
   * Upload a file to storage
   * @param buffer File content as a Buffer
   * @param filename Original filename
   * @param directory Target directory path
   */
  upload(buffer: Buffer, filename: string, directory: string): Promise<UploadResult>;

  /**
   * Get a file from storage
   * @param path Full path to the file
   */
  getFile(path: string): Promise<Buffer | null>;

  /**
   * Delete a file from storage
   * @param path Full path to the file
   */
  delete(path: string): Promise<boolean>;

  /**
   * Check if a file exists
   * @param path Full path to the file
   */
  exists(path: string): Promise<boolean>;

  /**
   * Save a file to a specific path (used for backup restore)
   * @param path Full path to save the file
   * @param buffer File content as a Buffer
   */
  saveFile(path: string, buffer: Buffer): Promise<boolean>;

  /**
   * Get a public URL for the file (if applicable)
   * @param path Full path to the file
   */
  getUrl(path: string): string;
}
