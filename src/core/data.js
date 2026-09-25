/**
 * Reads work items from the DOM. In production they come from a (visually
 * hidden) Webflow Collection List bound to the "Projects" collection; locally,
 * index.html mimics the same markup.
 *
 * One element per project (CMS format). The first `perProject` media slots
 * (default 2) become tiles. Webflow can only bind CMS images to real <img>
 * elements, so each field is a bound child element:
 *
 *   <div class="work-item">
 *     <div class="work-title">BOA Performfit Wrap</div>
 *     <div class="work-description">…</div>
 *     <div class="work-services">…</div>
 *     <div class="work-case-study">Full case study</div>   visible only when the switch is on
 *     <img class="work-image-1" src srcset>               Image 1 (poster when Video 1 is set)
 *     <div class="work-video-1">https://…/boa-11.mp4</div> optional MP4 URL
 *     <img class="work-image-2" src srcset>
 *     <div class="work-video-2"></div>
 *     <div class="work-slug">boa</div>                     for ?project= links
 *     <img class="work-image-3"> … <img class="work-image-13">  project view gallery
 *     <div class="work-video-3"> … (optional MP4 per gallery slot)
 *   </div>
 *
 * The same thing as data attributes (data-title, data-image-1, data-video-1, …)
 * also works, and so does the older one-element-per-media format:
 *   <a class="work-item" href data-type data-src data-src-webm data-srcset data-poster data-title data-aspect>
 *
 * Tiles are ordered slot by slot — every project's first piece, then every
 * project's second — so the same project rarely sits next to itself.
 */

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

/** Parse "url 480w, url 1280w" → [{ src, width }] sorted small → large. */
function parseSrcset(value, resolve) {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim().split(/\s+/))
    .filter(([url]) => url)
    .map(([url, descriptor = '']) => ({ src: resolve(url), width: parseInt(descriptor, 10) || 0 }))
    .sort((a, b) => a.width - b.width);
}

/** Picks ~500w / ~1080w / largest from a srcset as the sm / md / lg texture levels. */
function srcsetLevels(list) {
  if (list.length < 2) return [];
  const near = (w) => list.reduce((a, b) => (Math.abs(b.width - w) < Math.abs(a.width - w) ? b : a));
  const levels = [near(500), near(1080), list[list.length - 1]];
  return levels.filter((l, i) => i === 0 || l.src !== levels[i - 1].src);
}

/** A single image URL becomes two texture levels: a fast small one, then the full one (both downscaled on the GPU side). */
const singleImageLevels = (src) => [
  { src, maxEdge: 512 },
  { src, maxEdge: 0 }, // 0 = global maxTextureEdge
];

const bool = (v) => /^(true|1|yes|on)$/i.test(String(v ?? '').trim());
const GALLERY_MAX = 20; // highest Image N slot read for the project view

export function readItems(mount) {
  const selector = mount.dataset.items || '.work-item';
  const base = mount.dataset.mediaBase || document.baseURI;
  const perProject = parseInt(mount.dataset.perProject, 10) || 2;
  const resolve = (url) => (url && url.trim() ? new URL(url.trim(), base).href : '');

  const slots = []; // slots[n] = media from slot n of every project, in document order

  document.querySelectorAll(selector).forEach((el, projectIndex) => {
    const d = el.dataset;
    const child = (cls) => {
      const c = el.querySelector(`.${cls}`);
      // Webflow marks unbound/empty CMS bindings and conditionally hidden elements with these classes.
      return c && !c.classList.contains('w-dyn-bind-empty') && !c.classList.contains('w-condition-invisible') ? c : null;
    };
    const text = (cls) => child(cls)?.textContent.trim() || '';
    const project = {
      projectIndex,
      slug: d.slug || text('work-slug'),
      title: d.title || text('work-title') || (el.querySelector('.work-title') ? '' : el.textContent.trim()),
      caseStudy: el.querySelector('.work-case-study') ? Boolean(child('work-case-study')) : bool(d.caseStudy),
      description: d.description || text('work-description'),
      services: d.services || text('work-services'),
      href: d.href ? resolve(d.href) : el.getAttribute('href') && el.getAttribute('href') !== '#' ? el.href : '',
      el,
    };

    // Numbered attributes (data-image-1) aren't camel-cased by `dataset`, so read them directly.
    const attr = (name) => el.getAttribute(`data-${name}`) || '';
    const imgOf = (n) => {
      const img = child(`work-image-${n}`);
      const src = img?.getAttribute('src') || '';
      return img && src && !/placeholder\./.test(src) ? img : null;
    };
    const isCms = attr('image-1') || attr('video-1') || el.querySelector('[class*="work-image-"], [class*="work-video-"]');
    if (isCms) {
      // Project view gallery: every slot after the showcase ones (Image 3 onward).
      project.gallery = [];
      for (let n = perProject + 1; n <= GALLERY_MAX; n++) {
        const img = imgOf(n);
        const image = resolve(attr(`image-${n}`) || img?.getAttribute('src'));
        const video = resolve(attr(`video-${n}`) || text(`work-video-${n}`));
        if (!image && !video) continue;
        project.gallery.push({
          type: video ? 'video' : 'image',
          src: image,
          srcset: img?.getAttribute('srcset') || '',
          video,
          alt: img?.getAttribute('alt') || project.title,
          hash: img?.dataset.hash || '', // content hash (local mock only; on Webflow the asset id does this job)
        });
      }
      const shared = project; // every tile from this project points at the same object
      // CMS format: numbered slots.
      for (let n = 1; n <= perProject; n++) {
        const img = imgOf(n);
        const image = resolve(attr(`image-${n}`) || img?.getAttribute('src'));
        const video = resolve(attr(`video-${n}`) || text(`work-video-${n}`));
        if (!image && !video) continue;
        // Webflow's responsive variants (…-p-500, -p-1080, …) become the texture levels when present.
        const levels = img ? srcsetLevels(parseSrcset(img.getAttribute('srcset'), resolve)) : [];
        const media = video
          ? { type: 'video', poster: levels[0]?.src || image, images: [], sources: videoSources(video, resolve(attr(`video-${n}-webm`))) }
          : { type: 'image', poster: levels[0]?.src || image, images: levels.length ? levels : singleImageLevels(image), sources: [] };
        (slots[n - 1] ||= []).push({ ...project, ...media, project: shared, slot: n, hash: img?.dataset.hash || '', aspect: parseFloat(attr(`aspect-${n}`)) || 0 });
      }
      return;
    }

    // Legacy format: one element = one piece of media.
    const src = resolve(d.src);
    if (!src && !d.poster && !d.srcset) return;
    const declared = (d.type || '').trim().toLowerCase(); // CMS Option fields render "Video"
    const type = declared === 'video' || declared === 'image' ? declared : VIDEO_EXT.test(src) ? 'video' : 'image';
    let images = parseSrcset(d.srcset, resolve);
    const poster = resolve(d.poster) || images[0]?.src || (type === 'image' ? src : '');
    if (type === 'image' && !images.length && src) images = singleImageLevels(src);
    const aspect =
      parseFloat(d.aspect) || (parseFloat(d.width) && parseFloat(d.height) ? parseFloat(d.width) / parseFloat(d.height) : 0);
    (slots[0] ||= []).push({
      ...project,
      type,
      poster,
      images,
      sources: type === 'video' ? videoSources(src, resolve(d.srcWebm)) : [],
      slot: 1,
      aspect,
    });
  });

  return slots.flat().map((m, index) => ({ ...m, index, id: `item-${index}` }));
}

function videoSources(mp4, webm) {
  const sources = [];
  if (webm) sources.push({ src: webm, type: 'video/webm; codecs="av01.0.05M.08"' });
  if (mp4) sources.push({ src: mp4, type: 'video/mp4' });
  return sources;
}

/**
 * Fills in missing aspect ratios. Layouts need them up front, but we don't
 * wait for whole downloads: an <img>'s naturalWidth is known as soon as the
 * header bytes arrive, so we poll for it. Videos without a poster read their
 * metadata instead.
 */
export async function ensureAspects(items, timeout = 8000) {
  const missing = items.filter((i) => !i.aspect);
  await Promise.all(missing.map((item) => measure(item, timeout).then((a) => (item.aspect = a || 1.5))));
}

function measure(item, timeout) {
  return new Promise((resolve) => {
    const done = (a) => {
      clearInterval(poll);
      clearTimeout(timer);
      resolve(a);
    };
    const timer = setTimeout(() => done(0), timeout);
    let poll;
    if (item.poster) {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // same cache entry the texture loader will use
      img.onload = () => done(img.naturalWidth / img.naturalHeight);
      img.onerror = () => done(0);
      img.src = item.poster;
      poll = setInterval(() => img.naturalWidth && done(img.naturalWidth / img.naturalHeight), 25);
    } else if (item.sources.length) {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'metadata';
      v.onloadedmetadata = () => done(v.videoWidth / v.videoHeight);
      v.onerror = () => done(0);
      v.src = item.sources[item.sources.length - 1].src;
    } else {
      done(0);
    }
  });
}
