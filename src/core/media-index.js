import map from '../../media/webflow-assets.json';

/**
 * CMS images sit on Webflow's CDN at full size only. For the ones the media pipeline built (matched by content,
 * see scripts/build-webflow-map.mjs), this gives image levels: its 480 px and 1280 px copies from `base` (the
 * mount's data-media-base, i.e. this release on jsDelivr), then the Webflow file itself as the largest. Each level
 * has its width and long edge. Null when the image isn't one of them (it keeps the full-size file only).
 */
export function repoLevels(url, base) {
  const id = url && base && /\/([0-9a-f]{24})_[^/]*$/.exec(url)?.[1];
  const entry = id && map.assets[id];
  if (!entry) return null;
  const [prefix, smW, smH, mdW, mdH, lgW, lgH] = entry;
  return [
    { src: new URL(`${prefix}-sm.webp`, base).href, width: smW, edge: Math.max(smW, smH) },
    { src: new URL(`${prefix}-md.webp`, base).href, width: mdW, edge: Math.max(mdW, mdH) },
    { src: url, width: lgW, edge: Math.max(lgW, lgH) },
  ];
}

/** "url 480w, url 1280w, …" for an <img srcset>. */
export const srcsetOf = (levels) => (levels ?? []).map((l) => `${l.src} ${l.width}w`).join(', ');

/**
 * The AV1 WebM the pipeline builds beside every MP4 it publishes (the CMS only holds the MP4 link): same address,
 * .webm. Only for MP4s from this repo — `base` tells which (…/work-canvas@<version>/public/).
 */
export function webmFor(mp4, base) {
  const repo = base && /^(https:\/\/cdn\.jsdelivr\.net\/gh\/[^@]+@)/.exec(base)?.[1];
  return repo && mp4?.startsWith(repo) && /\.mp4$/.test(mp4) ? mp4.replace(/\.mp4$/, '.webm') : '';
}
