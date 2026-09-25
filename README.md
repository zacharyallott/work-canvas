# work-canvas

Immersive WebGL work header for zacharyallott.com. It's a standalone ES module (Three.js and GSAP bundled) that mounts into a `<div>` on a Webflow page and reads its content from the page's **Projects** Collection List, so the Webflow CMS stays the source of truth. The first two images of each project become tiles.

It has three interaction versions. Each visit opens on the next one (the last version seen is remembered per browser), leaving a project view comes back to the next one, and clicking the star in the top-left moves on to the next (hovering it turns it 60°):

| Key | Version | Motion | Figma frame |
| --- | --- | --- | --- |
| `a` | Filmstrip: one infinite row, bottom-aligned skyline | Cursor steers the drift: left of centre drifts right, right drifts left, faster toward the edges. Scrolling moves the strip along (down = forward), eased | Frame 46 · `1542:5556` |
| `b` | Deck: a pile of four cards that cycles through the whole collection | Pile trails the cursor with a little lag and fans out (parallax) the further the cursor gets from the centre; a new card fades in on top every 2 s, and more as the cursor moves; hovering pauses and brings a card to the front | Frame 48 · `1542:5581` |
| `c` | Masonry: columns drifting in alternating directions | Columns drift on their own and slow on hover; the grid shifts left or right with the cursor; scrolling moves the columns, eased | Frame 45 · `1542:5489` |

Hovering a case-study tile brings in its project title and ↓; tiles without a project view show nothing on hover. Clicking a case-study tile opens its project view (Figma frame 50 · `1553:6590`): the tile glides to the top of the page, the title, description and services sit bottom-left, and the project's images follow on the right. The scroll stops on the last image; scrolling on (after a short pause) pulls against resistance and fades back to the work, and letting go early settles back. The tagline opens the about section (Figma frame 49 · `1542:5601`) at its own address, `/about`. On touch, tapping a case-study tile shows its title briefly.

## Quick start

```bash
npm install
npm run media      # process originals → public/media + media.json (first run only)
npm run dev        # http://localhost:5173  (?v=a|b|c picks a version)
```

`index.html` is a local mock of the Webflow page. A small Vite plugin fills it with the same `.work-item` markup the Projects Collection List renders, built from `public/media/media.json`.

## Project layout

```
src/
  main.js              auto-mount + version registry (window.WorkCanvas.mount)
  core/
    engine.js          renderer, pixel-space camera, loop, resize, visibility, picking, open transition, teardown
    media.js           texture loading/upgrades, <video> pool + concurrency cap
    tile.js            one plane on screen (rect + look → mesh/uniforms, media requests)
    layout.js          base class for versions (enter/leave, caption, focus helpers)
    shaders.js         cover-fit, rounded corners (no warp/distortion)
    input.js           cursor, touch drag, wheel, page scroll, tap
    ui.js              top bar (star = next version), hover caption, about section, fallback grid
    about.js           about copy: statement, client columns, links
    project.js         project view (DOM page) + end-of-page pull
    seo.js             crawlable project links + JSON-LD
    embed.js           YouTube/Vimeo links → embedded players
    spring.js          eased scroll (critically damped spring)
    motion.js          shared eases (every animation uses these)
    sizing.js          size scale shared by the filmstrip and deck
    data.js            reads .work-item elements (CMS list) from the DOM
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

Each version has an exported `config` at the top of its file. Shared values (corner radius, DPR cap, texture size cap, image upgrade thresholds) live in `src/core/defaults.js`. Save and the dev server hot-reloads.

The most useful settings:

- **Filmstrip:** `maxSpeed` (px/s at the edges), `deadZone`, `curve` (how quickly speed builds toward the edges), `response` (lag), `idleSpeed` (drift with no cursor), `hoverSlowdown`.
- **Deck:** `follow` (how far the pile leans toward the cursor), `followRates` (lag per position), `depth` (parallax per position), `fan` (spread toward the edges), `interval` (seconds before a card comes in on its own), `moveStep` (cursor travel per extra card), `dealDuration`, `heights` (size scale), `slots` (pile shape), `pauseOnHover`, `hoverToFront`.
- **Masonry:** `autoplaySpeed`, `hoverSlowdown`, `columnSpeeds`, `shift.max` (how far the grid moves with the cursor), `shift.response` (lag), `shift.mode` (`offset` leans, `drift` keeps travelling like the filmstrip).
- **Project view:** `PROJECT_CONFIG` in `src/core/project.js`: `pullDistance` (how far you scroll past the end to go back to the work), `gatePause` (the pause needed before a pull starts, so a fling stops at the end), `lift`, `fadeFrom`, `settle`.
- **All:** `maxVideos`, `captionInset`, `enterDuration` / `leaveDuration` / `stagger` (switching versions: tiles dissolve in, nothing slides). Tiles are never warped, distorted or zoomed on hover.

Motion follows one vocabulary (`src/core/motion.js`): things that travel accelerate hard and settle slowly (`wc-move`), things that answer the cursor start fast (`wc-out`), and opacity changes are short plain dissolves with no drift attached.

## Adding or updating media

1. Drop files into the showcase folder:
   `~/Library/CloudStorage/Dropbox/02 toolkit/02 Portfolio/_Portfolio/2026_SiteCompilation/01_Showcase`
   Name them `Client-Allott-NN.ext` so the label can be derived from the prefix.
2. If it's a new client, add a line to `media/projects.json` (`match` regex → `label` + `href`).
3. Run `npm run media`. It's incremental: unchanged files (same SHA-256) are skipped.
4. Check `http://localhost:5173`, then release (below) and add or update the project in the Webflow CMS: upload the `-lg.webp` (or `-poster.webp` for a video) to Image 1/2, and paste the release's MP4 URL into "Image N video".

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

https://cdn.jsdelivr.net/gh/zacharyallott/work-canvas@v0.2.0/dist/work-canvas.js
https://cdn.jsdelivr.net/gh/zacharyallott/work-canvas@v0.2.0/public/media/boa-allott-11.mp4
```

`@main` or `@latest` also work but are cached for up to 7 days (purge with `https://purge.jsdelivr.net/gh/zacharyallott/work-canvas@main/dist/work-canvas.js`). Pin a tag in production.

Hosting media from the repo on jsDelivr is fine for this set (about 22 MB). jsDelivr caps individual files and total package size for GitHub repos, so if the library grows a lot, move media to the Webflow CMS or a bucket (R2/S3). Only the `data-*` URLs change. The Webflow CDN and jsDelivr both send `Access-Control-Allow-Origin: *`, which WebGL textures need.

## Webflow setup

### 1. CMS: the Projects collection

Collection **Projects** (URL slug `work`):

| Field | Type | Used by the header |
| --- | --- | --- |
| Project title | Plain text (built-in Name) | hover caption |
| Slug | built-in | – |
| Short description | Plain text | project view, meta description, JSON-LD |
| Services | Plain text | project view, JSON-LD keywords |
| Full case study | Switch | hover caption + ↓, click opens the project view, gets a project page |
| Image 1 | Image | tile 1 (poster when Image 1 video is set) |
| Image 1 video | Link | optional MP4 URL; plays in place of Image 1 |
| Image 2 | Image | tile 2 (poster when Image 2 video is set) |
| Image 2 video | Link | optional MP4 URL; plays in place of Image 2 |
| Image 3–13 (+ video) | Image / Link | the project view's gallery (usually the project's folder) |

**Video links:** an "Image N video" field takes either an MP4 URL (a muted loop in place of the image) or a **YouTube / Vimeo link** (an embedded player with sound in the project view). For a YouTube/Vimeo link the slot's image is the thumbnail shown with a play button until pressed (optional: without one, YouTube's own thumbnail is used, and Vimeo shows its player straight away). The player only loads when someone presses play. In Image 1/2 the homepage tile shows the image; the player appears in the project view. Add `#autoplay` to the end of the link (e.g. `https://vimeo.com/123456#autoplay`) to have it play **muted and looping with no controls** instead, like the MP4 loops: it loads as it scrolls into view, fades in over the thumbnail once it's actually playing, and pauses when scrolled away.

Tiles are ordered by the list's sort: every project's Image 1 first, then every project's Image 2, so neighbours come from different projects. The CMS can't host MP4s, so video URLs point at a tagged release on jsDelivr (or any bucket). Run videos through `npm run media` first.

### 2. Markup (on the **Home** page, `/`)

```html
<section class="work-header">                       <!-- font: Cassette 500 -->
  <!-- Code embed: crawlable text behind the canvas (class wc-seo = visually hidden). The about section is built from it. -->
  <div class="wc-seo">
    <h1>Zachary Allott — design &amp; art direction</h1>
    <div data-work-about>
      <p>{statement}</p>
      <ul><li>{client}</li>…</ul> ×4           <!-- one list per column -->
      <nav><a href="mailto:…">email</a> …</nav>
      <p data-about-copyright>© 2026 Zachary Allott</p>
    </div>
  </div>

  <div id="work-canvas" class="work-canvas" data-layout="a"></div>

  <!-- Collection List bound to Projects. Wrapper: class work-list (display:none) + attribute data-work-list -->
  <div class="work-list w-dyn-list" data-work-list>
    <div class="w-dyn-items"><div class="w-dyn-item">
      <div class="work-item">
        <div class="work-title">{Project title}</div>
        <div class="work-description">{Short description}</div>
        <div class="work-services">{Services}</div>
        <div class="work-case-study">Full case study</div>   <!-- visibility bound to Full case study -->
        <img class="work-image-1" src="{Image 1}" srcset="…">
        <div class="work-video-1">{Image 1 video}</div>
        <img class="work-image-2" src="{Image 2}" srcset="…">
        <div class="work-video-2">{Image 2 video}</div>
        <div class="work-slug">{Slug}</div>
        <img class="work-image-3"> <div class="work-video-3"></div> … up to 13
      </div>
    </div></div>
  </div>
</section>
```

- `#work-canvas` needs a height. The class sets `100vh`. The bundle sizes itself to the element, not the window.
- Keep `.work-list` at `display: none`, which also stops the hidden `<img>`s from downloading. The bundle only reads their `src`/`srcset` and uses Webflow's responsive variants as texture levels.
- Empty bindings (Webflow adds `w-dyn-bind-empty`) are skipped. A project with only Image 1 gives one tile.
- For more than 100 projects, add more lists (each with offset/limit). The bundle collects every `.work-item` on the page in document order.
- The older data-attribute formats (`data-image-1`, … or `data-src`, …) still work if you ever need a static list.

Optional mount attributes: `data-project-base="/work/"`, `data-home-path="/"`, `data-about-path="/about"`, `data-layout="a|b|c"`, `data-switcher="false"` (the star only returns home instead of switching versions), `data-rotate="false"` (always open on `data-layout` instead of rotating), `data-max-videos="4"`, `data-per-project="2"`, `data-items=".my-selector"`, `data-tagline="…"`, `data-tagline-href="#work"`, `data-media-base="…"` (base for relative URLs).

### 3. Project pages (the Projects template, `/work/<slug>`)

Every case study also has its own page, so each project can be found and shared on its own. The template holds the same mount plus that project's data, bound to the current item:

```html
<section class="work-header">
  <div id="work-canvas" class="work-canvas" data-project-page="true"></div>
  <div class="wc-seo">                                   <!-- visually hidden, in the HTML for search engines -->
    <div class="work-item">
      <h1 class="work-title">{Project title}</h1>
      <p class="work-description">{Short description}</p>
      <p class="work-services">{Services}</p>
      <div class="work-media">                           <!-- display:none: Slug, case-study marker, Image 1–13, videos -->
        …
      </div>
    </div>
  </div>
</section>
```

On a project page the project view opens straight away; closing it (star, Esc, the pull at the end) goes to `/`. Clicking a project on the homepage opens it in place and changes the address to `/work/<slug>` with the project's title, so Back returns to the work and the address can be shared. Pieces without a case study have template pages too; those redirect to `/`.

Set in the Designer (the API can't bind these): template **Page settings → SEO title** `{Project title} — zachary allott`, **Meta description** `{Short description}`, **Open Graph image** `{Image 1}`.

### 4. About page (`/about`)

A copy of Home (same header, same Collection List) with its own SEO title, description, `AboutPage` JSON-LD and an h1 of "About Zachary Allott" in the `wc-seo` embed. Loading `/about` opens the header straight into the about section; closing it shows the work and moves the address to `/`. On the homepage the tagline links to `/about` and opening it moves the address there, so Back closes it. Keep the about copy in the two embeds (Home and About) in sync.

### 5. SEO

- Homepage HTML: the `wc-seo` embed (h1, about statement, clients, links). JSON-LD `Person` + `WebSite` in the Home page settings.
- The bundle adds a visually hidden list of links to every case-study page (tabbing to one shows its caption on the canvas; Enter opens it) and JSON-LD: an `ItemList` of the case studies on the homepage, a `CreativeWork` on each project page.
- Old `/projects/<slug>` pages are retired: add 301 redirects to `/work/<slug>` (case studies) or `/` (the rest), and `/info` → `/about`, in Site settings → Publishing.

### 6. Embed code

Page settings → Custom code → Before `</body>` tag, on Home, About and the Projects template:

```html
<script type="module" src="https://cdn.jsdelivr.net/gh/zacharyallott/work-canvas@v0.3.13/dist/work-canvas.js"></script>
```

When you release, bump the version on all three, and `data-media-base` on each `#work-canvas`.

## Behaviour notes

- **Loading:** the header fades in once most thumbnails are on the GPU. If WebGL isn't available, a static poster grid shows instead. Aspect ratios are read from each image's header bytes, so layout doesn't wait for full downloads.
- **Images:** the smallest variant loads first, then larger ones when a tile is drawn large or hovered. Anything bigger than `maxTextureEdge` (1280px, 1024px on mobile) is downscaled before it reaches the GPU, so large CMS uploads are safe. Big textures not used for 8 s are released.
- **Video:** a poster first. The `<video>` loads only when its tile is on screen, and only the top-N by priority play (hovered, then nearest the centre). Off-screen videos pause. On touch devices and with `prefers-reduced-motion`, only the tile nearest the centre plays.
- **Scrolling:** the wheel / trackpad over the header drives the layouts (the page is just the header, so nothing else scrolls; `data-wheel="page"` hands vertical wheel back to the page). Filmstrip and masonry follow scroll through a critically damped spring (`src/core/spring.js`, `scroll.omega` / `scroll.multiplier` in each config) so each scroll eases in and out; the deck deals a card per `scrollStep` px, no faster than one per `scrollGap` s. On touch a swipe in any direction does the same (the canvas has `touch-action: none`). Pinch-zoom is left alone.
- **Responsive:** the header fills the visible screen (`100svh`, so phone browser toolbars don't cover the bottom row). Touch devices (no hover) get tap/drag instead of cursor steering; a narrow desktop window keeps the cursor. Phones: filmstrip tiles up to full width, bigger deck cards, masonry ~2 columns, the about section stacks clients two per row and scrolls if a short (landscape) screen can't fit it, the project view is one column. The project view's info column and gap shrink between phone and desktop.
- **Reduced motion:** no idle drift or stacking, no staggers, and transitions become fades. Cursor-driven motion still works.
- **Pausing:** rendering stops when the header scrolls out of view or the tab is hidden. `destroy()` releases everything (GL context, textures, videos, listeners).
- **Click:** a case-study tile opens its project view (tile glides into place); other tiles do nothing.
- **Performance:** DPR is capped at 2, textures upload at most two per frame, and one shared geometry is used. The bundle is about 186 KB gzipped (Three.js is most of it).

## Manual API

```js
const { mount } = await import('https://cdn.jsdelivr.net/gh/zacharyallott/work-canvas@v0.1.0/dist/work-canvas.js');
const wc = await mount(document.querySelector('#work-canvas'), { layout: 'b', config: { b: { autoplay: 5 } } });
wc.setLayout('c');
wc.destroy();
```
