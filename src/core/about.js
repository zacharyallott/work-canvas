import zaIconLarge from '../ui/za-icon-large.svg';
import aboutMedia from '../../media/about-work.json';

/**
 * About section (Figma frame 49, node 1542:5601). Shown when the tagline is
 * clicked: the images fade out and this fades in.
 *
 * Layout: the headline (large, with the star), then a row of the intro (a
 * short paragraph) and the selected clients in four columns of tags, then the
 * footer links and ©.
 *
 * The copy below is the fallback. On the site it comes from an element with
 * `data-work-about` in the Webflow page (visually hidden), so the copy, clients
 * and links are in the page's HTML for search engines and editable in
 * Webflow. Read from it:
 *   [data-about-headline]          → headline (else the fallback below)
 *   [data-about-intro], else the first other <p> → intro paragraph
 *   each <li> in a <ul> (outside a <nav>) → a client, in order (laid out into CLIENT_COLUMNS)
 *   each <a href>                  → a footer link
 *   [data-about-copyright]         → copyright line (without the ©)
 */
export const ABOUT = {
  headline: 'design & direction made to move brands, culture, humans, categories, & expectations forward.',
  intro:
    'An interdisciplinary design practice for deepening and expanding brand connections with conceptually driven solutions that are at once simple, functional & emotional.',
  clients: [
    ['SRAM', 'Cannondale', 'GT Bikes', 'Aspen Snowmass', 'BOA'],
    ['The James Brand', 'Nixon', 'Smith Optics', 'Burton'],
    ['Autodesk', 'Microsoft', 'Xbox', 'Dialpad'],
    ['Electronic Arts', 'Gogoro', 'Surfline'],
    ['Under Armour', 'Adidas', 'Mattel', 'Dexcom', 'Bonnell'],
  ],
  // Same links as the current site's info page.
  links: [
    { label: 'email', href: 'mailto:zacharyallott@gmail.com' },
    { label: 'linkedin', href: 'https://www.linkedin.com/in/zacharyallott/' },
    { label: 'are.na', href: 'https://www.are.na/zachary-allott' },
  ],
  copyright: `${new Date().getFullYear()} Zachary Allott`,
};

const CLIENT_COLUMNS = 4; // the first starts with the "Select clients" label and a blank line
const CLIENTS_LABEL = 'Select clients';

// Hovering a client's tag shows their work from the showcase: the pieces whose project title contains the
// client's name as a word, or one of these other names (lower case) when the project goes by something else.
const CLIENT_WORK = {
  'smith optics': ['smith'],
  autodesk: ['tinkercad'],
  dexcom: ['stelo'],
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Work that only shows on the about section (when its client's tag is hovered), never on the homepage: the files
 * loose in the top level of 2026_SiteCompilation, built by `npm run media:about` and served from `base` (the
 * mount's data-media-base). Same shape as the CMS items.
 */
export function aboutOnlyWork(base) {
  const url = (src) => new URL(src, base).href;
  return aboutMedia.items.map((m) => ({
    title: m.label,
    type: m.type,
    aspect: m.aspect,
    poster: url(m.poster.src),
    images: m.type === 'image' ? Object.values(m.images).map((l) => ({ src: url(l.src), width: l.width })) : [],
    sources: (m.sources ?? []).map((s) => ({ src: url(s.src), type: s.type })),
  }));
}

/** A client's showcase pieces (one per image/video, in order). */
export function clientWork(name, items) {
  const client = clean(name).toLowerCase();
  const keys = [client, ...(CLIENT_WORK[client] ?? [])].map((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
  const seen = new Set();
  return items.filter((item) => {
    const title = String(item.title ?? '').toLowerCase();
    const src = item.poster || item.images?.[0]?.src;
    if (!src || seen.has(src) || !keys.some((k) => k.test(title))) return false;
    seen.add(src);
    return true;
  });
}

/** The about copy: from the page's [data-work-about] element when there is one, else ABOUT. */
export function aboutData() {
  const src = document.querySelector('[data-work-about]');
  if (!src) return ABOUT;
  const headline = clean(src.querySelector('[data-about-headline]')?.textContent) || ABOUT.headline;
  const intro =
    clean((src.querySelector('[data-about-intro]') ?? src.querySelector('p:not([data-about-copyright]):not([data-about-headline])'))?.textContent) ||
    ABOUT.intro;
  const clients = [...src.querySelectorAll('ul')]
    .filter((ul) => !ul.closest('nav'))
    .map((ul) => [...ul.querySelectorAll('li')].map((li) => clean(li.textContent)).filter(Boolean))
    .filter((col) => col.length);
  const links = [...src.querySelectorAll('a[href]')].map((a) => ({ label: clean(a.textContent), href: a.getAttribute('href') }));
  const copyright = clean(src.querySelector('[data-about-copyright]')?.textContent).replace(/^©\s*/, '') || ABOUT.copyright;
  // The visible about section is built from this; keep the source for crawlers but out of the way of
  // screen readers and the keyboard (the section itself carries the same content).
  src.setAttribute('aria-hidden', 'true');
  src.inert = true;
  return {
    headline,
    intro,
    clients: clients.length ? clients : ABOUT.clients,
    links: links.length ? links : ABOUT.links,
    copyright,
  };
}

/** All the clients laid out into CLIENT_COLUMNS columns, top to bottom then across; the first column's top two
 *  rows are taken by the label and a blank line, so it holds two fewer. */
function clientColumns(clients) {
  const all = clients.flat();
  const rows = Math.ceil((all.length + 2) / CLIENT_COLUMNS);
  const cols = [];
  let i = 0;
  for (let c = 0; c < CLIENT_COLUMNS && i < all.length; c++) {
    const take = c === 0 ? rows - 2 : rows;
    cols.push(all.slice(i, i + take));
    i += take;
  }
  return cols;
}

export function aboutMarkup() {
  const ABOUT = aboutData();
  const cols = clientColumns(ABOUT.clients);
  return `
    <p class="wc-about-statement">${esc(ABOUT.headline)}<img src="${zaIconLarge}" alt="" width="36" height="36"></p>
    <div class="wc-about-row">
      <p class="wc-about-intro">${esc(ABOUT.intro)}</p>
      <div class="wc-about-clients" role="group" aria-label="${CLIENTS_LABEL}">
        ${cols
          .map(
            (col, c) =>
              `<ul>${c === 0 ? `<li class="wc-about-label" aria-hidden="true">${CLIENTS_LABEL}</li><li class="wc-about-gap" aria-hidden="true"></li>` : ''}${col
                .map((name) => `<li>${esc(name)}</li>`)
                .join('')}</ul>`,
          )
          .join('')}
      </div>
    </div>
    <div class="wc-about-footer">
      <nav class="wc-about-links" aria-label="Contact">
        ${ABOUT.links
          .map((l) => {
            const external = l.href.startsWith('http') ? ' target="_blank" rel="noopener"' : '';
            return `<a href="${esc(l.href)}"${external}>${esc(l.label)} <span class="wc-link-arrow" aria-hidden="true"><span class="wc-link-track"><span>→</span><span class="is-next">→</span></span></span></a>`;
          })
          .join('')}
      </nav>
      <p class="wc-about-copy"><span aria-hidden="true">©</span><span class="wc-sr"> ${esc(ABOUT.copyright)}</span></p>
    </div>`;
}
