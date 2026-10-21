/**
 * Google Analytics events for what happens inside the canvas. GA's own page views already follow the in-page
 * addresses (/work/<slug>, /about); these add what they can't see. Sent through the site's gtag (Webflow's
 * Google integration); without it (local dev, blocked) they do nothing.
 *
 *   layout_view       layout                            a homepage version shown: filmstrip | deck | universe
 *   project_open      project, project_title,           a case study opened. opened_from: tile (clicked), link (the
 *                     opened_from, layout               crawlable list / keyboard), url (?project= link), page
 *                                                       (landed on its own page)
 *   project_complete  project, project_title            pulled past the end of a case study
 *   contact_click     method                            email | linkedin | arena (mark as a key event in GA)
 *   client_hover      client                            about: a client's work shown (once per client per page)
 */
export function track(name, params = {}) {
  if (typeof window.gtag !== 'function') return;
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  try {
    window.gtag('event', name, clean);
  } catch {
    // analytics must never break the page
  }
}

const CONTACT = [
  [/^mailto:/i, 'email'],
  [/linkedin\.com/i, 'linkedin'],
  [/are\.na/i, 'arena'],
];

/** Contact link clicks anywhere on the page (the canvas's about links and Webflow's own footer). */
export function trackContactClicks() {
  document.addEventListener(
    'click',
    (e) => {
      const href = e.target.closest?.('a[href]')?.getAttribute('href') || '';
      const method = CONTACT.find(([re]) => re.test(href))?.[1];
      if (method) track('contact_click', { method });
    },
    { capture: true },
  );
}
