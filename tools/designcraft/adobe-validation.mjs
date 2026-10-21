#!/usr/bin/env node
/** Prepare an operator-run desktop script, then bind its report to actual output bytes. */
import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const [mode, ...args] = process.argv.slice(2);
if (mode === "prepare") {
  const [idmlName, inputHash, profileName, outputName] = args;
  if (!idmlName || !/^[a-f0-9]{64}$/.test(inputHash ?? "") || !profileName || !outputName)
    throw Error("Usage: node adobe-validation.mjs prepare issue.idml INPUT_SHA256 print-profile.json NEW_OUTPUT_DIRECTORY");
  const idml = path.resolve(idmlName), output = path.resolve(outputName);
  if (path.extname(idml).toLowerCase() !== ".idml") throw Error("Input must be an IDML file");
  await access(output);
  const profile = JSON.parse(await readFile(profileName, "utf8"));
  if (!profile.preflightProfile || !profile.colorProfile || !(profile.minImagePpi > 0))
    throw Error("Profile needs preflightProfile, colorProfile and positive minImagePpi");
  const request = { schemaVersion: "ote.adobe-request.v1", idml, inputSha256: inputHash, artifactSha256: sha(await readFile(idml)), profile, output };
  const script = await readFile(new URL("./validate-adobe.jsx", import.meta.url), "utf8");
  // This is generated source containing JSON literals, never eval of a downloaded script.
  const prelude = `var OTE_ADOBE_REQUEST = ${JSON.stringify(request).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")};\n`;
  await writeFile(path.join(output, "adobe-request.json"), JSON.stringify(request, null, 2), { flag: "wx" });
  await writeFile(path.join(output, "run-adobe-validation.jsx"), prelude + script, { flag: "wx" });
  process.stdout.write(`Run ${path.join(output, "run-adobe-validation.jsx")} from Adobe InDesign's Scripts panel. Then run finalize on this output directory.\n`);
} else if (mode === "finalize") {
  const [outputName] = args;
  if (!outputName) throw Error("Usage: node adobe-validation.mjs finalize OUTPUT_DIRECTORY");
  const output = path.resolve(outputName);
  const request = JSON.parse(await readFile(path.join(output, "adobe-request.json"), "utf8"));
  const raw = JSON.parse(await readFile(path.join(output, "adobe-checks.json"), "utf8"));
  if (request.output !== output || raw.inputSha256 !== request.inputSha256 || raw.artifactSha256 !== request.artifactSha256)
    throw Error("Adobe report does not match this request");
  if (sha(await readFile(request.idml)) !== request.artifactSha256)
    throw Error("Input IDML changed after preparation; prepare and validate again");
  const native = path.join(output, "validated.indd");
  if (path.resolve(raw.outputs?.native ?? "") !== native) throw Error("Unexpected native output path");
  const nativeSha256 = sha(await readFile(native));
  if (raw.nativeSha256 !== nativeSha256) throw Error("Native InDesign document changed after Adobe validation; validate it again.");
  const report = { ...raw, nativeSha256 };
  // Shared runtime validation ensures this is evidence, not merely an adobeInDesignTested flag.
  const { validateAdobeReport } = await import("../../shared/issue-studio-production.ts");
  validateAdobeReport(report);
  await writeFile(path.join(output, "adobe-validation.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  process.stdout.write(`Saved ${path.join(output, "adobe-validation.json")}. Import as operator evidence; final release still requires the matching print profile and successful checks.\n`);
} else {
  throw Error("Use prepare or finalize. See docs/ISSUE-STUDIO-PRODUCTION.md.");
}
