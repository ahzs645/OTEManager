import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import fs from "fs";
import path from "path";
import * as schema from "./schema";

// Path to saved config file
const CONFIG_FILE_PATH = path.join(process.cwd(), ".env.local.json");

interface SavedConfig {
  database?: {
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
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

function buildConnectionString(): string {
  // First check environment variable
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  // Fall back to saved config
  const savedConfig = loadSavedConfig();
  if (savedConfig?.database) {
    const { host, port, database, username, password } = savedConfig.database;
    const encodedPassword = encodeURIComponent(password || "");
    return `postgresql://${username || "otemanager"}:${encodedPassword}@${host || "localhost"}:${port || 5432}/${database || "otemanager"}`;
  }

  throw new Error("DATABASE_URL environment variable is not set and no saved config found");
}

// Database connection string from environment or saved config
const connectionString = buildConnectionString();

// Create postgres client
const client = postgres(connectionString);

// Create drizzle instance with schema
export const db = drizzle(client, { schema });

// Export schema for convenience
export * from "./schema";
