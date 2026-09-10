import { importBackup } from "../server/backup";
const args = process.argv.slice(2),
  path = args.find((a) => !a.startsWith("--"));
if (!path)
  throw new Error(
    "Usage: npm run backup:import -- /path/to/backup.zip [--dry-run] [--database-only] [--replace]",
  );
let last = "";
const result = await importBackup(path, {
  dryRun: args.includes("--dry-run"),
  mode: args.includes("--replace") ? "replace" : "merge",
  type: args.includes("--database-only") ? "database" : "both",
  onProgress: (p) => {
    const step = Math.floor((p.completed / p.total) * 10);
    const key = p.stage + step;
    if (key !== last) {
      console.log(`${p.stage}: ${p.completed}/${p.total}`);
      last = key;
    }
  },
});
console.log(JSON.stringify(result, null, 2));
