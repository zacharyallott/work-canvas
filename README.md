# work-canvas

Immersive WebGL work header for zacharyallott.com. It's a standalone ES module (Three.js and GSAP bundled) that mounts into a `<div>` on a Webflow page and reads its content from links on that page, so Webflow (CMS or static links) stays the source of truth.

It has three interaction versions, switchable at runtime with the dots in the top bar:

| Key | Version | Figma frame |
| --- | --- | --- |
| `a` | Filmstrip: one infinite row, bottom-aligned skyline | Frame 46 · `1542:5556` |
| `b` | Deck: a pile of four cards that cycles through the whole collection | Frame 48 · `1542:5581` |
| `c` | Masonry: seven infinite columns drifting in alternating directions | Frame 45 · `1542:5489` |

## Quick start

```bash
npm install
npm run media      # process originals → public/media + media.json (first run only)
npm run dev        # http://localhost:5173  (?v=a|b|c picks a version)
```

`index.html` is a local mock of the Webflow page. A small Vite plugin fills it with the same `.work-item` markup a Collection List would render, built from `public/media/media.json`.

## Project layout

```
src/
  main.js              auto-mount + version registry (window.WorkCanvas.mount)
  core/
    engine.js          renderer, pixel-space camera, loop, resize, visibility, picking, open transition, teardown
    media.js           texture loading/upgrades, <video> pool + concurrency cap
    tile.js            one plane on screen (rect + look → mesh/uniforms, media requests)
    layout.js          base class for versions (enter/leave, caption, focus helpers)
    shaders.js         cover-fit, rounded corners, hover lens, RGB split, bend, reveal
    input.js           drag/inertia, wheel, page scroll, tap
    ui.js              top bar, dots, caption, fallback grid, hidden link list
    data.js            reads .work-item links from the DOM
    defaults.js        shared defaults (radius, colours, video cap, DPR cap…)
  layouts/
    filmstrip.js       version A   ← config object at the top of each file
    deck.js            version B
    masonry.js         version C
scripts/
  build-media.mjs      ffmpeg + sharp pipeline
  release.mjs          build + tag for jsDelivr
media/projects.json    filename → label / project URL / per-video trim + crop
public/media/          processed output (served by jsDelivr in production)
dist/work-canvas.js    the bundle Webflow loads (committed on release)
```

## Tuning the feel

Each version has an exported `config` at the top of its file (speed, inertia, spacing, hover distortion, easing, max videos, caption inset). Shared values (corner radius, DPR cap, image upgrade thresholds, `wheel` mode) live in `src/core/defaults.js`. Save and the dev server hot-reloads.

The most useful settings:

- `autoplaySpeed`, `inertia`, `ease`, `dragMultiplier`, `scrollMultiplier`: the drift and glide.
- `hover.distortion`, `hover.zoom`: strength of the lens on hover.
- `bend`, `rgbShift` (filmstrip): velocity effects.
- `autoplay`, `duration`, `flingDistance`, `slots` (deck): cycling rhythm and pile shape.
- `columnSpeeds`, `featureInterval`, `dimOthers` (masonry).
- `maxVideos`: how many videos may play at once.
- `wheel` (`defaults.js` or `data-wheel` on the mount): `page` lets vertical wheel scroll the page (the header reacts to page scroll). `capture` makes the header consume the wheel.

## Adding or updating media

1. Drop files into the showcase folder:
   `~/Library/CloudStorage/Dropbox/02 toolkit/02 Portfolio/_Portfolio/2026_SiteCompilation/01_Showcase`
   Name them `Client-Allott-NN.ext` so the label can be derived from the prefix.
2. If it's a new client, add a line to `media/projects.json` (`match` regex → `label` + `href`).
3. Run `npm run media`. It's incremental: unchanged files (same SHA-256) are skipped.
4. Check `http://localhost:5173`, then release (below) and add or update the item in Webflow.

The originals are only ever read. Output goes to `public/media/`.

## Media pipeline

`npm run media` (`scripts/build-media.mjs`, needs `ffmpeg` on PATH):

| Input | Output |
| --- | --- |
| Stills (jpg/png/webp/tif) | `<id>-sm.webp` (480px long edge), `-md` (1280), `-lg` (2048), EXIF-rotated, never upscaled |
| Videos (mp4/mov/webm) | `<id>.mp4` H.264 High, muted, ≤1080px long edge, first 12 s, CRF 24 capped at 3 Mbps, faststart · `<id>.webm` AV1 (SVT-AV1) · `<id>-poster.webp` |

Flags: `--force` rebuilds everything, `--only BOA` rebuilds matching files, `--no-webm` skips AV1, `--src "<folder>"` uses a different source folder.

Per-video overrides live in `media/projects.json → video`: `start`, `duration`, and `crop` (`"w:h:x:y"`). To find letterboxing, run `ffmpeg -i file.mp4 -vf cropdetect -f null -`.

Byte-identical duplicates are skipped and reported. Unreadable files, such as Dropbox online-only placeholders, are reported with `✖` and the script exits non-zero. They're never skipped silently.

`public/media/media.json` records each item's `id, label, href, type, width, height, aspect, poster, sources | images, source, sourceHash`.

## Build and release

```bash
npm run release -- 0.2.0     # sets version, builds dist/, commits, tags v0.2.0 (does not push)
git push && git push origin v0.2.0
```

Tags are immutable on jsDelivr, so every change ships as a new version number.

### jsDelivr URL format

```
https://cdn.jsdelivr.net/gh/<user>/<repo>@<tag>/<path>

https://cdn.jsdelivr.net/gh/zachallott/work-canvas@v0.2.0/dist/work-canvas.js
https://cdn.jsdelivr.net/gh/zachallott/work-canvas@v0.2.0/public/media/boa-allott-11.mp4
```

`@main` or `@latest` also work but are cached for up to 7 days (purge with `https://purge.jsdelivr.net/gh/zachallott/work-canvas@main/dist/work-canvas.js`). Pin a tag in production.

Hosting media from the repo on jsDelivr is fine for this set (about 22 MB). jsDelivr caps individual files and total package size for GitHub repos, so if the library grows a lot, move media to the Webflow CMS or a bucket (R2/S3). Only the `data-*` URLs change. The Webflow CDN and jsDelivr both send `Access-Control-Allow-Origin: *`, which WebGL textures need.

## Webflow setup

### 1. Markup

The draft page **Home 2026** (`/home-2026`) already has this structure:

```html
<section class="work-header">
  <div id="work-canvas" class="work-canvas"
       data-layout="a"
       data-media-base="https://cdn.jsdelivr.net/gh/zachallott/work-canvas@v0.1.0/public/"></div>

  <!-- Collection List Wrapper (or a plain div): add the attribute data-work-list -->
  <div class="work-list" data-work-list>
    <a class="work-item" href="/projects/boa"
       data-type="video"
       data-src="media/boa-allott-11.mp4"
       data-src-webm="media/boa-allott-11.webm"
       data-poster="media/boa-allott-11-poster.webp"
       data-title="BOA Performfit Wrap"
       data-aspect="1.7763">BOA Performfit Wrap</a>
    <!-- …one link per item; any number of items and lists -->
  </div>
</section>
```

- `#work-canvas` needs a height. The class sets `100vh`. The bundle sizes itself to the element, not the window.
- Relative `data-*` URLs resolve against `data-media-base`. Absolute URLs (CMS/Webflow assets) are used as-is.
- The bundle visually hides `[data-work-list]` but keeps the links in the DOM for SEO, keyboard and screen-reader users. Tabbing through them moves the canvas to the focused piece.
- Items with `href="#"` (Burton, SRAM, Tinkercad for now) render but don't navigate.

Optional mount attributes: `data-layout="a|b|c"`, `data-switcher="false"` (hides the dots), `data-wheel="capture"`, `data-max-videos="4"`, `data-items=".my-selector"`, `data-tagline="…"`, `data-tagline-href="#work"`.

### 2. Embed code

Add this to Page settings → Custom code → Before `</body>` tag. It's already on the draft page.

```html
<script type="module" src="https://cdn.jsdelivr.net/gh/zachallott/work-canvas@v0.1.0/dist/work-canvas.js"></script>
```

When you release, bump the version in both this URL and `data-media-base`.

### 3. CMS fields (when you move items into a Collection)

The site has no CMS collections yet, so the draft page uses static links. To make the CMS the source of truth, create a **Work** collection with these fields:

| Field | Type | Binds to |
| --- | --- | --- |
| Name | Plain text (built-in) | `data-title` and link text |
| Slug | built-in | n/a |
| Project URL | Link | link `href` |
| Media type | Option: `Image`, `Video` | `data-type` (case doesn't matter) |
| Image | Image | `data-src` for images (upload the pipeline's `-lg.webp`) |
| Poster / thumbnail | Image | `data-poster`. Required for video, recommended for images (upload `-sm.webp` or the `-poster.webp`) |
| Video MP4 URL | Link (or Plain text) | `data-src` for videos. The CMS can't hold MP4s, so point at jsDelivr or a bucket |
| Video WebM URL | Link, optional | `data-src-webm` |
| Aspect ratio | Number, optional | `data-aspect` (width ÷ height). If missing, the poster is loaded first to measure it |

Then add a Collection List, add `data-work-list` to its wrapper, put a Link Block with class `work-item` inside the item, and bind the custom attributes above. For more than 100 items, add more lists (each with offset/limit). The bundle collects every `.work-item` on the page in document order.

## Behaviour notes

- **Loading:** a static poster grid shows immediately. WebGL fades in once most thumbnails are on the GPU. If WebGL isn't available, the grid stays and is fully clickable.
- **Images:** the thumbnail loads first, then `md`/`lg` when a tile is drawn large or focused. Big textures not used for 8 s are released.
- **Video:** a poster first. The `<video>` loads only when its tile is on screen, and only the top-N by priority play (hovered, then featured, then nearest centre). Off-screen videos pause. On touch devices and with `prefers-reduced-motion`, only the featured tile plays.
- **Reduced motion:** no drift, no auto-advance, no distortion or bend, and transitions become fades.
- **Pausing:** rendering stops when the header scrolls out of view or the tab is hidden. `destroy()` releases everything (GL context, textures, videos, listeners).
- **Click:** the tile expands to fill the header, then navigates. ⌘/Ctrl-click opens a new tab. The back/forward cache restores cleanly.
- **Performance:** DPR is capped at 2, textures upload at most two per frame, and one shared geometry is used. The bundle is about 186 KB gzipped (Three.js is most of it).

## Manual API

```js
const { mount } = await import('https://cdn.jsdelivr.net/gh/zachallott/work-canvas@v0.1.0/dist/work-canvas.js');
const wc = await mount(document.querySelector('#work-canvas'), { layout: 'b', config: { b: { autoplay: 5 } } });
wc.setLayout('c');
wc.destroy();
```
