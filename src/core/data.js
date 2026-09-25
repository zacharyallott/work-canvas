/**
 * Reads work items from the DOM. In production they come from a (visually
 * hidden) Webflow Collection List bound to the "Projects" collection; locally,
 * index.html mimics the same markup.
 *
 * One element per project (CMS format). The first `perProject` media slots
 * (default 2) become tiles:
 *
 *   <div class="work-item"
 *        data-title="BOA Performfit Wrap"
 *        data-case-study="true"                  Full case study switch (unused until clicks return)
 *        data-href="/projects/boa"               optional
 *        data-image-1="…/boa-10.webp"            Image 1 (poster when Video 1 is set)
 *        data-video-1=""                         optional MP4 URL for slot 1
 *        data-image-2="…/boa-11-poster.webp"
 *        data-video-2="…/boa-11.mp4"
 *        data-aspect-1="1.5"                     optional; measured from the image if missing
 *   ></div>
 *
 * The older one-element-per-media format still works:
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

/** A single image URL becomes two texture levels: a fast small one, then the full one (both downscaled on the GPU side). */
const singleImageLevels = (src) => [
  { src, maxEdge: 512 },
  { src, maxEdge: 0 }, // 0 = global maxTextureEdge
];

const bool = (v) => /^(true|1|yes|on)$/i.test(String(v ?? '').trim());

export function readItems(mount) {
  const selector = mount.dataset.items || '.work-item';
  const base = mount.dataset.mediaBase || document.baseURI;
  const perProject = parseInt(mount.dataset.perProject, 10) || 2;
  const resolve = (url) => (url && url.trim() ? new URL(url.trim(), base).href : '');

  const slots = []; // slots[n] = media from slot n of every project, in document order

  document.querySelectorAll(selector).forEach((el, projectIndex) => {
    const d = el.dataset;
    const project = {
      projectIndex,
      title: d.title || el.textContent.trim() || '',
      caseStudy: bool(d.caseStudy),
      description: d.description || '',
      services: d.services || '',
      href: d.href ? resolve(d.href) : el.getAttribute('href') && el.getAttribute('href') !== '#' ? el.href : '',
      el,
    };

    // Numbered attributes (data-image-1) aren't camel-cased by `dataset`, so read them directly.
    const attr = (name) => el.getAttribute(`data-${name}`) || '';
    if (attr('image-1') || attr('video-1')) {
      // CMS format: numbered slots.
      for (let n = 1; n <= perProject; n++) {
        const image = resolve(attr(`image-${n}`));
        const video = resolve(attr(`video-${n}`));
        if (!image && !video) continue;
        const media = video
          ? { type: 'video', poster: image, images: [], sources: videoSources(video, resolve(attr(`video-${n}-webm`))) }
          : { type: 'image', poster: image, images: singleImageLevels(image), sources: [] };
        (slots[n - 1] ||= []).push({ ...project, ...media, slot: n, aspect: parseFloat(attr(`aspect-${n}`)) || 0 });
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
