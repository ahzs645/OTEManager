import { createServerFn } from "@tanstack/start";
import fs from "fs";
import path from "path";
import postgres from "postgres";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";

// Path to local config file (for storing connection settings)
const CONFIG_FILE_PATH = path.join(process.cwd(), ".env.local.json");

export interface ConnectionConfig {
  database: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
  };
  storage: {
    type: "local" | "s3";
    // Local storage settings
    uploadDir: string;
    maxFileSize: number;
    // S3/MinIO settings
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
}

// Parse DATABASE_URL into components
function parseDatabaseUrl(url: string): ConnectionConfig["database"] {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || "localhost",
      port: parseInt(parsed.port) || 5432,
      database: parsed.pathname.replace("/", "") || "otemanager",
      username: parsed.username || "otemanager",
      password: decodeURIComponent(parsed.password || ""),
    };
  } catch {
    return {
      host: "localhost",
      port: 5432,
      database: "otemanager",
      username: "otemanager",
      password: "",
    };
  }
}

// Build DATABASE_URL from components
function buildDatabaseUrl(config: ConnectionConfig["database"]): string {
  const encodedPassword = encodeURIComponent(config.password);
  return `postgresql://${config.username}:${encodedPassword}@${config.host}:${config.port}/${config.database}`;
}

// Get current connection configuration from environment
export const getConnectionConfig = createServerFn({ method: "GET" }).handler(
  async () => {
    // Try to load saved config first
    let savedConfig: Partial<ConnectionConfig> = {};
    try {
      if (fs.existsSync(CONFIG_FILE_PATH)) {
        const content = fs.readFileSync(CONFIG_FILE_PATH, "utf-8");
        savedConfig = JSON.parse(content);
      }
    } catch {
      // Ignore file read errors
    }

    // Parse current DATABASE_URL
    const databaseUrl = process.env.DATABASE_URL || "";
    const dbConfig = parseDatabaseUrl(databaseUrl);

    // Determine storage type from saved config first, then env vars
    const storageType = savedConfig.storage?.type || (process.env.S3_BUCKET && process.env.AWS_ACCESS_KEY_ID ? "s3" : "local");

    const config: ConnectionConfig = {
      database: {
        host: savedConfig.database?.host || dbConfig.host,
        port: savedConfig.database?.port || dbConfig.port,
        database: savedConfig.database?.database || dbConfig.database,
        username: savedConfig.database?.username || dbConfig.username,
        password: savedConfig.database?.password || dbConfig.password,
      },
      storage: {
        type: storageType,
        uploadDir:
          savedConfig.storage?.uploadDir ||
          process.env.UPLOAD_DIR ||
          "./uploads",
        maxFileSize:
          savedConfig.storage?.maxFileSize ||
          parseInt(process.env.MAX_FILE_SIZE || "52428800"),
        endpoint:
          savedConfig.storage?.endpoint ||
          process.env.S3_ENDPOINT ||
          "http://localhost:9000",
        region:
          savedConfig.storage?.region ||
          process.env.S3_REGION ||
          "us-east-1",
        bucket:
          savedConfig.storage?.bucket ||
          process.env.S3_BUCKET ||
          "ote-articles",
        accessKeyId:
          savedConfig.storage?.accessKeyId ||
          process.env.AWS_ACCESS_KEY_ID ||
          "",
        secretAccessKey:
          savedConfig.storage?.secretAccessKey ||
          process.env.AWS_SECRET_ACCESS_KEY ||
          "",
      },
    };

    // Check current connection status
    let dbConnected = false;
    let storageConnected = false;

    // Test database connection using the resolved config
    try {
      const testUrl = buildDatabaseUrl(config.database);
      const testClient = postgres(testUrl, { max: 1, connect_timeout: 5 });
      await testClient`SELECT 1`;
      await testClient.end();
      dbConnected = true;
    } catch {
      dbConnected = false;
    }

    // Test storage connection using the resolved config
    if (storageType === "s3") {
      try {
        const s3Client = new S3Client({
          region: config.storage.region,
          endpoint: config.storage.endpoint,
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.storage.accessKeyId,
            secretAccessKey: config.storage.secretAccessKey,
          },
        });
        await s3Client.send(new ListBucketsCommand({}));
        storageConnected = true;
      } catch {
        storageConnected = false;
      }
    } else {
      // For local storage, just check if directory exists or can be created
      try {
        const uploadDir = config.storage.uploadDir;
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        storageConnected = true;
      } catch {
        storageConnected = false;
      }
    }

    return {
      config,
      status: {
        dbConnected,
        storageConnected,
        usingS3: storageType === "s3",
      },
    };
  }
);

// Save connection configuration
export const saveConnectionConfig = createServerFn({ method: "POST" })
  .validator((data: { config: ConnectionConfig }) => data)
  .handler(async ({ data }) => {
    try {
      // Save to local JSON config file
      fs.writeFileSync(
        CONFIG_FILE_PATH,
        JSON.stringify(data.config, null, 2),
        "utf-8"
      );

      // Also generate an .env file content for reference
      const envContent = `# Generated by OTEManager Settings
# Copy these values to your .env file and restart the application

DATABASE_URL=${buildDatabaseUrl(data.config.database)}
UPLOAD_DIR=${data.config.storage.uploadDir}
MAX_FILE_SIZE=${data.config.storage.maxFileSize}
S3_BUCKET=${data.config.storage.bucket}
S3_REGION=${data.config.storage.region}
S3_ENDPOINT=${data.config.storage.endpoint}
AWS_ACCESS_KEY_ID=${data.config.storage.accessKeyId}
AWS_SECRET_ACCESS_KEY=${data.config.storage.secretAccessKey}
`;

      const envFilePath = path.join(process.cwd(), ".env.generated");
      fs.writeFileSync(envFilePath, envContent, "utf-8");

      return {
        success: true,
        message:
          "Configuration saved. Restart the application to apply changes.",
        envFilePath,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save config",
      };
    }
  });

// Test database connection with provided credentials
export const testDatabaseConnection = createServerFn({ method: "POST" })
  .validator(
    (data: {
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
    }) => data
  )
  .handler(async ({ data }) => {
    try {
      const connectionUrl = buildDatabaseUrl(data);
      const testClient = postgres(connectionUrl, {
        max: 1,
        connect_timeout: 10,
        idle_timeout: 5,
      });

      // Try a simple query
      await testClient`SELECT 1 as test`;

      // Also check if our tables exist
      const tables = await testClient`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `;

      await testClient.end();

      const tableNames = tables.map((t) => (t as Record<string, string>).table_name);
      const hasOteManagerTables = tableNames.includes("articles") || tableNames.includes("authors");

      return {
        success: true,
        message: hasOteManagerTables
          ? `Connected successfully. Found ${tables.length} tables including OTEManager schema.`
          : `Connected successfully. Found ${tables.length} tables. OTEManager tables not found - you may need to run migrations.`,
        tableCount: tables.length,
        hasOteManagerTables,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Connection failed";

      // Provide helpful error messages
      let helpText = "";
      if (errorMessage.includes("ECONNREFUSED")) {
        helpText =
          "Connection refused. Check that PostgreSQL is running and the host/port are correct.";
      } else if (errorMessage.includes("password authentication")) {
        helpText = "Authentication failed. Check your username and password.";
      } else if (errorMessage.includes("does not exist")) {
        helpText =
          "Database does not exist. You may need to create it first.";
      } else if (errorMessage.includes("ETIMEDOUT")) {
        helpText =
          "Connection timed out. Check that the host is reachable and any firewalls allow the connection.";
      }

      return {
        success: false,
        error: errorMessage,
        helpText,
      };
    }
  });

// Test S3/MinIO connection with provided credentials
export const testStorageConnection = createServerFn({ method: "POST" })
  .validator(
    (data: {
      type: "local" | "s3";
      endpoint?: string;
      region?: string;
      bucket?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      uploadDir?: string;
    }) => data
  )
  .handler(async ({ data }) => {
    if (data.type === "local") {
      try {
        const uploadDir = data.uploadDir || "./uploads";
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        // Test write permission
        const testFile = path.join(uploadDir, ".write-test");
        fs.writeFileSync(testFile, "test");
        fs.unlinkSync(testFile);

        return {
          success: true,
          message: `Local storage is writable at ${uploadDir}`,
        };
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Local storage test failed",
          helpText:
            "Check that the upload directory path is valid and writable.",
        };
      }
    }

    // Test S3/MinIO connection
    try {
      const s3Client = new S3Client({
        region: data.region || "us-east-1",
        endpoint: data.endpoint || "http://localhost:9000",
        forcePathStyle: true,
        credentials: {
          accessKeyId: data.accessKeyId || "",
          secretAccessKey: data.secretAccessKey || "",
        },
      });

      // List buckets to verify credentials
      const buckets = await s3Client.send(new ListBucketsCommand({}));
      const bucketNames = buckets.Buckets?.map((b) => b.Name) || [];

      const targetBucket = data.bucket || "ote-articles";
      const bucketExists = bucketNames.includes(targetBucket);

      return {
        success: true,
        message: bucketExists
          ? `Connected successfully. Bucket "${targetBucket}" is available.`
          : `Connected successfully. Found ${bucketNames.length} buckets, but "${targetBucket}" was not found. You may need to create it.`,
        buckets: bucketNames,
        bucketExists,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Connection failed";

      let helpText = "";
      if (errorMessage.includes("ECONNREFUSED")) {
        helpText =
          "Connection refused. Check that MinIO/S3 is running and the endpoint is correct.";
      } else if (
        errorMessage.includes("InvalidAccessKeyId") ||
        errorMessage.includes("SignatureDoesNotMatch")
      ) {
        helpText =
          "Authentication failed. Check your access key and secret key.";
      } else if (errorMessage.includes("ETIMEDOUT")) {
        helpText =
          "Connection timed out. Check that the endpoint is reachable.";
      }

      return {
        success: false,
        error: errorMessage,
        helpText,
      };
    }
  });
