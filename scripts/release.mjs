#!/usr/bin/env node
/**
 * Build + tag a release that jsDelivr can serve.
 *
 *   npm run release -- 0.2.0
 *
 * 1. sets package.json "version"
 * 2. builds dist/work-canvas.js
 * 3. commits dist/ + package.json and creates tag v0.2.0
 *
 * It does NOT push. Push yourself when you're happy:
 *   git push && git push origin v0.2.0
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? '')) {
  console.error('Usage: npm run release -- <semver>   e.g. npm run release -- 0.2.0');
  process.exit(1);
}
const sh = (cmd) => execSync(cmd, { stdio: 'inherit' });
const out = (cmd) => execSync(cmd).toString().trim();

const dirty = out('git status --porcelain').split('\n').filter((l) => l && !/ dist\//.test(l));
if (dirty.length) {
  console.error(`Commit or stash these first:\n${dirty.join('\n')}`);
  process.exit(1);
}
if (out(`git tag -l v${version}`)) {
  console.error(`Tag v${version} already exists. Tags are immutable on jsDelivr — pick a new version.`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = version;
fs.writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

sh('npm run build');
sh('git add package.json dist');
sh(`git commit -m "release v${version}"`);
sh(`git tag v${version}`);

const repo = out('git remote get-url origin 2>/dev/null || echo "github.com/zacharyallott/work-canvas"')
  .replace(/^.*github\.com[:/]/, '')
  .replace(/\.git$/, '');
const base = `https://cdn.jsdelivr.net/gh/${repo}@v${version}`;
console.log(`
Tagged v${version}. Next:
  git push && git push origin v${version}

Webflow (page footer code):
  <script type="module" src="${base}/dist/work-canvas.js"></script>

Mount attribute:
  data-media-base="${base}/public/"
`);
