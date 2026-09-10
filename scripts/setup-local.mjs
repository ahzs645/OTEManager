import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";

const env = { ...process.env, CONVEX_AGENT_MODE: "anonymous" };
const existing = {
  ...(existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {}),
  ...(existsSync(".env.local")
    ? parseEnv(readFileSync(".env.local", "utf8"))
    : {}),
  ...process.env,
};
if (
  existing.CONVEX_DEPLOY_KEY ||
  existing.CONVEX_SELF_HOSTED_URL ||
  (existing.CONVEX_DEPLOYMENT &&
    !/^(anonymous|local):/.test(existing.CONVEX_DEPLOYMENT))
) {
  throw new Error(
    "setup:local found an existing cloud or self-hosted deployment configuration. Use a separate checkout for local setup, or follow the cloud setup instructions.",
  );
}

function run(args) {
  const r = spawnSync("npx", ["convex", ...args], {
    stdio: "inherit",
    env,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
// The CLI initializes local data; the dev watcher publishes the functions later.
if (!existsSync(".env.local")) run(["init"]);
let config = readFileSync(".env.local", "utf8");
if (!/VITE_CONVEX_URL=http:\/\/(127\.0\.0\.1|localhost):/.test(config))
  throw new Error(
    "setup:local only configures a local Convex deployment. Use the cloud setup instructions for an existing cloud project.",
  );
let secret = config.match(/^CONVEX_SERVER_SECRET=(.+)$/m)?.[1];
if (!secret) {
  secret = randomBytes(32).toString("hex");
  config += "\nCONVEX_SERVER_SECRET=" + secret + "\n";
  writeFileSync(".env.local", config, { mode: 0o600 });
}
// Never print the secret or return it to a browser. The child process receives it directly.
const r = spawnSync(
  "npx",
  ["convex", "env", "set", "CONVEX_SERVER_SECRET", secret],
  { encoding: "utf8", env },
);
if (r.status !== 0) {
  console.error(
    "Could not configure Convex. Start npm run convex:dev and rerun setup:local.",
  );
  process.exit(1);
}
console.log(
  "Local Convex server connection configured. Run npm run convex:dev and npm run dev in separate terminals.",
);
