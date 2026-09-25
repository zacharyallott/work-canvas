import zaIconLarge from '../ui/za-icon-large.svg';

/**
 * About section (Figma frame 49, node 1542:5601). Shown when the tagline is
 * clicked: the images fade out and this fades in.
 *
 * The copy below is the fallback. On the site it comes from an element with
 * `data-work-about` in the Webflow page (visually hidden), so the statement,
 * clients and links are in the page's HTML for search engines and editable
 * in Webflow. Read from it:
 *   the first <p>                  → statement
 *   each <ul> (outside a <nav>)    → a client column
 *   each <a href>                  → a footer link
 *   [data-about-copyright]         → copyright line (without the ©)
 */
export const ABOUT = {
  statement:
    'An interdisciplinary design practice for deepening and expanding brand connections with conceptually driven solutions that are at once simple, functional & emotional.',
  clients: [
    ['SRAM', 'Cannondale', 'GT Bikes', 'Aspen Snowmass', 'BOA'],
    ['The James Brand', 'Nixon', 'Smith Optics', 'Burton'],
    ['Autodesk', 'Microsoft', 'Xbox', 'Dialpad', 'Electronic Arts', 'Gogoro', 'Surfline'],
    ['Under Armour', 'Adidas', 'Mattel', 'Dexcom'],
  ],
  // Same links as the current site's info page.
  links: [
    { label: 'email', href: 'mailto:zacharyallott@gmail.com' },
    { label: 'linkedin', href: 'https://www.linkedin.com/in/zacharyallott/' },
    { label: 'are.na', href: 'https://www.are.na/zachary-allott' },
  ],
  copyright: `${new Date().getFullYear()} Zachary Allott`,
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** The about copy: from the page's [data-work-about] element when there is one, else ABOUT. */
export function aboutData() {
  const src = document.querySelector('[data-work-about]');
  if (!src) return ABOUT;
  const statement = clean(src.querySelector('p:not([data-about-copyright])')?.textContent) || ABOUT.statement;
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
    statement,
    clients: clients.length ? clients : ABOUT.clients,
    links: links.length ? links : ABOUT.links,
    copyright,
  };
}

export function aboutMarkup() {
  const ABOUT = aboutData();
  return `
    <p class="wc-about-statement">${esc(ABOUT.statement)}<img src="${zaIconLarge}" alt="" width="36" height="36"></p>
    <div class="wc-about-clients" aria-label="Selected clients">
      ${ABOUT.clients.map((col) => `<ul>${col.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`).join('')}
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
