import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * Dev-only: fills <!-- WORK_ITEMS --> in index.html with the same markup the
 * Webflow "Projects" Collection List renders (one element per project, first
 * two media as Image 1 / Image 2, videos as Image N video + poster), generated
 * from public/media/media.json. Aspect ratios are left out on purpose so the
 * runtime measures them, like it has to for CMS items.
 *
 * /work/<slug> mimics the Projects template page: just that project's item,
 * so the bundle runs in project-page mode.
 */
function mockWebflowItems() {
  const manifestPath = path.resolve('public/media/media.json');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  function render(only) {
    if (!fs.existsSync(manifestPath)) return '<!-- run `npm run media` first -->';
    const { items } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {});
    const galleries = read(path.resolve('public/media/projects/index.json'));
    const copy = read(path.resolve('media/case-studies.json'));
    const projects = new Map();
    items.forEach((i) => projects.set(i.label, [...(projects.get(i.label) ?? []), i]));

    // Same structure the Webflow Collection List renders: bound text blocks + bound <img>s.
    // Empty bindings get Webflow's `w-dyn-bind-empty` class, like the real thing.
    const empty = (cls, tag = 'div') =>
      tag === 'img' ? `<img class="${cls} w-dyn-bind-empty" src="" alt="">` : `<div class="${cls} w-dyn-bind-empty"></div>`;
    const text = (cls, value) => (value ? `<div class="${cls}">${esc(value)}</div>` : empty(cls));
    const slot = (n, m, title) => {
      if (!m) return empty(`work-image-${n}`, 'img') + empty(`work-video-${n}`);
      const img =
        m.type === 'video'
          ? `<img class="work-image-${n}" src="${esc(m.poster.src)}" alt="${esc(title)}" data-hash="${m.sourceHash}" loading="lazy">`
          : `<img class="work-image-${n}" src="${esc(m.images.lg.src)}" srcset="${['sm', 'md', 'lg']
              .map((k) => `${esc(m.images[k].src)} ${m.images[k].width}w`)
              .join(', ')}" alt="${esc(title)}" data-hash="${m.sourceHash}" loading="lazy">`;
      const mp4 = m.type === 'video' ? m.sources.find((s) => s.type === 'video/mp4')?.src : '';
      return img + text(`work-video-${n}`, mp4);
    };
    const slugOf = (media, title) =>
      media[0].href ? media[0].href.split('/').pop() : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    return [...projects.entries()]
      .filter(([title, media]) => !only || slugOf(media, title) === only)
      .map(([title, media]) => {
        const slug = slugOf(media, title);
        const c = copy[slug] ?? {};
        const gallery = media[0].caseStudy ? (galleries[slug]?.items ?? []) : [];
        const html = [
          text('work-title', title),
          text('work-slug', slug),
          text('work-description', c.description),
          text('work-services', c.services),
          media[0].caseStudy ? '<div class="work-case-study">Full case study</div>' : '',
          slot(1, media[0], title),
          slot(2, media[1], title),
          ...gallery.map((m, i) => slot(i + 3, m, title)), // Image 3 onward: project view
        ].join('');
        return `      <div role="listitem" class="w-dyn-item"><div class="work-item">${html}</div></div>`;
      })
      .join('\n');
  }

  return {
    name: 'mock-webflow-items',
    transformIndexHtml: (html, ctx) => {
      const only = /^\/work\/([^/?#]+)/.exec(ctx.originalUrl || ctx.path || '')?.[1];
      return html.replace('<!-- WORK_ITEMS -->', render(only && decodeURIComponent(only)));
    },
    configureServer(server) {
      // Reload the page when the pipeline rewrites the manifest.
      const watched = [manifestPath, path.resolve('public/media/projects/index.json'), path.resolve('media/case-studies.json')];
      server.watcher.add(watched);
      server.watcher.on('change', (file) => watched.includes(file) && server.ws.send({ type: 'full-reload' }));
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
