#!/usr/bin/env node
// Build the headless DesignCraft engine into public/designcraft/headless/.
//
//   node packages/designcraft-headless/build.mjs            # cargo + wasm-bindgen + gzip
//   node packages/designcraft-headless/build.mjs --verify   # check the committed files only
//
// Needs Rust ≥ 1.95 with the wasm32-unknown-unknown target and
// wasm-bindgen-cli 0.2.129 (`cargo install wasm-bindgen-cli --version 0.2.129`).
// Regular OTEManager builds use the committed output and need no Rust.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../public/designcraft/headless');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const UPSTREAM = { repository: 'https://github.com/storytold/designcraft', tag: 'v0.9.0', rev: '7cb8b12507def48fb9346e5004340b5e8e4cfcb7' };

function verify() {
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  const gz = readFileSync(join(out, manifest.wasm.file));
  if (sha256(gz) !== manifest.wasm.compressedSha256) throw new Error('Compressed module checksum mismatch');
  const wasm = gunzipSync(gz);
  if (wasm.length !== manifest.wasm.bytes || sha256(wasm) !== manifest.wasm.sha256) throw new Error('Module checksum mismatch');
  if (sha256(readFileSync(join(out, manifest.glue.file))) !== manifest.glue.sha256) throw new Error('Glue checksum mismatch');
  console.log(`verified ${manifest.wasm.file}: ${manifest.wasm.bytes} bytes, sha256 ${manifest.wasm.sha256}`);
}

if (process.argv.includes('--verify')) {
  verify();
  process.exit(0);
}

const target = process.env.CARGO_TARGET_DIR ?? join(tmpdir(), 'ote-designcraft-headless-target');
execFileSync('cargo', ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown'], { cwd: here, stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: target } });
const staging = join(target, 'bindgen');
mkdirSync(staging, { recursive: true });
execFileSync('wasm-bindgen', ['--target', 'web', '--out-dir', staging, '--out-name', 'designcraft_headless', join(target, 'wasm32-unknown-unknown/release/ote_designcraft_headless.wasm')], { stdio: 'inherit' });
mkdirSync(out, { recursive: true });
const wasm = readFileSync(join(staging, 'designcraft_headless_bg.wasm'));
const gz = gzipSync(wasm, { level: 9 });
const glue = readFileSync(join(staging, 'designcraft_headless.js'));
writeFileSync(join(out, 'designcraft_headless_bg.wasm.gz'), gz);
writeFileSync(join(out, 'designcraft_headless.js'), glue);
writeFileSync(join(out, 'designcraft_headless.d.ts'), readFileSync(join(staging, 'designcraft_headless.d.ts')));
const rustc = execFileSync('rustc', ['--version'], { encoding: 'utf8' }).trim();
const bindgen = execFileSync('wasm-bindgen', ['--version'], { encoding: 'utf8' }).trim();
writeFileSync(join(out, 'manifest.json'), JSON.stringify({
  engine: 'DesignCraft (headless, no UI)', upstream: UPSTREAM, crate: 'packages/designcraft-headless',
  toolchain: { rustc, wasmBindgen: bindgen, target: 'wasm32-unknown-unknown', profile: 'release (lto, codegen-units=1)' },
  wasm: { file: 'designcraft_headless_bg.wasm.gz', compression: 'gzip', bytes: wasm.length, sha256: sha256(wasm), compressedBytes: gz.length, compressedSha256: sha256(gz) },
  glue: { file: 'designcraft_headless.js', sha256: sha256(glue) },
  licence: 'MIT OR Apache-2.0 (upstream DesignCraft); see LICENSE-MIT and LICENSE-APACHE',
}, null, 2) + '\n');
verify();
