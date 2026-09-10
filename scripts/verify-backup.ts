import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { BackupArchive, exportManifest } from "../server/backup";
import { parseManifest } from "../shared/backup";
import { tableNames } from "../shared/model";
import { getStorage } from "../storage";
import { query } from "../server/convex";
const path = process.argv[2];
if (!path) throw new Error("Provide the recovery ZIP path");
const archive = await BackupArchive.open(path);
try {
  const manifest = JSON.parse(
    (
      await archive.read(
        archive.entries.has("manifest.json")
          ? "manifest.json"
          : "database/manifest.json",
        8 * 1024 ** 2,
      )
    ).toString(),
  );
  const expected = parseManifest(manifest),
    actual = parseManifest(await exportManifest("database"));
  for (const table of tableNames) {
    const sort = (rows: any[]) => rows.sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(
      sort(actual[table]),
      sort(expected[table]),
      `${table} records differ`,
    );
  }
  const report = JSON.parse(
    (await archive.read("recovery-report.json", 8 * 1024 ** 2)).toString(),
  );
  let checked = 0,
    bytes = 0;
  const files = report.files as {
    path: string;
    bytes: number;
    sha256: string;
  }[];
  for (let start = 0; start < files.length; start += 4) {
    await Promise.all(
      files.slice(start, start + 4).map(async (file) => {
        const buffer = await getStorage().getFile(file.path);
        assert(buffer, "Missing uploaded file");
        assert.equal(buffer.length, file.bytes);
        assert.equal(
          createHash("sha256").update(buffer).digest("hex"),
          file.sha256,
          "Downloaded bytes differ",
        );
        checked++;
        bytes += buffer.length;
      }),
    );
    if (start % 80 === 0)
      console.log(`Downloaded and verified ${checked}/${files.length}`);
  }
  const article = expected.articles[0],
    author = expected.authors[0],
    volume = expected.volumes[0],
    issue = expected.issues[0];
  const calls: Record<string, any> = {
    getDashboardStats: undefined,
    getArticles: { limit: 1000 },
    getArticleById: { id: article.id },
    getAuthorById: { id: author.id },
    getVolumes: undefined,
    getIssueById: { id: issue.id },
    getVolumeById: { id: volume.id },
    getIssuesForVolume: { volumeId: volume.id },
    getSavedViews: undefined,
    getDefaultView: undefined,
    getAllAnalyticsWithCrossFilter: {},
    getPaymentStats: {},
    getPaymentStatusBreakdown: {},
    getTierAnalytics: {},
    getBonusFrequency: {},
    getTopEarningAuthors: {},
    getEarningsByAuthorType: {},
    getEarningsByStudentType: {},
    getMonthlySpendingTrends: { months: 120 },
    getSemesterBreakdown: { years: 10 },
    getArticlesByTier: { tier: article.articleTier },
    getArticlesByBonus: { bonusType: "Research" },
    getArticlesByPaymentStatus: { paid: true },
    getArticlesBySemester: { semester: "Fall", year: 2025 },
    getAuthorWithArticles: { authorId: author.id },
    getAuthorsByType: { authorType: "Student" },
    getAuthorsByStudentType: { studentType: "Unknown" },
    findDuplicates: undefined,
    findDuplicateFiles: undefined,
    getUnpaidArticles: undefined,
  };
  for (const [name, data] of Object.entries(calls))
    await query(name as any, data);
  const summary = {
    verifiedAt: new Date().toISOString(),
    deployment: "local Convex",
    records: Object.fromEntries(tableNames.map((t) => [t, actual[t].length])),
    filesVerified: checked,
    bytesVerified: bytes,
    queriesVerified: Object.keys(calls).length,
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/convex-import-verification.json",
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  archive.close();
}
