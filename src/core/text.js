/**
 * Text that dissolves in line by line (the about statement, a project's title and description).
 *
 *   splitWords(el)   wraps each word of el's text in a span.wc-w (inline images become words too)
 *   lines(words)     those words grouped into the lines the browser wrapped them onto, measured now
 */

export function splitWords(el) {
  if (!el) return;
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) frag.appendChild(document.createTextNode(part));
          else {
            const w = document.createElement('span');
            w.className = 'wc-w';
            w.textContent = part;
            frag.appendChild(w);
          }
        });
        child.replaceWith(frag);
      } else if (child.nodeName === 'IMG') {
        child.classList.add('wc-w');
      } else if (child.nodeType === Node.ELEMENT_NODE && !child.classList.contains('wc-w')) {
        walk(child);
      }
    }
  };
  walk(el);
}

/** Groups words by their vertical centre (so an inline star joins its line even though its box is shorter). */
export function lines(words) {
  const out = [];
  let lastMid = null;
  words.forEach((w) => {
    const mid = w.offsetTop + w.offsetHeight / 2;
    if (lastMid === null || Math.abs(mid - lastMid) > w.offsetHeight * 0.5) out.push([]);
    out[out.length - 1].push(w);
    lastMid = mid;
  });
  return out;
}
