#!/usr/bin/env node
/**
 * Project view media: runs build-media.mjs on every case-study folder in
 * 2026_SiteCompilation (mapping in media/projects.json → caseStudies) and
 * writes public/media/projects/index.json:
 *
 *   { "<slug>": { "folder": "02_BOA", "items": [ …media.json items, folder order… ] } }
 *
 *   npm run media:projects                 # incremental
 *   npm run media:projects -- --force      # rebuild everything
 *   npm run media:projects -- --only boa   # one project
 *
 * Originals are only read. These files go into the CMS as Image 3 onward.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const passThrough = args.filter((a, i) => a === '--force' || a === '--no-webm' || args[i - 1] === '--no-webm');

const CANDIDATES = [
  '~/Library/CloudStorage/Dropbox/02 toolkit/02 Portfolio/_Portfolio/2026_SiteCompilation',
  '~/Dropbox/02 toolkit/02 Portfolio/_Portfolio/2026_SiteCompilation',
].map((p) => p.replace(/^~/, os.homedir()));
const base = args.includes('--root') ? args[args.indexOf('--root') + 1] : CANDIDATES.find((p) => existsSync(p));
if (!base) {
  console.error('✖ 2026_SiteCompilation not found. Pass --root "<folder>".');
  process.exit(1);
}

const { caseStudies } = JSON.parse(await fs.readFile(path.join(ROOT, 'media/projects.json'), 'utf8'));
const index = {};
let failed = false;

for (const [folder, slug] of Object.entries(caseStudies)) {
  if (folder.startsWith('_')) continue;
  const out = `public/media/projects/${slug}`;
  const manifest = path.join(ROOT, out, 'media.json');
  if (!only || only === slug) {
    const src = path.join(base, folder);
    if (!existsSync(src)) {
      console.error(`✖ ${folder}: folder not found`);
      failed = true;
      continue;
    }
    console.log(`\n━━ ${folder} → ${slug}`);
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts/build-media.mjs'), '--src', src, '--out', out, '--cache', `media/.cache-projects/${slug}.json`, '--prefix', `media/projects/${slug}/`, ...passThrough],
      { stdio: 'inherit', cwd: ROOT },
    );
    if (r.status !== 0) failed = true;
  }
  if (existsSync(manifest)) {
    const { items } = JSON.parse(await fs.readFile(manifest, 'utf8'));
    index[slug] = { folder, items };
  }
}

await fs.writeFile(path.join(ROOT, 'public/media/projects/index.json'), JSON.stringify(index, null, 2));
console.log(`\nWrote public/media/projects/index.json — ${Object.keys(index).length} projects`);
if (failed) process.exitCode = 1;
