import * as THREE from 'three';

/**
 * A tile is one on-screen plane showing one MediaItem. Several tiles can share
 * an item (e.g. masonry repeats items to fill its columns).
 *
 * Layouts write the public fields every frame (x, y, w, h in CSS px from the
 * mount's top-left; z for stacking; plus the look fields below), then the
 * engine calls sync() to push them into the mesh + uniforms and to request
 * media for the tile.
 *
 * Video priority convention (see MediaManager):
 *   0      off-screen
 *   0–1    on-screen, higher = closer to the focus point
 *   2      featured (caption tile)
 *   3      hovered / front card
 */
export class Tile {
  constructor(engine, item, index = 0) {
    this.engine = engine;
    this.item = item;
    this.index = index; // position within the layout's tile list

    // Layout-controlled state
    this.x = 0;
    this.y = 0;
    this.w = 100;
    this.h = 100;
    this.z = 0;
    this.rotation = 0; // radians
    this.alpha = 1;
    this.reveal = 1;
    this.gray = 0;
    this.zoom = 0;
    this.priority = 0;
    this.interactive = true;

    // Engine-controlled
    this.hover = 0; // eased 0..1
    this.texReady = 0;
    this.onScreen = false;
    this.override = null; // { x, y, w, h, radius } used by the open-project transition

    this.material = engine.baseMaterial.clone();
    // clone() copies uniform values but textures/vectors must be unique per tile
    this.uniforms = this.material.uniforms;
    this.uniforms.uSize.value = new THREE.Vector2(100, 100);
    this.uniforms.uShift.value = new THREE.Vector2(0, 0);
    this.uniforms.uTexSize.value = item.texSize;

    this.mesh = new THREE.Mesh(engine.geometry, this.material);
    this.mesh.frustumCulled = false; // visibility is decided in sync()
    this.mesh.userData.tile = this;
    engine.scene.add(this.mesh);
  }

  /** Screen-space rect actually drawn (override wins during the open transition). */
  get rect() {
    return this.override ?? this;
  }

  sync(dt, viewport, hoverCfg) {
    // Ease hover + texture fade.
    const k = 1 - Math.exp(-dt * (hoverCfg?.speed ?? 8));
    const hovered = this.engine.hovered === this;
    this.hover += ((hovered ? 1 : 0) - this.hover) * k;
    this.texReady += ((this.item.ready ? 1 : 0) - this.texReady) * (1 - Math.exp(-dt * 6));

    // Hover expansion (tiles with a project view): the frame grows `expand` px per side around its centre while
    // the picture keeps its size on screen, so the frame opens up to show more of it. At rest the picture is
    // cropped in by as much (it's sized to cover the fully grown frame). Not on touch screens (no hover to open it).
    // `expandDir` ('up' / 'down', set by the layout): the frame grows out to the sides and that way only (the other
    // edge stays put), `expand` px each way; without it, every way.
    let { x, y, w, h } = this.rect;
    const e = this.engine;
    const grow = this.override || e.reducedMotion || e.touch || !this.item.caseStudy ? 0 : hoverCfg?.expand ?? 0;
    let fill = 0;
    let shiftY = 0;
    if (grow > 0) {
      const dir = this.expandDir;
      const tex = this.item.texSize;
      const cover = (cw, ch) => Math.max(cw / tex.x, ch / tex.y);
      const tall = dir ? grow : grow * 2; // the frame's full extra height
      const full = cover(w + grow * 2, h + tall);
      const g = grow * this.hover;
      x -= g;
      if (dir !== 'down') y -= g;
      w += g * 2;
      h += dir ? g : g * 2;
      fill = full / cover(w, h) - 1;
      // Growing one way only, the picture stays centred on the fully grown frame: off this frame's centre, that way,
      // by half the height still to come (frame uv, y up).
      const ahead = (tall - (h - this.rect.h)) / 2 / h;
      if (dir) shiftY = dir === 'down' ? -ahead : ahead;
    }
    this.uniforms.uShift.value.set(0, shiftY);
    this.drawn = { x, y, w, h }; // what's on screen (the open transition starts from it)

    const margin = Math.max(viewport.width, viewport.height) * 0.25;
    this.onScreen =
      this.alpha > 0.001 &&
      x + w > -margin &&
      x < viewport.width + margin &&
      y + h > -margin &&
      y < viewport.height + margin;

    this.mesh.visible = this.onScreen;
    if (!this.onScreen) return;

    // Transform: plane is 1×1 centred, camera is y-down pixel space (see engine).
    const opening = this.engine.openTile;
    this.mesh.position.set(x + w / 2, -(y + h / 2), 0);
    this.mesh.scale.set(w, h, 1);
    this.mesh.rotation.z = -(this.override ? this.override.rotation ?? 0 : this.rotation); // clockwise on screen
    // Depth test is off; order = stacking. A hovered tile that grows sits above its neighbours while hovered (or while
    // its layout says it's the raised one: `lifted`, e.g. the universe's raise delay).
    this.mesh.renderOrder = opening === this && this.engine.openRaised ? 10000 : this.z + ((this.lifted ?? hovered) && grow > 0 ? 1e6 : 0);

    const u = this.uniforms;
    u.uSize.value.set(w, h);
    u.uTex.value = this.item.texture ?? this.engine.emptyTexture;
    u.uTexSize.value = this.item.texSize;
    u.uTexReady.value = this.item.ready ? this.texReady : 0;
    u.uRadius.value = this.override?.radius ?? this.engine.radius; // fixed CSS px, not scaled
    u.uDpr.value = this.engine.dpr;
    u.uAlpha.value = this.alpha * (opening && opening !== this ? 1 - this.engine.openProgress : 1);
    u.uReveal.value = this.reveal;
    u.uGray.value = this.gray;
    const hoverZoom = this.engine.reducedMotion ? 0 : this.hover * (hoverCfg?.zoom ?? 0);
    u.uZoom.value = this.zoom + hoverZoom + fill;

    // Media requests: pick an image level from the drawn size in device px.
    const devicePx = Math.max(w, h) * this.engine.dpr;
    const t = this.engine.upgradeThreshold;
    let level = devicePx > t.lg ? 2 : devicePx > t.md ? 1 : 0;
    if (this.priority >= 3 && devicePx > t.md * 0.8) level = Math.max(level, 2);
    this.item.request(level, this.priority);
  }

  dispose() {
    this.engine.scene.remove(this.mesh);
    this.material.dispose();
  }
}
