#!/usr/bin/env node
/**
 * The files the live site loads from jsDelivr, as one small commit on the `cdn` branch
 * ------------------------------------------------------------------------------------
 * jsDelivr serves a GitHub repo only up to 50 MB per version, and this repo (with all its media) is well past
 * that: files under a version can be refused ("Package size exceeded the configured limit of 50 MB"). So each
 * release also commits just what the site needs at runtime — the bundle, the 480 / 1280 px copies of the CMS
 * images (media/webflow-assets.json) and the about-only pieces — to the `cdn` branch, a tree of ~12 MB with the
 * same paths as main (dist/…, public/media/…), and the Webflow pages load everything by that commit's full hash.
 * (CMS videos keep their own links to main.)
 *
 *   node scripts/publish-cdn.mjs     # after `npm run build`; prints the commit; push with `git push origin cdn`
 *
 * Built with git plumbing in a throwaway index, so the working tree and main are untouched.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_MB = 45; // stay clear of jsDelivr's 50 MB
const index = path.join(os.tmpdir(), `work-canvas-cdn-index-${process.pid}`);
const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: ROOT, env: { ...process.env, GIT_INDEX_FILE: index }, ...opts }).toString().trim();

const files = ['dist/work-canvas.js'];
const { assets } = JSON.parse(readFileSync(path.join(ROOT, 'media/webflow-assets.json'), 'utf8'));
for (const [prefix] of Object.values(assets)) files.push(`public/${prefix}-sm.webp`, `public/${prefix}-md.webp`);
const about = path.join(ROOT, 'public/media/about');
if (existsSync(about)) for (const f of readdirSync(about)) if (!f.startsWith('.')) files.push(`public/media/about/${f}`);

const unique = [...new Set(files)];
const missing = unique.filter((f) => !existsSync(path.join(ROOT, f)));
if (missing.length) {
  console.error(`✖ missing:\n  ${missing.join('\n  ')}\nRun the build and npm run media:map first.`);
  process.exit(1);
}
const mb = unique.reduce((a, f) => a + statSync(path.join(ROOT, f)).size, 0) / 1048576;
if (mb > MAX_MB) {
  console.error(`✖ ${mb.toFixed(1)} MB — over the ${MAX_MB} MB budget for one jsDelivr version.`);
  process.exit(1);
}

try {
  git(['read-tree', '--empty']);
  for (const f of unique) {
    const blob = git(['hash-object', '-w', f]);
    git(['update-index', '--add', '--cacheinfo', `100644,${blob},${f}`]);
  }
  const tree = git(['write-tree']);
  let parent = '';
  try {
    parent = git(['rev-parse', '--verify', '-q', 'refs/heads/cdn']);
  } catch {}
  const same = parent && git(['rev-parse', `${parent}^{tree}`]) === tree;
  const commit = same
    ? parent
    : git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `cdn: runtime files for ${git(['rev-parse', '--short', 'HEAD'])}`]);
  if (!same) git(['update-ref', 'refs/heads/cdn', commit]);
  console.log(`cdn ${commit} — ${unique.length} files, ${mb.toFixed(1)} MB${same ? ' (unchanged)' : ''}`);
} finally {
  rmSync(index, { force: true });
}
