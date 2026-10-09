#!/usr/bin/env node
/**
 * About-only media: runs build-media.mjs on the files loose in the top level of
 * 2026_SiteCompilation (not in a folder) — pieces for clients that only show
 * when their tag is hovered on the about section, never on the homepage — into
 * public/media/about/, and copies the manifest to media/about-work.json, which
 * the bundle reads (src/core/about.js). Labels come from media/projects.json.
 *
 *   npm run media:about              # incremental
 *   npm run media:about -- --force   # rebuild everything
 *
 * Originals are only read. Release afterwards: the files are served from the
 * release tag (data-media-base).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const passThrough = args.filter((a) => a === '--force' || a === '--no-webm');

const CANDIDATES = [
  '~/Library/CloudStorage/Dropbox/02 toolkit/02 Portfolio/_Portfolio/2026_SiteCompilation',
  '~/Dropbox/02 toolkit/02 Portfolio/_Portfolio/2026_SiteCompilation',
].map((p) => p.replace(/^~/, os.homedir()));
const src = args.includes('--root') ? args[args.indexOf('--root') + 1] : CANDIDATES.find((p) => existsSync(p));
if (!src) {
  console.error('✖ 2026_SiteCompilation not found. Pass --root "<folder>".');
  process.exit(1);
}

const out = 'public/media/about';
const r = spawnSync(
  process.execPath,
  [path.join(ROOT, 'scripts/build-media.mjs'), '--src', src, '--out', out, '--cache', 'media/.cache-about.json', '--prefix', 'media/about/', ...passThrough],
  { stdio: 'inherit', cwd: ROOT },
);
if (r.status !== 0) process.exit(r.status ?? 1);

const { items } = JSON.parse(await fs.readFile(path.join(ROOT, out, 'media.json'), 'utf8'));
await fs.writeFile(path.join(ROOT, 'media/about-work.json'), `${JSON.stringify({ items }, null, 2)}\n`);
console.log(`\nWrote media/about-work.json — ${items.map((i) => `${i.label} (${i.source})`).join(', ')}`);
