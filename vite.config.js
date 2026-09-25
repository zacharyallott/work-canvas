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

    return [...projects.entries()]
      .map(([title, media]) => {
        const attrs = { 'data-title': title, 'data-case-study': media[0].href ? 'true' : 'false' };
        media.slice(0, 2).forEach((m, n) => {
          if (m.type === 'video') {
            attrs[`data-image-${n + 1}`] = m.poster.src;
            attrs[`data-video-${n + 1}`] = m.sources.find((s) => s.type === 'video/mp4')?.src;
          } else {
            attrs[`data-image-${n + 1}`] = m.images.lg.src;
          }
        });
        const attrString = Object.entries(attrs)
          .map(([k, v]) => `${k}="${esc(v)}"`)
          .join(' ');
        return `      <div role="listitem" class="w-dyn-item"><div class="work-item" ${attrString}>${esc(title)}</div></div>`;
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
