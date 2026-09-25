import * as THREE from 'three';
import gsap from 'gsap';
import { DEFAULTS } from './defaults.js';
import { readItems, ensureAspects } from './data.js';
import { MediaManager } from './media.js';
import { Input } from './input.js';
import { UI, hideLinkLists } from './ui.js';
import { vertexShader, fragmentShader } from './shaders.js';

/**
 * WorkCanvas — the shared core.
 *
 * Owns the renderer, the orthographic pixel-space camera, the render loop,
 * input, resize/visibility handling, media, the DOM overlay and the
 * open-project transition. Layouts (src/layouts/*) only position tiles.
 *
 * Coordinates: layouts work in CSS px from the mount's top-left, y down.
 */
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

    this.isMobile = matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;

    this.viewport = { width: 1, height: 1 };
    this.scale = 1; // set by the active layout; scales radius etc.
    this.dpr = 1;
    this.time = 0;
    this.hovered = null;
    this.pointerUv = new THREE.Vector2(0.5, 0.5);
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

    const initial = this.options.layout && this.layoutDefs.some((l) => l.key === this.options.layout) ? this.options.layout : this.layoutDefs[0].key;
    this.ui = new UI(mount, {
      layouts: this.layoutDefs,
      current: initial,
      onSelect: (key) => this.setLayout(key),
      tagline: this.options.tagline,
      taglineHref: this.options.taglineHref,
      showDots: this.options.switcher && this.layoutDefs.length > 1,
      hint: this.options.hint,
    });
    this.ui.renderFallback(this.items);

    try {
      this.createRenderer();
    } catch (err) {
      console.warn('[work-canvas] WebGL unavailable, keeping the static grid.', err);
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

    this.resize();
    this.start();
    await this.whenThumbsReady();
    mount.classList.add('is-ready');
    await this.setLayout(initial, { initial: true });
    return this;
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

    // One shared, subdivided plane (subdivisions let the vertex bend look smooth).
    this.geometry = new THREE.PlaneGeometry(1, 1, 24, 8);
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
        uHover: { value: 0 },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uDistort: { value: 0.12 },
        uZoom: { value: 0 },
        uShift: { value: 0 },
        uGray: { value: 0 },
        uAlpha: { value: 1 },
        uReveal: { value: 1 },
        uBend: { value: 0 },
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
    const shouldRun = this.inView && this.pageVisible;
    shouldRun ? this.start() : this.stop();
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
  async setLayout(key, { initial = false } = {}) {
    if (this.switching || key === this.layoutKey || !this.renderer) return;
    const def = this.layoutDefs.find((l) => l.key === key);
    if (!def) return;
    this.switching = true;
    this.ui?.setActive(key);
    if (this.options.syncUrl) {
      const url = new URL(location.href);
      url.searchParams.set('v', key);
      history.replaceState(history.state, '', url);
    }

    if (this.layout) {
      await this.layout.leave();
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
      const tile = this.openTile ? null : layout.captionTile();
      const inset = (layout.config.captionInset ?? [20, 12]).map((v) => v * Math.min(1, this.scale));
      this.ui.updateCaption(tile?.onScreen ? tile : null, inset, this.reducedMotion);
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
    if (!p?.inside || this.isMobile) return { nx: 0, ny: 0, inside: false };
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
    } else if (p?.inside && !this.input.pressed?.dragging && !this.openTile && !this.switching && !this.isMobile) {
      const hit = this.pick(p.x, p.y);
      if (hit) {
        next = hit.tile;
        this.pointerUv.copy(hit.uv);
      }
    }
    if (next !== this.hovered) {
      this.hovered = next;
      this.mount.classList.toggle('is-hovering-tile', Boolean(this.options.click && next?.item.href));
    }
  }

  // ─── Open project transition ───────────────────────────────────────────────
  open(tile, event) {
    const href = tile?.item.href;
    if (!href) return false;
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1)) {
      window.open(href, '_blank', 'noopener');
      return true;
    }
    if (this.openTile) return true;

    this.openTile = tile;
    const from = { ...tile.rect, radius: this.radius * this.scale };
    tile.override = from;
    tile.mesh.renderOrder = 10000;
    const { width, height } = this.viewport;
    const duration = this.reducedMotion ? 0.3 : this.options.openDuration;
    const go = () => (window.location.href = href);

    if (this.reducedMotion) {
      gsap.to(this, { openProgress: 1, duration, onComplete: go });
      return true;
    }
    gsap
      .timeline({ defaults: { duration, ease: this.options.openEase }, onComplete: go })
      .to(this, { openProgress: 1, duration: duration * 0.6 }, 0)
      .to(from, { x: 0, y: 0, w: width, h: height, radius: 0 }, 0);
    return true;
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
    const busy = () => this.switching || this.openTile || !this.layout;
    this.input
      .on('drag', (e) => !busy() && this.layout.onDrag?.(e))
      .on('release', (e) => !busy() && this.layout.onRelease?.(e))
      .on('wheel', (e) => !busy() && this.layout.onWheel?.(e))
      .on('scroll', (e) => !busy() && this.inView && this.layout.onScroll?.(e))
      .on('tap', ({ x, y, event }) => {
        if (busy()) return;
        const hit = this.pick(x, y);
        if (this.isMobile && hit) this.tapped = { tile: hit.tile, until: this.time + this.options.tapCaptionFor };
        const handled = this.layout.onTap?.(hit?.tile ?? null, event);
        if (!handled && hit && this.options.click) this.open(hit.tile, event);
      });

    // Back/forward cache: undo the open transition when returning.
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
    this.layout?.resize(this.viewport);
  }

  // ─── Teardown ──────────────────────────────────────────────────────────────
  destroy() {
    this.stop();
    gsap.killTweensOf(this);
    this.resizeObserver?.disconnect();
    this.intersection?.disconnect();
    document.removeEventListener('visibilitychange', this._onVisibility);
    window.removeEventListener('pageshow', this._onPageShow);
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
