import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * Dev-only: fills <!-- WORK_ITEMS --> in index.html with the same markup the
 * Webflow "Projects" Collection List renders (one element per project, first
 * two media as Image 1 / Image 2, videos as Image N video + poster), generated
 * from public/media/media.json. Aspect ratios are left out on purpose so the
 * runtime measures them, like it has to for CMS items.
 */
function mockWebflowItems() {
  const manifestPath = path.resolve('public/media/media.json');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  function render() {
    if (!fs.existsSync(manifestPath)) return '<!-- run `npm run media` first -->';
    const { items } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const projects = new Map();
    items.forEach((i) => projects.set(i.label, [...(projects.get(i.label) ?? []), i]));

    // Same structure the Webflow Collection List renders: bound text blocks + bound <img>s.
    // Empty bindings get Webflow's `w-dyn-bind-empty` class, like the real thing.
    const empty = (cls, tag = 'div') =>
      tag === 'img' ? `<img class="${cls} w-dyn-bind-empty" src="" alt="">` : `<div class="${cls} w-dyn-bind-empty"></div>`;
    return [...projects.entries()]
      .map(([title, media]) => {
        const slots = [0, 1].map((n) => {
          const m = media[n];
          if (!m) return empty(`work-image-${n + 1}`, 'img') + empty(`work-video-${n + 1}`);
          const img =
            m.type === 'video'
              ? `<img class="work-image-${n + 1}" src="${esc(m.poster.src)}" alt="${esc(title)}" loading="lazy">`
              : `<img class="work-image-${n + 1}" src="${esc(m.images.lg.src)}" srcset="${['sm', 'md', 'lg']
                  .map((k) => `${esc(m.images[k].src)} ${m.images[k].width}w`)
                  .join(', ')}" alt="${esc(title)}" loading="lazy">`;
          const mp4 = m.type === 'video' ? m.sources.find((s) => s.type === 'video/mp4')?.src : '';
          return img + (mp4 ? `<div class="work-video-${n + 1}">${esc(mp4)}</div>` : empty(`work-video-${n + 1}`));
        });
        const caseStudy = media[0].href ? '<div class="work-case-study">Full case study</div>' : '';
        return `      <div role="listitem" class="w-dyn-item"><div class="work-item"><div class="work-title">${esc(title)}</div>${empty('work-description')}${empty('work-services')}${caseStudy}${slots.join('')}</div></div>`;
      })
      .join('\n');
  }

  return {
    name: 'mock-webflow-items',
    transformIndexHtml: (html) => html.replace('<!-- WORK_ITEMS -->', render()),
    configureServer(server) {
      // Reload the page when the pipeline rewrites the manifest.
      server.watcher.add(manifestPath);
      server.watcher.on('change', (file) => file === manifestPath && server.ws.send({ type: 'full-reload' }));
    },
  };
}

export default defineConfig({
  plugins: [mockWebflowItems()],
  server: { host: true, port: 5173 },
  build: {
    // Library build → one ES module, three + gsap bundled, SVGs inlined.
    lib: {
      entry: 'src/main.js',
      formats: ['es'],
      fileName: () => 'work-canvas.js',
    },
    outDir: 'dist',
    copyPublicDir: false, // media is served from /public/media on jsDelivr, not bundled
    assetsInlineLimit: Infinity,
    target: 'es2020',
    sourcemap: true,
    minify: true,
  },
});
