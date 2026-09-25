#!/usr/bin/env node
/**
 * Media pipeline
 * --------------
 * Reads the original showcase folder (READ-ONLY — originals are never written,
 * moved or renamed), and writes web-ready derivatives into ./public/media plus a
 * manifest at ./public/media/media.json.
 *
 *   Stills  → WebP at 3 sizes (sm thumbnail, md, lg), EXIF-rotated.
 *   Videos  → muted, trimmed, looping H.264 MP4 (≤1080px long edge, faststart)
 *             + optional AV1 WebM + WebP poster frame.
 *
 * Usage:
 *   npm run media                 # incremental (skips unchanged sources)
 *   npm run media -- --force      # rebuild everything
 *   npm run media -- --src "/path/to/folder"
 *   npm run media -- --no-webm    # skip the AV1 WebM pass
 *   npm run media -- --only BOA   # only files whose name contains "BOA"
 *
 * Requires ffmpeg/ffprobe on PATH (brew install ffmpeg) and `sharp` (devDependency).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// ─── Config ──────────────────────────────────────────────────────────────────
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public/media');
const MANIFEST = path.join(OUT_DIR, 'media.json');
const CACHE = path.join(ROOT, 'media/.cache.json'); // source hash → outputs, for incremental runs
const PROJECTS = path.join(ROOT, 'media/projects.json');

const DEFAULT_SRC_CANDIDATES = [
  '~/Library/CloudStorage/Dropbox/02 toolkit/02 Portfolio/_Portfolio/2026_SiteCompilation/01_Showcase',
  '~/Dropbox/02 toolkit/02 Portfolio/_Portfolio/2026_SiteCompilation/01_Showcase',
];

const CONFIG = {
  image: {
    // Long-edge sizes. `sm` loads first; `md`/`lg` are upgrades for focused tiles.
    sizes: { sm: 480, md: 1280, lg: 2048 },
    quality: { sm: 72, md: 80, lg: 82 },
  },
  video: {
    maxLongEdge: 1080,   // px
    maxSeconds: 12,      // default trim length for loops
    crf: 24,             // H.264 quality (lower = better/larger)
    maxrate: '3M',       // caps bitrate so 12s ≈ ≤4.5 MB
    bufsize: '6M',
    preset: 'slow',
    fps: 30,             // clamp (keeps 24/25 as-is)
    webm: true,          // AV1 WebM (SVT-AV1). Set false or pass --no-webm to skip.
    av1Crf: 38,
    posterAt: 0.35,      // seconds into the (trimmed) clip
    posterQuality: 78,
  },
  extensions: {
    image: ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff'],
    video: ['.mp4', '.mov', '.m4v', '.webm'],
  },
};

// ─── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const FORCE = flag('force');
if (flag('no-webm')) CONFIG.video.webm = false;
const ONLY = opt('only');

const expand = (p) => p.replace(/^~(?=$|\/)/, os.homedir());

// ─── Helpers ─────────────────────────────────────────────────────────────────
function run(cmd, cmdArgs, { quiet = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => {
      err += d;
      if (!quiet) process.stderr.write(d);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}\n${err.slice(-2000)}`)),
    );
  });
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

/** "Burton-Zebs-Allott-01.jpg" → "burton-zebs-allott-01" */
const slugify = (name) =>
  path
    .parse(name)
    .name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Fallback label: prefix before "Allott", de-dashed. "Cinco-Brand-Site-Allott-10" → "Cinco Brand Site" */
const deriveLabel = (name) =>
  path
    .parse(name)
    .name.split(/[-_]allott/i)[0]
    .replace(/[-_]+/g, ' ')
    .replace(/\s+\d+$/, '')
    .trim();

const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;

async function probeVideo(file) {
  const json = JSON.parse(
    await run('ffprobe', [
      '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file,
    ]),
  );
  const v = json.streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error('no video stream');
  // Honour rotation metadata (phones) so width/height match what's displayed.
  const rot = Math.abs(
    Number(v.tags?.rotate ?? v.side_data_list?.find((s) => s.rotation != null)?.rotation ?? 0),
  );
  const swap = rot === 90 || rot === 270;
  const [n, d] = (v.avg_frame_rate || v.r_frame_rate || '30/1').split('/').map(Number);
  return {
    width: swap ? v.height : v.width,
    height: swap ? v.width : v.height,
    fps: d ? n / d : 30,
    duration: Number(json.format.duration || v.duration || 0),
  };
}

// ─── Processors ──────────────────────────────────────────────────────────────
async function processImage(src, id) {
  const img = sharp(src, { failOn: 'none' }).rotate(); // .rotate() applies EXIF orientation
  const meta = await img.metadata();
  // After EXIF rotation, orientations 5–8 swap axes.
  const swap = meta.orientation >= 5;
  const w = swap ? meta.height : meta.width;
  const h = swap ? meta.width : meta.height;
  const longEdge = Math.max(w, h);

  const variants = {};
  for (const [key, size] of Object.entries(CONFIG.image.sizes)) {
    // Never upscale; still emit every size key so the runtime can rely on them.
    const target = Math.min(size, longEdge);
    const rw = w >= h ? target : Math.round((target * w) / h);
    const rh = w >= h ? Math.round((target * h) / w) : target;
    const file = `${id}-${key}.webp`;
    const info = await sharp(src, { failOn: 'none' })
      .rotate()
      .resize(rw, rh, { fit: 'fill' })
      .webp({ quality: CONFIG.image.quality[key], effort: 5, smartSubsample: true })
      .toFile(path.join(OUT_DIR, file));
    variants[key] = { src: `media/${file}`, width: info.width, height: info.height, bytes: info.size };
  }
  return { type: 'image', width: w, height: h, images: variants, poster: variants.sm };
}

async function processVideo(src, id, trim) {
  const info = await probeVideo(src);
  const V = CONFIG.video;
  // Optional crop "w:h:x:y" (e.g. to remove baked-in letterboxing; find it with ffmpeg cropdetect).
  const crop = trim?.crop?.split(':').map(Number);
  if (crop) [info.width, info.height] = crop;
  const scale = Math.min(1, V.maxLongEdge / Math.max(info.width, info.height));
  const ow = even(info.width * scale);
  const oh = even(info.height * scale);
  const start = trim?.start ?? 0;
  const duration = Math.min(trim?.duration ?? V.maxSeconds, Math.max(0.5, info.duration - start));
  const fps = Math.min(V.fps, Math.round(info.fps) || V.fps);
  const vf = `${crop ? `crop=${trim.crop},` : ''}scale=${ow}:${oh}:flags=lanczos,fps=${fps},format=yuv420p`;

  const mp4 = `${id}.mp4`;
  await run('ffmpeg', [
    '-y', '-v', 'error',
    '-ss', String(start), '-t', String(duration), '-i', src,
    '-an',                                   // muted
    '-vf', vf,
    '-c:v', 'libx264', '-preset', V.preset, '-profile:v', 'high', '-level', '4.0',
    '-crf', String(V.crf), '-maxrate', V.maxrate, '-bufsize', V.bufsize,
    '-g', String(fps * 2), '-movflags', '+faststart',
    path.join(OUT_DIR, mp4),
  ]);

  const sources = [];
  if (V.webm) {
    const webm = `${id}.webm`;
    await run('ffmpeg', [
      '-y', '-v', 'error',
      '-ss', String(start), '-t', String(duration), '-i', src,
      '-an', '-vf', vf,
      '-c:v', 'libsvtav1', '-preset', '8', '-crf', String(V.av1Crf),
      '-g', String(fps * 2), '-svtav1-params', 'tune=0',
      path.join(OUT_DIR, webm),
    ]);
    const { size } = await fs.stat(path.join(OUT_DIR, webm));
    // AV1 first: browsers pick the first <source> they can play.
    sources.push({ src: `media/${webm}`, type: 'video/webm; codecs="av01.0.05M.08"', bytes: size });
  }
  const { size: mp4Size } = await fs.stat(path.join(OUT_DIR, mp4));
  sources.push({ src: `media/${mp4}`, type: 'video/mp4', bytes: mp4Size });

  // Poster: grab a frame from the *trimmed output* so it matches the first loop.
  const posterPng = path.join(OUT_DIR, `${id}-poster.tmp.png`);
  await run('ffmpeg', [
    '-y', '-v', 'error', '-ss', String(Math.min(V.posterAt, duration / 2)),
    '-i', path.join(OUT_DIR, mp4), '-frames:v', '1', posterPng,
  ]);
  const posterFile = `${id}-poster.webp`;
  const pInfo = await sharp(posterPng).webp({ quality: V.posterQuality }).toFile(path.join(OUT_DIR, posterFile));
  await fs.rm(posterPng);

  return {
    type: 'video',
    width: ow,
    height: oh,
    duration: Number(duration.toFixed(2)),
    sourceDuration: Number(info.duration.toFixed(2)),
    poster: { src: `media/${posterFile}`, width: pInfo.width, height: pInfo.height, bytes: pInfo.size },
    sources,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const srcDir = expand(
    opt('src') ?? process.env.MEDIA_SRC ?? DEFAULT_SRC_CANDIDATES.find((p) => existsSync(expand(p))) ?? '',
  );
  if (!srcDir || !existsSync(srcDir)) {
    console.error(`✖ Source folder not found. Tried:\n  ${DEFAULT_SRC_CANDIDATES.join('\n  ')}\nPass --src "<folder>".`);
    process.exit(1);
  }
  await fs.mkdir(OUT_DIR, { recursive: true });

  const projects = JSON.parse(await fs.readFile(PROJECTS, 'utf8'));
  const cache = existsSync(CACHE) ? JSON.parse(await fs.readFile(CACHE, 'utf8')) : {};
  const prev = existsSync(MANIFEST) ? JSON.parse(await fs.readFile(MANIFEST, 'utf8')) : { items: [] };
  const prevById = new Map(prev.items.map((i) => [i.id, i]));

  const entries = (await fs.readdir(srcDir, { withFileTypes: true }))
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  console.log(`Source: ${srcDir}\nFound ${entries.length} files\n`);

  const seenHashes = new Map(); // hash → first filename (duplicate detection)
  const items = [];
  const problems = [];

  for (const name of entries) {
    const ext = path.extname(name).toLowerCase();
    const kind = CONFIG.extensions.image.includes(ext) ? 'image' : CONFIG.extensions.video.includes(ext) ? 'video' : null;
    if (!kind) {
      problems.push(`skipped (unsupported type): ${name}`);
      continue;
    }
    if (ONLY && !name.toLowerCase().includes(ONLY.toLowerCase())) {
      const keep = prevById.get(slugify(name));
      if (keep) items.push(keep);
      continue;
    }

    const src = path.join(srcDir, name);
    let hash;
    try {
      hash = await sha256(src); // also proves the file is readable (Dropbox online-only files fail here)
    } catch (err) {
      problems.push(`✖ could not read ${name} (online-only in Dropbox?): ${err.code || err.message}`);
      continue;
    }
    if (seenHashes.has(hash)) {
      problems.push(`duplicate: ${name} is byte-identical to ${seenHashes.get(hash)} — skipped`);
      continue;
    }
    seenHashes.set(hash, name);

    const id = slugify(name);
    const project = projects.projects.find((p) => new RegExp(p.match, 'i').test(name));
    const base = {
      id,
      label: project?.label ?? deriveLabel(name),
      href: project?.href ?? '',
      source: name,
      sourceHash: hash.slice(0, 16),
    };

    const cached = cache[id];
    if (!FORCE && cached?.hash === hash && prevById.has(id)) {
      items.push({ ...prevById.get(id), label: base.label, href: base.href });
      console.log(`· ${name} (unchanged)`);
      continue;
    }

    const t0 = Date.now();
    try {
      const out = kind === 'image' ? await processImage(src, id) : await processVideo(src, id, projects.video?.[name]);
      const item = { ...base, ...out, aspect: Number((out.width / out.height).toFixed(4)) };
      items.push(item);
      cache[id] = { hash };
      const size = kind === 'video' ? item.sources.map((s) => `${path.extname(s.src)} ${mb(s.bytes)}`).join(', ') : `lg ${mb(item.images.lg.bytes)}`;
      console.log(`✓ ${name} → ${item.width}×${item.height} ${size} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (err) {
      problems.push(`✖ failed ${name}: ${err.message.split('\n')[0]}`);
    }
    // Write progress after every file so an interrupted run still leaves a usable manifest.
    await fs.writeFile(CACHE, JSON.stringify(cache, null, 2));
  }

  const manifest = {
    generated: new Date().toISOString(),
    count: items.length,
    images: items.filter((i) => i.type === 'image').length,
    videos: items.filter((i) => i.type === 'video').length,
    items,
  };
  await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2));

  console.log(`\nWrote ${path.relative(ROOT, MANIFEST)} — ${manifest.images} images, ${manifest.videos} videos`);
  if (problems.length) console.log(`\nNotes:\n  ${problems.join('\n  ')}`);
  if (problems.some((p) => p.startsWith('✖'))) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
