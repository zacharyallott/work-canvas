/**
 * work-canvas — entry point.
 *
 * Auto-mounts on <div id="work-canvas"> (or any [data-work-canvas]) once the
 * DOM is ready. Options come from data attributes on the mount:
 *
 *   data-rotate="random"       (default) every load opens a random version, never the one seen last;
 *                              "next" = the next one in order; "false" = always open on data-layout
 *   data-layout="a|b|d|e"      the version when not rotating (and the fallback)
 *                              (?v=b in the URL opens that version once; it's then dropped from the URL so a refresh rotates on)
 *   data-switcher="false"      the star doesn't cycle versions (it only returns home)
 *   data-items=".work-item"    selector for the item links
 *   data-media-base="https://…/"  base URL for relative media paths
 *   data-wheel="capture|page"  capture (default): scrolling drives the layouts; page: vertical wheel scrolls the page
 *   data-max-videos="5"        concurrent video cap (overrides layouts)
 *   data-tagline="…"           top bar text (click opens the about section)
 *   data-project-base="/work/" where each case study's own page lives (default /work/)
 *   data-home-path="/"         the page with the work (closing a project page goes here)
 *   data-about-path="/about"   the about section's own page (the tagline links here)
 *
 * Manual use:  import { mount } from '…/work-canvas.js'; const wc = await mount(el, { layout: 'b' }); wc.destroy();
 */
import gsap from 'gsap';
import { WorkCanvas } from './core/engine.js';
import Filmstrip, { config as filmstripConfig } from './layouts/filmstrip.js';
import Deck, { config as deckConfig } from './layouts/deck.js';
import Fan, { config as fanConfig } from './layouts/fan.js';
import Universe, { config as universeConfig } from './layouts/universe.js';
// Parked for now — the code stays in src/layouts/ for reference. To show them again, restore these imports and
// their LAYOUTS rows below:
//   import Masonry, { config as masonryConfig } from './layouts/masonry.js';
//   import Rolodex, { config as rolodexConfig } from './layouts/rolodex.js';

export const LAYOUTS = [
  { key: 'a', name: 'Filmstrip', Layout: Filmstrip, config: filmstripConfig },
  { key: 'b', name: 'Deck', Layout: Deck, config: deckConfig },
  // { key: 'c', name: 'Masonry', Layout: Masonry, config: masonryConfig }, (parked)
  { key: 'd', name: 'Fan', Layout: Fan, config: fanConfig },
  { key: 'e', name: 'Universe', Layout: Universe, config: universeConfig },
  // { key: 'f', name: 'Rolodex', Layout: Rolodex, config: rolodexConfig }, (parked)
];

export { WorkCanvas };

export async function mount(el, options = {}) {
  if (el.__workCanvas) return el.__workCanvas;
  const d = el.dataset;
  const params = new URLSearchParams(location.search);
  const urlLayout = params.get('v');
  if (urlLayout && !(options.syncUrl ?? d.syncUrl === 'true')) {
    // Honour ?v= for this load only, so refreshing still moves on to the next version.
    params.delete('v');
    const url = new URL(location.href);
    url.search = params.toString();
    history.replaceState(history.state, '', url);
  }
  const maxVideos = parseInt(options.maxVideos ?? d.maxVideos, 10);

  const layouts = LAYOUTS.map((l) => ({ ...l, config: { ...l.config, ...(options.config?.[l.key] ?? {}) } }));
  if (maxVideos) layouts.forEach((l) => (l.config.maxVideos = maxVideos));

  const wc = new WorkCanvas(el, {
    layouts,
    layout: options.layout ?? urlLayout ?? d.layout ?? 'a',
    rotate: options.rotate ?? (options.layout ?? urlLayout ? false : d.rotate === 'false' ? false : d.rotate === 'next' ? 'next' : 'random'),
    switcher: options.switcher ?? d.switcher !== 'false',
    syncUrl: options.syncUrl ?? d.syncUrl === 'true',
    tagline: options.tagline ?? d.tagline ?? 'design &amp; direction made to move',
    ...(d.projectBase ? { projectBase: d.projectBase } : {}),
    ...(d.homePath ? { homePath: d.homePath } : {}),
    ...(d.aboutPath ? { aboutPath: d.aboutPath } : {}),
    hint: options.hint ?? d.hint,
    ...options,
  });
  el.__workCanvas = wc;
  await wc.init();
  return wc;
}

function autoMount() {
  document.querySelectorAll('#work-canvas, [data-work-canvas]').forEach((el) => mount(el));
}

if (typeof window !== 'undefined') {
  window.WorkCanvas = { mount, LAYOUTS };
  if (import.meta.env?.DEV) window.WorkCanvas.gsap = gsap; // dev-only: lets tests step frames
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount, { once: true });
  else autoMount();
}
