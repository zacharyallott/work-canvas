import * as THREE from 'three';

/**
 * Media manager: owns every texture and <video> element.
 *
 * Per frame:
 *   beginFrame()      — clears per-frame requests
 *   (tiles call item.request(level, videoPriority) while syncing)
 *   endFrame(now)     — starts image upgrades, releases unused big textures,
 *                       decides which videos play (top-N by priority), and
 *                       uploads at most a couple of textures to the GPU.
 *
 * Images: thumbnail first, upgraded to md/lg when a tile is drawn large or
 * focused. Videos: poster first; the <video> only loads/plays while its tile
 * is on-screen and within the concurrency cap. Off-screen videos are paused.
 */

const LEVELS = ['sm', 'md', 'lg'];
const MAX_PARALLEL_LOADS = 4;
const MAX_UPLOADS_PER_FRAME = 2;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    // Not img.decode(): it can stall indefinitely in background tabs. The upload step decodes anyway.
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Shrinks an image so its long edge is ≤ maxEdge before it goes to the GPU.
 * CMS images can be any size; a 4000px upload would otherwise cost ~90 MB of
 * texture memory. Halves in steps so large reductions stay sharp.
 */
function downscale(img, maxEdge) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!maxEdge || Math.max(w, h) <= maxEdge) return img;
  const k = maxEdge / Math.max(w, h);
  const tw = Math.round(w * k);
  const th = Math.round(h * k);
  let src = img;
  let cw = w;
  let ch = h;
  while (cw / 2 > tw) {
    cw = Math.round(cw / 2);
    ch = Math.round(ch / 2);
    src = draw(src, cw, ch);
  }
  return draw(src, tw, th);
}

function draw(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}

function prepTexture(tex) {
  tex.colorSpace = THREE.NoColorSpace; // passthrough (see shaders.js)
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function canPlay(type) {
  const probe = document.createElement('video');
  return probe.canPlayType(type) !== '';
}

export class MediaItem {
  constructor(data, manager) {
    Object.assign(this, data);
    this.manager = manager;

    this.texture = null; // what tiles should sample right now
    this.texSize = new THREE.Vector2(this.aspect * 100, 100);
    this.ready = false;

    // image levels
    this.textures = []; // index = level
    this.loading = new Set();
    this.failed = new Set();
    this.lastWanted = [0, 0, 0];

    // video
    this.video = null;
    this.videoTexture = null;
    this.playing = false;

    // per-frame aggregation
    this.wantLevel = -1;
    this.priority = 0;
  }

  /** Called by tiles every frame they're on-screen. */
  request(level, priority = 0) {
    if (level > this.wantLevel) this.wantLevel = level;
    if (priority > this.priority) this.priority = priority;
  }

  /** Image level spec { src, maxEdge? }, clamped to what exists. Videos use the poster. */
  levelSpec(level) {
    if (this.type === 'video') return { src: this.poster, maxEdge: 0 };
    const list = this.images.length ? this.images : [{ src: this.poster }];
    return list[Math.min(level, list.length - 1)];
  }

  urlFor(level) {
    return this.levelSpec(level).src;
  }

  /** URL of the largest image already on the GPU (so a DOM copy shows instantly from cache). */
  get bestSrc() {
    if (this.type === 'video') return this.poster;
    for (let l = this.textures.length - 1; l >= 0; l--) if (this.textures[l]) return this.urlFor(l);
    return this.urlFor(0);
  }

  /** srcset built from the known image levels (skips levels without a width). */
  get srcset() {
    const seen = new Set();
    return this.images
      .filter((l) => l.width && !seen.has(l.src) && seen.add(l.src))
      .map((l) => `${l.src} ${l.width}w`)
      .join(', ');
  }

  get maxLevel() {
    return this.type === 'video' ? 0 : Math.max(0, Math.min(LEVELS.length, this.images.length) - 1);
  }

  setTexture(tex, width, height) {
    this.texture = tex;
    this.texSize.set(width, height);
    this.ready = true;
  }

  dispose() {
    this.textures.forEach((t) => t?.dispose());
    this.textures = [];
    this.videoTexture?.dispose();
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.querySelectorAll('source').forEach((s) => s.remove());
      this.video.load(); // releases the network connection + decoder
      this.video = null;
    }
  }
}

export class MediaManager {
  constructor(renderer, { maxVideos = 5, videoPolicy = 'all', downgradeAfter = 8, maxTextureEdge = 1280 } = {}) {
    this.renderer = renderer;
    this.maxTextureEdge = maxTextureEdge;
    this.maxVideos = maxVideos;
    this.videoPolicy = videoPolicy; // 'all' | 'focused'
    this.downgradeAfter = downgradeAfter;
    this.enabled = true; // false while the header is off-screen / tab hidden

    this.items = [];
    this.inFlight = 0;
    this.queue = []; // pending [item, level]
    this.uploads = []; // [item, img, level, maxEdge] waiting for the GPU

    this.av1 = canPlay('video/webm; codecs="av01.0.05M.08"');
  }

  add(data) {
    const item = new MediaItem(data, this);
    this.items.push(item);
    return item;
  }

  /** Kick off thumbnails/posters for everything (they're small). */
  preload() {
    this.items.forEach((item) => item.urlFor(0) && this.enqueue(item, 0));
  }

  enqueue(item, level) {
    if (item.textures[level] || item.loading.has(level) || item.failed.has(level) || !item.urlFor(level)) return;
    item.loading.add(level);
    this.queue.push([item, level]);
    this.pump();
  }

  pump() {
    while (this.inFlight < MAX_PARALLEL_LOADS && this.queue.length) {
      // Highest wanted level first, then the item's on-screen priority.
      this.queue.sort((a, b) => b[0].priority - a[0].priority || a[1] - b[1]);
      const [item, level] = this.queue.shift();
      this.inFlight++;
      const spec = item.levelSpec(level);
      loadImage(spec.src)
        .then((img) => this.uploads.push([item, img, level, spec.maxEdge || this.maxTextureEdge]))
        .catch(() => {
          item.loading.delete(level);
          item.failed.add(level); // don't retry every frame
          console.warn(`[work-canvas] failed to load ${spec.src}`);
        })
        .finally(() => {
          this.inFlight--;
          this.pump();
        });
    }
  }

  beginFrame() {
    for (const item of this.items) {
      item.wantLevel = -1;
      item.priority = 0;
    }
  }

  endFrame(now) {
    // 1. GPU uploads, a couple per frame so big textures don't stall a frame.
    for (let i = 0; i < MAX_UPLOADS_PER_FRAME && this.uploads.length; i++) {
      const [item, img, level, maxEdge] = this.uploads.shift();
      const tex = prepTexture(new THREE.Texture(downscale(img, maxEdge)));
      tex.needsUpdate = true;
      this.renderer.initTexture(tex);
      item.textures[level] = tex;
      item.loading.delete(level);
      // Only show it if it's the best image we have and video isn't already showing.
      const best = item.textures.length - 1;
      if (level >= best && !item.playing) item.setTexture(tex, tex.image.width, tex.image.height);
    }

    if (!this.enabled) return;

    // 2. Image upgrades / downgrades.
    for (const item of this.items) {
      if (item.wantLevel < 0) continue;
      const want = Math.min(item.wantLevel, item.maxLevel);
      for (let l = 0; l <= want; l++) item.lastWanted[l] = now;
      if (!item.textures[want]) this.enqueue(item, want);
    }
    for (const item of this.items) {
      for (let l = item.textures.length - 1; l > 0; l--) {
        const tex = item.textures[l];
        if (tex && now - item.lastWanted[l] > this.downgradeAfter) {
          // Fall back to the best remaining level, then free the big texture.
          const fallback = item.textures.slice(0, l).reverse().find(Boolean);
          if (fallback && item.texture === tex) item.setTexture(fallback, fallback.image.width, fallback.image.height);
          tex.dispose();
          item.textures.length = l;
        }
      }
    }

    // 3. Videos: play the top-N by priority, pause the rest.
    const videos = this.items.filter((i) => i.type === 'video');
    const ranked = videos
      .filter((i) => i.priority > (this.videoPolicy === 'focused' ? 1.5 : 0))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, this.maxVideos);
    for (const item of videos) {
      if (ranked.includes(item)) this.playVideo(item);
      else this.pauseVideo(item);
    }
  }

  playVideo(item) {
    if (!item.video) this.createVideo(item);
    const v = item.video;
    if (v.paused && !v._pending) {
      v._pending = true;
      v.play()
        .catch(() => {}) // autoplay can be refused (e.g. Low Power Mode); the poster stays up
        .finally(() => (v._pending = false));
    }
  }

  pauseVideo(item) {
    if (item.video && !item.video.paused) item.video.pause();
  }

  pauseAll() {
    this.items.forEach((i) => this.pauseVideo(i));
  }

  createVideo(item) {
    const v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.loop = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    for (const s of item.sources) {
      if (s.type.includes('av01') && !this.av1) continue;
      const source = document.createElement('source');
      source.src = s.src;
      source.type = s.type;
      v.appendChild(source);
    }
    // Swap poster → live video once real frames are flowing.
    v.addEventListener('playing', () => {
      if (!item.videoTexture) {
        item.videoTexture = new THREE.VideoTexture(v);
        item.videoTexture.colorSpace = THREE.NoColorSpace;
        item.videoTexture.minFilter = THREE.LinearFilter;
        item.videoTexture.generateMipmaps = false;
      }
      item.playing = true;
      item.setTexture(item.videoTexture, v.videoWidth, v.videoHeight);
    });
    item.video = v;
  }

  dispose() {
    this.items.forEach((i) => i.dispose());
    this.items = [];
    this.queue = [];
    this.uploads = [];
  }
}
