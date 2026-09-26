import * as THREE from 'three';
import gsap from 'gsap';
import { DEFAULTS } from './defaults.js';
import { EASE } from './motion.js';
import { readItems, ensureAspects } from './data.js';
import { MediaManager } from './media.js';
import { Input } from './input.js';
import { UI, hideLinkLists } from './ui.js';
import { vertexShader, fragmentShader } from './shaders.js';
import { projectNav, workListJsonLd, projectJsonLd } from './seo.js';

/**
 * WorkCanvas — the shared core.
 *
 * Owns the renderer, the orthographic pixel-space camera, the render loop,
 * input, resize/visibility handling, media, the DOM overlay and the
 * open-project transition. Layouts (src/layouts/*) only position tiles.
 *
 * Coordinates: layouts work in CSS px from the mount's top-left, y down.
 */
/** Resolves when an image URL is in the cache (or failed) — never rejects. */
function preload(src) {
  return new Promise((resolve) => {
    if (!src) return resolve();
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = img.onerror = () => resolve();
    img.src = src;
  });
}

export class WorkCanvas {
  constructor(mount, options = {}) {
    this.mount = mount;
    this.options = { ...DEFAULTS, ...options };
    this.layoutDefs = options.layouts; // [{ key, name, Layout, config }]

    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = reduced.matches;
    this._onReducedChange = (e) => (this.reducedMotion = e.matches);
    reduced.addEventListener?.('change', this._onReducedChange);
    this._reducedQuery = reduced;

    this.isMobile = matchMedia('(pointer: coarse)').matches || window.innerWidth < 768; // media budget: smaller textures, fewer videos
    this.touch = !matchMedia('(hover: hover) and (pointer: fine)').matches; // no cursor: tap instead of hover, drag instead of steer

    this.viewport = { width: 1, height: 1 };
    this.scale = 1; // set by the active layout (tile sizes, caption inset)
    this.dpr = 1;
    this.time = 0;
    this.hovered = null;
    this.focusedItem = null; // item focused via keyboard (real links)
    this.upgradeThreshold = this.options.upgradeThreshold;
    this.radius = this.options.radius;

    this.running = false;
    this.inView = true;
    this.pageVisible = !document.hidden;
    this.openTile = null;
    this.openProgress = 0;

    this._tick = this.tick.bind(this);
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────
  async init() {
    const { mount } = this;
    mount.classList.add('wc-root');

    this.items = readItems(mount);
    if (!this.items.length) {
      console.warn('[work-canvas] no .work-item elements found — nothing to render.');
      return this;
    }
    await ensureAspects(this.items);
    hideLinkLists(this.items);
    // A case study's own page (/work/<slug>, the CMS template) carries just that project.
    this.projectPage = Boolean(this.pathSlug()) && new Set(this.items.map((i) => i.slug)).size === 1;
    // Title to show when back on the work (the page may have loaded as /about or /work/<slug>).
    this._homeTitle = this.isHomePath() ? document.title : this.options.homeTitle;

    const keys = this.layoutDefs.map((l) => l.key);
    let initial = keys.includes(this.options.layout) ? this.options.layout : keys[0];
    if (this.options.rotate) initial = rotatedLayout(keys) ?? initial; // a different version on every visit
    this.ui = new UI(mount, {
      layouts: this.layoutDefs,
      current: initial,
      aboutHref: this.options.aboutPath,
      onAbout: () => this.toggleAbout(),
      // The star cycles the homepage versions (closing the about / project view if open).
      onHome: () => (this.canCycle ? this.nextLayout() : this.projectOpen ? this.closeProject() : this.toggleAbout(false)),
      tagline: this.options.tagline,
      hint: this.options.hint,
    });
    this.ui.setAbout(false);
    this.ui.project.onEnd = () => this.closeProject(); // pulled past the end of the page
    this.ui.onAboutEnd = () => this.toggleAbout(false); // pulled past the bottom of the about section
    this._onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (this.projectOpen) this.closeProject();
      else if (this.aboutOpen) this.toggleAbout(false);
    };
    document.addEventListener('keydown', this._onKey);

    try {
      this.createRenderer();
    } catch (err) {
      console.warn('[work-canvas] WebGL unavailable, showing the static grid.', err);
      this.ui.renderFallback(this.items); // only without WebGL, so it never flashes up before the canvas
      mount.classList.add('is-fallback');
      return this;
    }

    this.media = new MediaManager(this.renderer, {
      maxVideos: this.options.maxVideos,
      videoPolicy: this.isMobile && this.options.mobileVideo === 'focused' ? 'focused' : this.reducedMotion ? 'focused' : 'all',
      downgradeAfter: this.options.downgradeAfter,
      maxTextureEdge: this.isMobile ? this.options.maxTextureEdgeMobile : this.options.maxTextureEdge,
    });
    this.mediaItems = this.items.map((d) => this.media.add(d));
    this.media.preload();

    this.bindInput();
    this.bindObservers();
    this.bindKeyboard();
    this.addSeo();

    this.resize();
    this.start();

    // /about opens straight into the about section (the work loads behind it).
    if (!this.projectPage && this.isAboutPath()) this.toggleAbout(true, { push: false });

    if (this.projectPage) {
      // The project opens straight away; closing it goes to the work on the homepage.
      mount.classList.add('is-ready');
      const item = this.mediaItems.find((i) => i.caseStudy);
      if (!item) {
        location.replace(this.options.homePath); // no project view for this piece: show the work instead
        return this;
      }
      await this.openProject({ item }, { push: false, morph: false });
      return this;
    }

    await this.whenThumbsReady();
    mount.classList.add('is-ready');
    await this.setLayout(initial, { initial: true });

    // Deep link to a project on the homepage (e.g. an old ?project=<slug> link).
    const slug = this.slugFromLocation();
    if (slug && this.openProjectBySlug(slug, { push: false })) this.replaceUrl(this.projectUrl(slug));
    return this;
  }

  // ─── Project addresses & SEO ───────────────────────────────────────────────
  isHomePath() {
    return location.pathname.replace(/\/$/, '') === this.options.homePath.replace(/\/$/, '');
  }

  isAboutPath() {
    return location.pathname.replace(/\/$/, '') === this.options.aboutPath.replace(/\/$/, '');
  }

  projectUrl(slug) {
    return `${this.options.projectBase}${encodeURIComponent(slug)}`;
  }

  /** Slug from a /work/<slug> path. */
  pathSlug() {
    const base = this.options.projectBase;
    const path = location.pathname;
    return path.startsWith(base) ? decodeURIComponent(path.slice(base.length).replace(/\/$/, '')) || null : null;
  }

  /** The project the address points at: /work/<slug>, or a legacy ?project=<slug>. */
  slugFromLocation() {
    return new URLSearchParams(location.search).get('project') || this.pathSlug();
  }

  /**
   * Links to every case study's page and JSON-LD for the projects, so search
   * engines (and screen readers) can reach the work behind the canvas. Tabbing
   * to a link shows that project's caption on the canvas; Enter opens it.
   */
  addSeo() {
    const cases = [...new Map(this.mediaItems.filter((i) => i.caseStudy && i.slug).map((i) => [i.slug, i])).values()];
    if (this.projectPage) {
      const item = cases[0];
      if (item) projectJsonLd(item.project, location.href, [item.poster, ...(item.project.gallery ?? []).map((g) => g.src)]);
      return;
    }
    if (!cases.length) return;
    const { nav, links } = projectNav(
      cases.map((i) => i.project),
      (slug) => this.projectUrl(slug),
    );
    links.forEach(({ a }, n) => {
      const item = cases[n];
      a.addEventListener('focus', () => {
        this.focusedItem = item;
        this.layout?.focusItem?.(item);
      });
      a.addEventListener('blur', () => (this.focusedItem = null));
      a.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // new tab/window: let the link work
        e.preventDefault();
        const tile = this.layout?.tileForItem(item);
        if (tile?.onScreen) this.openProject(tile);
        else this.openProjectBySlug(item.slug, { push: true });
      });
    });
    this.mount.appendChild(nav);
    this.seoNav = nav;
    workListJsonLd(
      cases.map((i) => i.project),
      (slug) => this.projectUrl(slug),
      (p) => cases.find((i) => i.project === p)?.poster,
    );
  }

  createRenderer() {
    const renderer = new THREE.WebGLRenderer({
      antialias: this.options.antialias,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    });
    if (!renderer.getContext()) throw new Error('no context');
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // passthrough, see shaders.js
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'wc-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    this.mount.prepend(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, -2000, 2000);
    this.raycaster = new THREE.Raycaster();

    // One shared plane for every tile.
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.emptyTexture = new THREE.DataTexture(new Uint8Array([226, 226, 226, 255]), 1, 1);
    this.emptyTexture.needsUpdate = true;
    this.baseMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTex: { value: null },
        uTexReady: { value: 0 },
        uTexSize: { value: new THREE.Vector2(1, 1) },
        uSize: { value: new THREE.Vector2(1, 1) },
        uRadius: { value: this.options.radius },
        uDpr: { value: 1 },
        uBase: { value: new THREE.Color(this.options.placeholder).convertLinearToSRGB() },
        uZoom: { value: 0 },
        uGray: { value: 0 },
        uAlpha: { value: 1 },
        uReveal: { value: 1 },
      },
    });
  }

  start() {
    if (this.running || !this.renderer) return;
    this.running = true;
    gsap.ticker.add(this._tick);
    if (this.media) this.media.enabled = true;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    gsap.ticker.remove(this._tick);
    this.media?.pauseAll();
    if (this.media) this.media.enabled = false;
  }

  updateRunning() {
    const shouldRun = this.inView && this.pageVisible && !this.aboutOpen && !this.projectOpen;
    shouldRun ? this.start() : this.stop();
  }

  // ─── About section ─────────────────────────────────────────────────────────
  /**
   * Tagline click: the images fade out (CSS on .wc-canvas) and the about
   * section fades in. Rendering pauses once the fade has finished and resumes
   * as soon as it closes. The about section has its own address (/about, a
   * Webflow page with the same header), so opening it here moves the address
   * there and Back closes it.
   */
  toggleAbout(open = !this.aboutOpen, { push = true, fromHistory = false } = {}) {
    if (open === this.aboutOpen) return;
    if (open && this.projectPage) {
      location.assign(this.options.aboutPath); // a project's own page has no work behind it
      return;
    }
    if (open && this.projectOpen) this.closeProject({ fromHistory: true });
    this.aboutOpen = open;
    if (open) {
      if (push && !this.isAboutPath()) history.pushState({ ...(history.state || {}), wcAbout: true }, '', new URL(this.options.aboutPath, location.href));
      document.title = `About — ${this.options.siteName}`;
    } else {
      document.title = this._homeTitle;
      if (!fromHistory && history.state?.wcAbout) history.back(); // opened here: Back returns to the work
      else if (!fromHistory && this.isAboutPath()) this.replaceUrl(this.options.homePath);
    }
    this.mount.classList.toggle('is-about', open);
    this.ui?.setAbout(open);
    clearTimeout(this._aboutTimer);
    if (open) {
      this.hovered = null;
      this.tapped = null;
      this.mount.classList.remove('is-hovering-tile');
      this._aboutTimer = setTimeout(() => this.updateRunning(), 650);
    } else {
      this.updateRunning();
    }
  }

  /** Resolves once most thumbnails are on the GPU (or after a timeout). */
  whenThumbsReady(ratio = 0.8, timeout = 2500) {
    const t0 = performance.now();
    return new Promise((resolve) => {
      const check = () => {
        const ready = this.mediaItems.filter((i) => i.ready).length / this.mediaItems.length;
        if (ready >= ratio || performance.now() - t0 > timeout) resolve();
        else setTimeout(check, 50);
      };
      check();
    });
  }

  // ─── Layouts ───────────────────────────────────────────────────────────────
  /** `swap: true` replaces the current version without its leave fade (used while the canvas is hidden). */
  async setLayout(key, { initial = false, swap = false } = {}) {
    if (!initial) {
      // Switching always brings the images back (the first load keeps /about open).
      if (this.aboutOpen) this.toggleAbout(false);
      if (this.projectOpen) this.closeProject({ cycle: false }); // we're switching anyway
    }
    if (this.switching || key === this.layoutKey || !this.renderer) return;
    const def = this.layoutDefs.find((l) => l.key === key);
    if (!def) return;
    this.switching = true;
    this.ui?.setActive(key);
    rememberLayout(key);
    if (this.options.syncUrl) {
      const url = new URL(location.href);
      url.searchParams.set('v', key);
      history.replaceState(history.state, '', url);
    }

    if (this.layout) {
      if (!swap) await this.layout.leave();
      this.layout.dispose();
      this.hovered = null;
    }
    this.layoutKey = key;
    this.layout = new def.Layout(this, { ...def.Layout.defaults, ...def.config });
    this.media.maxVideos = this.layout.config.maxVideos ?? this.options.maxVideos;
    this.layout.resize(this.viewport);
    await this.layout.enter({ initial });
    this.switching = false;
  }

  get canCycle() {
    return this.options.switcher && this.layoutDefs.length > 1;
  }

  /** Star click (and leaving a project): on to the next version, wrapping around. */
  nextLayout({ swap = false } = {}) {
    const keys = this.layoutDefs.map((l) => l.key);
    const next = keys[(keys.indexOf(this.layoutKey) + 1) % keys.length];
    if (next === this.layoutKey) {
      if (this.projectOpen) this.closeProject({ cycle: false });
      if (this.aboutOpen) this.toggleAbout(false);
      return;
    }
    this.setLayout(next, { swap });
  }

  // ─── Frame loop ────────────────────────────────────────────────────────────
  tick(_time, deltaMs) {
    const dt = Math.min(deltaMs / 1000, 1 / 20);
    this.time += dt;

    this.updateHover();
    this.media.beginFrame();

    const layout = this.layout;
    if (layout) {
      layout.update(dt, this.time);
      const hoverCfg = layout.config.hover;
      for (const tile of layout.tiles) tile.sync(dt, this.viewport, hoverCfg);
    }

    this.media.endFrame(this.time);

    if (layout && this.ui) {
      const tile = this.openTile || this.aboutOpen || this.projectOpen ? null : layout.captionTile();
      const inset = (layout.config.captionInset ?? [20, 12]).map((v) => v * Math.min(1, this.scale));
      // Only pieces with a project view get a caption (title + ↓); the rest stay silent on hover.
      this.ui.updateCaption(tile?.onScreen && tile.item.caseStudy ? tile : null, inset, this.reducedMotion);
    }

    this.renderer.render(this.scene, this.camera);
  }

  // ─── Picking / hover ───────────────────────────────────────────────────────
  pick(x, y) {
    if (!this.layout) return null;
    const ndc = new THREE.Vector2((x / this.viewport.width) * 2 - 1, -(y / this.viewport.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes = this.layout.tiles.filter((t) => t.onScreen && t.interactive && t.alpha > 0.5).map((t) => t.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    // Depth testing is off, so the visually top-most tile is the highest renderOrder.
    hits.sort((a, b) => b.object.renderOrder - a.object.renderOrder);
    const hit = hits[0];
    return { tile: hit.object.userData.tile, uv: hit.uv };
  }

  /**
   * Cursor position for layouts: nx/ny in -1..1 from the mount centre
   * (left/top negative), `inside` false when the pointer is elsewhere or on
   * touch devices (layouts fall back to their idle motion).
   */
  get cursor() {
    const p = this.input?.pointer;
    const { width, height } = this.viewport;
    if (!p?.inside || this.touch) return { nx: 0, ny: 0, inside: false };
    return {
      nx: Math.max(-1, Math.min(1, (p.x - width / 2) / (width / 2))),
      ny: Math.max(-1, Math.min(1, (p.y - height / 2) / (height / 2))),
      inside: true,
    };
  }

  updateHover() {
    const p = this.input?.pointer;
    let next = null;
    if (this.tapped && this.time < this.tapped.until && this.layout?.tiles.includes(this.tapped.tile)) {
      next = this.tapped.tile; // touch: a tapped tile keeps its caption for a moment
    } else if (p?.inside && !this.input.pressed?.dragging && !this.openTile && !this.switching && !this.touch && !this.aboutOpen && !this.projectOpen) {
      const hit = this.pick(p.x, p.y);
      if (hit) next = hit.tile;
    }
    if (next !== this.hovered) {
      this.hovered = next;
      // Pointer cursor only where a click does something: case-study projects.
      this.mount.classList.toggle('is-hovering-tile', Boolean(next?.item.caseStudy && next.item.project));
    }
  }

  // ─── Project view ──────────────────────────────────────────────────────────
  /**
   * Click on a case-study tile: the tile glides to where its image sits at
   * the top of the project page while every other tile fades; then the DOM
   * page takes over (same image, same place) and the rest of it fades in.
   * Pushes ?project=<slug> so the browser Back button returns to the work.
   */
  async openProject(tile, { push = true, morph = true } = {}) {
    const item = tile?.item;
    const project = item?.project;
    if (!project || !item.caseStudy || this.openTile || this.projectOpen) return false;
    if (this.aboutOpen) this.toggleAbout(false, { fromHistory: true }); // the project gets its own history entry

    const view = this.ui.project;
    const hero = { type: item.type, bestSrc: item.bestSrc, srcset: item.srcset, sources: item.sources, poster: item.poster, hash: item.hash, embed: item.embed, aspect: item.aspect, alt: project.title };
    await preload(hero.bestSrc); // cached already, so the DOM copy appears without a flash

    this.projectOpen = true;
    this.hovered = null;
    this.mount.classList.remove('is-hovering-tile');
    view.render(project, hero);
    const target = view.heroRect();
    if (push) this.pushProjectState(project.slug);

    const finish = () => {
      this.mount.classList.add('is-project'); // DOM page on, canvas off (CSS)
      view.reveal({ reduced: this.reducedMotion });
      clearTimeout(this._projectTimer);
      this._projectTimer = setTimeout(() => this.updateRunning(), 500);
    };

    if (!morph || this.reducedMotion || !target) {
      finish();
      return true;
    }
    this.openTile = tile;
    const from = { ...tile.rect, radius: this.radius };
    tile.override = from;
    const duration = this.options.openDuration;
    gsap
      .timeline({ defaults: { duration, ease: this.options.openEase }, onComplete: finish })
      .to(this, { openProgress: 1, duration: 0.3, ease: EASE.fade }, 0) // the other tiles dissolve
      .to(from, { ...target, radius: this.radius }, 0);
    return true;
  }

  /** Opens a project without a clicked tile (deep link / browser forward / link). */
  openProjectBySlug(slug, opts) {
    const item = this.mediaItems?.find((i) => i.project?.slug === slug && i.caseStudy);
    if (!item) return false;
    // No morph from a tile the visitor didn't click: straight crossfade.
    this.openProject({ item }, { ...opts, morph: false });
    return true;
  }

  /**
   * Back to the work. It comes back as the next homepage version (`cycle`),
   * swapped in while the canvas is still hidden so the old one never flashes.
   */
  closeProject({ fromHistory = false, cycle = true } = {}) {
    if (!this.projectOpen) return;
    this.projectOpen = false;
    clearTimeout(this._projectTimer);
    gsap.killTweensOf(this);
    this.ui.project.hide();
    this.resetOpen();
    if (cycle && !this.projectPage && this.canCycle && !this.switching) this.nextLayout({ swap: true });
    this.mount.classList.remove('is-project'); // canvas fades back in, page fades out
    this.updateRunning();
    document.title = this._homeTitle;
    if (!fromHistory && history.state?.wcProject) history.back(); // opened here: Back returns to the work
    else if (this.projectPage) location.assign(this.options.homePath); // landed on the project's page: go to the work
    else if (!fromHistory) this.replaceUrl(this.options.homePath);
  }

  /** In-page project opens get the project's own address (/work/<slug>) and title. */
  pushProjectState(slug) {
    if (!slug) return;
    const url = new URL(this.projectUrl(slug), location.href);
    history.pushState({ ...(history.state || {}), wcProject: slug }, '', url);
    const project = this.mediaItems.find((i) => i.project?.slug === slug)?.project;
    if (project) document.title = `${project.title} — ${this.options.siteName}`;
  }

  /** Swaps the address without a new history entry (drops any ?project=). */
  replaceUrl(path) {
    const url = new URL(path, location.href);
    const params = new URLSearchParams(location.search);
    params.delete('project');
    url.search = params.toString();
    history.replaceState({ ...(history.state || {}), wcProject: undefined }, '', url);
  }

  resetOpen() {
    if (!this.openTile) return;
    gsap.killTweensOf(this);
    this.openTile.override = null;
    this.openTile = null;
    this.openProgress = 0;
  }

  // ─── Input / observers ─────────────────────────────────────────────────────
  bindInput() {
    const wheel = this.mount.dataset.wheel || this.options.wheel;
    this.input = new Input(this.mount, { clickSlop: this.options.clickSlop, wheel });
    const busy = () => this.switching || this.openTile || this.projectOpen || this.aboutOpen || !this.layout;
    this.input
      .on('drag', (e) => !busy() && this.layout.onDrag?.(e))
      .on('release', (e) => !busy() && this.layout.onRelease?.(e))
      .on('wheel', (e) => !busy() && this.layout.onWheel?.(e))
      .on('scroll', (e) => !busy() && this.inView && this.layout.onScroll?.(e))
      .on('tap', ({ x, y, event }) => {
        if (busy()) return;
        const hit = this.pick(x, y);
        if (this.touch && hit) this.tapped = { tile: hit.tile, until: this.time + this.options.tapCaptionFor };
        const handled = this.layout.onTap?.(hit?.tile ?? null, event);
        if (!handled && hit?.tile.item.caseStudy) this.openProject(hit.tile);
      });

    // Browser Back/Forward between the work, a project and the about section.
    this._onPopState = (e) => {
      const slug = e.state?.wcProject || this.slugFromLocation();
      if (slug && !this.projectOpen) this.openProjectBySlug(slug, { push: false });
      else if (!slug && this.projectOpen) this.closeProject({ fromHistory: true });
      const about = this.isAboutPath();
      if (about && !this.aboutOpen) this.toggleAbout(true, { push: false });
      else if (!about && this.aboutOpen) this.toggleAbout(false, { fromHistory: true });
    };
    window.addEventListener('popstate', this._onPopState);
    // Back/forward cache: undo a half-finished transition when returning.
    this._onPageShow = (e) => e.persisted && this.resetOpen();
    window.addEventListener('pageshow', this._onPageShow);
  }

  bindObservers() {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.mount);

    this.intersection = new IntersectionObserver(([entry]) => {
      this.inView = entry.isIntersecting;
      this.updateRunning();
    });
    this.intersection.observe(this.mount);

    this._onVisibility = () => {
      this.pageVisible = !document.hidden;
      this.updateRunning();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  /** Keyboard users tab through the real (visually hidden) links; the canvas follows focus. */
  bindKeyboard() {
    this._focusHandlers = this.items.map((data, i) => {
      const onFocus = () => {
        this.focusedItem = this.mediaItems[i];
        this.layout?.focusItem?.(this.mediaItems[i]);
      };
      const onBlur = () => (this.focusedItem = null);
      data.el.addEventListener('focus', onFocus);
      data.el.addEventListener('blur', onBlur);
      return () => {
        data.el.removeEventListener('focus', onFocus);
        data.el.removeEventListener('blur', onBlur);
      };
    });
  }

  resize() {
    if (!this.renderer) return;
    const rect = this.mount.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.viewport = { width, height };
    this.dpr = Math.min(window.devicePixelRatio || 1, this.options.maxDpr);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(width, height, false);
    Object.assign(this.camera, { left: 0, right: width, top: 0, bottom: -height });
    this.camera.updateProjectionMatrix();
    this.isMobile = matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;
    this.touch = !matchMedia('(hover: hover) and (pointer: fine)').matches;
    this.layout?.resize(this.viewport);
    if (this.projectOpen) this.ui?.project.layoutInfo();
  }

  // ─── Teardown ──────────────────────────────────────────────────────────────
  destroy() {
    this.stop();
    gsap.killTweensOf(this);
    this.resizeObserver?.disconnect();
    this.intersection?.disconnect();
    document.removeEventListener('visibilitychange', this._onVisibility);
    document.removeEventListener('keydown', this._onKey);
    clearTimeout(this._aboutTimer);
    window.removeEventListener('pageshow', this._onPageShow);
    window.removeEventListener('popstate', this._onPopState);
    this.seoNav?.remove();
    clearTimeout(this._projectTimer);
    this._reducedQuery.removeEventListener?.('change', this._onReducedChange);
    this._focusHandlers?.forEach((off) => off());
    this.input?.destroy();
    this.layout?.dispose();
    this.media?.dispose();
    this.geometry?.dispose();
    this.baseMaterial?.dispose();
    this.emptyTexture?.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer.domElement.remove();
    }
    this.ui?.destroy();
    this.mount.classList.remove('wc-root', 'is-ready', 'is-fallback', 'is-hovering-tile', 'is-dragging');
  }
}

const LAST_LAYOUT = 'work-canvas:last-version';
const NAME_KEY = /(?:^|;)wc-last=([^;]*)/;

/** The version this visitor saw last: from localStorage, else from window.name (see rememberLayout). */
function lastLayout() {
  try {
    const stored = localStorage.getItem(LAST_LAYOUT);
    if (stored) return stored;
  } catch {
    // storage blocked (private mode, sandboxed iframe, blocked site data)
  }
  return NAME_KEY.exec(window.name || '')?.[1] ?? null;
}

/**
 * The version after the one this visitor saw last (the one on screen when
 * they left, star switches included), so every load shows a different one.
 * null on a first visit.
 */
function rotatedLayout(keys) {
  const i = keys.indexOf(lastLayout());
  return i >= 0 ? keys[(i + 1) % keys.length] : null;
}

function rememberLayout(key) {
  try {
    localStorage.setItem(LAST_LAYOUT, key);
  } catch {
    // storage unavailable: window.name below still carries it across reloads of this tab
  }
  try {
    window.name = `${(window.name || '').replace(new RegExp(NAME_KEY.source, 'g'), '')};wc-last=${key}`;
  } catch {
    // ignore
  }
}
