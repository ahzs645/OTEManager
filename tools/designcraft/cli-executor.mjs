// Run compiler command steps through the native designcraft-cli (Node only).
// Symbolic files become real paths in a private temporary directory with a
// `Document Fonts` folder, exactly as compile-template.py arranges them.
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function cliExecutor(cli) {
  const { stdout } = await run(cli, ['--version'], { timeout: 10000 });
  return {
    kind: 'cli',
    version: stdout.trim(),
    async run(steps, { doc = null, media = new Map(), fonts = [] } = {}) {
      const dir = await mkdtemp(join(tmpdir(), 'ote-dc-cli-'));
      try {
        await mkdir(join(dir, 'Document Fonts'));
        await mkdir(join(dir, 'Links'));
        await mkdir(join(dir, 'out'));
        for (const font of fonts) await writeFile(join(dir, 'Document Fonts', font.name), font.bytes);
        const docPath = join(dir, 'page.designcraft');
        if (doc) await writeFile(docPath, doc);
        const exports = new Map();
        const mapped = [];
        for (const [index, step] of steps.entries()) {
          const params = { ...step.params };
          const path = typeof params.path === 'string' ? params.path : '';
          if (path === '@doc') params.path = docPath;
          else if (path.startsWith('@media:')) {
            const name = path.slice(7);
            await writeFile(join(dir, 'Links', name), media.get(name));
            params.path = join(dir, 'Links', name);
          } else if (path.startsWith('@out:')) {
            params.path = join(dir, 'out', path.slice(5));
            exports.set(index, path.slice(5));
          }
          mapped.push(step.command + ' ' + JSON.stringify(params));
        }
        const script = join(dir, 'commands.dcs');
        await writeFile(script, mapped.join('\n') + '\n');
        let stdout;
        try {
          ({ stdout } = await run(cli, ['script', script], { timeout: 180000, maxBuffer: 512 * 1024 * 1024 }));
        } catch (error) {
          stdout = error.stdout ?? '';
          if (!stdout) throw new Error('DesignCraft command failed: ' + String(error.stderr || error.message).slice(0, 800));
        }
        const report = JSON.parse(stdout);
        if (report.error) throw new Error('DesignCraft command failed: ' + String(report.error).slice(0, 800));
        const outputs = {};
        for (const name of exports.values()) outputs[name] = new Uint8Array(await readFile(join(dir, 'out', name)));
        const saved = steps.some((s) => s.command === 'file.saveAs' && s.params.path === '@doc') ? new Uint8Array(await readFile(docPath)) : doc;
        return { results: report.results, doc: saved, outputs };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
