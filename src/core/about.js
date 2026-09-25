import zaIconLarge from '../ui/za-icon-large.svg';

/**
 * About section (Figma frame 49, node 1542:5601). Shown when the tagline is
 * clicked: the images fade out and this fades in.
 *
 * Edit the copy here. To manage it in Webflow instead, add an element with
 * `data-work-about` to the page (it can be hidden); its inner HTML replaces
 * this default. Use the same structure/classes to keep the styling.
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

export function aboutMarkup() {
  const custom = document.querySelector('[data-work-about]');
  if (custom) return custom.innerHTML;
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
