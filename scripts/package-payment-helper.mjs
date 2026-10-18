import { mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import JSZip from "jszip";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = resolve(root, "extensions/vancity-payment-helper");
const files = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "popup.js",
  "bank.js",
  "contract.js",
  "security-preset.js",
  "account-preset.js",
  "manager-page.js",
  "manager-client.js",
  "bank-receipt.js",
  "receipt-contract.js",
  "background.js",
  "auto-next.js",
  "surface.js",
  "bank-history.js",
  "bank-tab.js",
  "README.md",
];
await mkdir(resolve(root, "public/payment-helper"), { recursive: true });
await rm(resolve(root, "public/payment-helper/vault.js"), { force: true });
await mkdir(resolve(root, "artifacts"), { recursive: true });
const zip = new JSZip();
for (const name of files) {
  const bytes = await readFile(resolve(source, name));
  zip.file(`ote-payment-helper/${name}`, bytes);
  await cp(resolve(source, name), resolve(root, "public/payment-helper", name));
}
const archive = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
});
await writeFile(resolve(root, "artifacts/ote-payment-helper.zip"), archive);
await writeFile(resolve(root, "public/ote-payment-helper.zip"), archive);
console.log("Payment helper built from extensions/vancity-payment-helper");
