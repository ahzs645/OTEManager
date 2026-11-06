// @vitest-environment node
import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
const run = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const tool = path.resolve("tools/designcraft/adobe-validation.mjs");
async function prepared() {
  const directory = await mkdtemp(path.join(tmpdir(), "ote-adobe-"));
  directories.push(directory);
  const output = path.join(directory, "output"),
    idml = path.join(directory, "issue.idml"),
    profile = path.join(directory, "profile.json");
  await mkdir(output);
  await writeFile(idml, "exact-idml-bytes");
  await writeFile(
    profile,
    JSON.stringify({
      pageWidthPoints: 756,
      pageHeightPoints: 792,
      bleedPoints: [9, 9, 9, 9],
      pageMultiple: 4,
      preflightProfile: "OTE Press",
      colorProfile: "Printer CMYK",
      minImagePpi: 300,
    }),
  );
  await run(process.execPath, [
    tool,
    "prepare",
    idml,
    hash("input"),
    profile,
    output,
  ]);
  const request = JSON.parse(
    await readFile(path.join(output, "adobe-request.json"), "utf8"),
  );
  return { directory, output, idml, profile, request };
}
async function writeOperatorFixture(f: Awaited<ReturnType<typeof prepared>>) {
  await writeFile(
    path.join(f.output, "validated.indd"),
    "native-fixture-bytes",
  );
  await writeFile(
    path.join(f.output, "adobe-checks.json"),
    JSON.stringify({
      schemaVersion: "ote.adobe-validation.v1",
      inputSha256: f.request.inputSha256,
      artifactSha256: f.request.artifactSha256,
      nativeSha256: hash("native-fixture-bytes"),
      checkedAt: "2026-10-21T00:00:00Z",
      application: {
        name: "Adobe InDesign",
        version: "test-fixture",
        platform: "test",
      },
      checks: {
        missingFonts: [],
        invalidLinks: [],
        oversetStories: [],
        lowResolutionImages: [],
        minImagePpi: 300,
        pageCount: 4,
        pageWidthPoints: 756,
        pageHeightPoints: 792,
        bleedPoints: [9, 9, 9, 9],
        preflightProfile: "OTE Press",
        preflightErrors: 0,
        colorProfile: "Printer CMYK",
      },
      outputs: { native: path.join(f.output, "validated.indd") },
    }),
  );
}

test("desktop handoff binds an operator report to actual immutable bytes without claiming Adobe executed", async () => {
  const f = await prepared();
  expect(f.request.artifactSha256).toBe(hash("exact-idml-bytes"));
  const script = await readFile(
    path.join(f.output, "run-adobe-validation.jsx"),
    "utf8",
  );
  expect(script).toContain("preflightProcesses.add");
  expect(script).toContain("Output already exists");
  // This is a deliberately synthetic report fixture, not an InDesign runtime test.
  await writeOperatorFixture(f);
  await run(process.execPath, [tool, "finalize", f.output]);
  const report = JSON.parse(
    await readFile(path.join(f.output, "adobe-validation.json"), "utf8"),
  );
  expect(report.nativeSha256).toBe(hash("native-fixture-bytes"));
  expect(report.artifactSha256).toBe(hash("exact-idml-bytes"));
  await expect(
    run(process.execPath, [tool, "finalize", f.output]),
  ).rejects.toThrow();
});

test("changing the prepared IDML blocks Adobe evidence finalization", async () => {
  const f = await prepared();
  await writeOperatorFixture(f);
  await writeFile(f.idml, "changed-later");
  await expect(
    run(process.execPath, [tool, "finalize", f.output]),
  ).rejects.toThrow(/Input IDML changed/);
});

test("desktop ES3 SHA-256 checks exact binary bytes across chunk and padding boundaries", async () => {
  const { runInNewContext } = await import("node:vm");
  const script = await readFile(
    path.resolve("tools/designcraft/validate-adobe.jsx"),
    "utf8",
  );
  const functionSource = script.slice(0, script.indexOf("/* Original desktop"));
  const digest = runInNewContext(functionSource + "; oteFileSha256;");
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from("abc"),
    Buffer.alloc(55, 255),
    Buffer.alloc(56, 0),
    Buffer.alloc(32770, 160),
  ]) {
    let cursor = 0;
    const file = {
      length: bytes.length,
      encoding: "",
      get eof() {
        return cursor >= bytes.length;
      },
      open() {
        return true;
      },
      close() {},
      read(length: number) {
        const piece = bytes
          .subarray(cursor, cursor + length)
          .toString("latin1");
        cursor += piece.length;
        return piece;
      },
    };
    expect(digest(file)).toBe(createHash("sha256").update(bytes).digest("hex"));
  }
});

test("changing the checked INDD blocks evidence finalization", async () => {
  const f = await prepared();
  await writeOperatorFixture(f);
  await writeFile(
    path.join(f.output, "validated.indd"),
    "manually-changed-after-check",
  );
  await expect(
    run(process.execPath, [tool, "finalize", f.output]),
  ).rejects.toThrow(/changed after Adobe/);
});
