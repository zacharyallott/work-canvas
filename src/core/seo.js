/**
 * Search and share helpers.
 *
 * The header is WebGL plus JavaScript, so search engines can't read the work
 * from the canvas. This adds what they (and screen readers) need:
 * - real links to every case study's own page (/work/<slug>), so crawlers
 *   find and index them (keyboard users can tab through them too);
 * - JSON-LD describing the projects (the homepage's list, or the one project
 *   on its own page). Google reads structured data added by scripts.
 *
 * Page-level metadata (title, description, share image, the Person schema)
 * lives in Webflow's page settings, so it's in the HTML before any script runs.
 */

const abs = (url) => (url ? new URL(url, location.href).href : undefined);

/** Visually hidden list of links to the case-study pages. */
export function projectNav(projects, urlFor) {
  const nav = document.createElement('nav');
  nav.className = 'wc-sr';
  nav.setAttribute('aria-label', 'Projects');
  const list = document.createElement('ul');
  const links = projects.map((p) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = urlFor(p.slug);
    a.textContent = p.title;
    li.appendChild(a);
    if (p.description) li.append(` — ${p.description}`);
    list.appendChild(li);
    return { project: p, a };
  });
  nav.appendChild(list);
  return { nav, links };
}

function creativeWork(p, url, images) {
  const services = (p.services || '').split(/\s*(?:,|→|\n)\s*/).filter(Boolean);
  return {
    '@type': 'CreativeWork',
    name: p.title,
    url,
    description: p.description || undefined,
    image: images.filter(Boolean).map(abs),
    keywords: services.length ? services.join(', ') : undefined,
    creator: { '@type': 'Person', name: 'Zachary Allott', url: abs('/') },
  };
}

/** Replaces (or adds) the JSON-LD block this header owns. */
export function setJsonLd(data) {
  let script = document.head.querySelector('script[data-wc-seo]');
  if (!script) {
    script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.wcSeo = '';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify({ '@context': 'https://schema.org', ...data });
}

/** Homepage: the case studies as an ItemList. `firstImage(p)` gives each project's lead image. */
export function workListJsonLd(projects, urlFor, firstImage) {
  setJsonLd({
    '@type': 'ItemList',
    name: 'Selected work',
    itemListElement: projects.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: abs(urlFor(p.slug)),
      item: creativeWork(p, abs(urlFor(p.slug)), [firstImage(p)]),
    })),
  });
}

/** A project's own page: that project, with its images. */
export function projectJsonLd(project, url, images) {
  setJsonLd(creativeWork(project, abs(url), images));
}
