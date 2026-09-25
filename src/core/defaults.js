/**
 * Shared defaults for every layout. Per-layout configs (top of each file in
 * src/layouts/) override these. Values in "design px" refer to the 1280×794
 * Figma artboard and are scaled to the mount size at runtime.
 */
export const DEFAULTS = {
  // Look (from Figma: Light #F2F2F2, 8px radius, #676767 placeholder blocks)
  background: '#f2f2f2',
  placeholder: '#e2e2e2',
  radius: 8,

  // Renderer
  maxDpr: 2,
  antialias: false, // edges are antialiased in the shader; MSAA isn't needed

  // Video
  maxVideos: 5, // concurrent playing videos (layouts may override)
  mobileVideo: 'focused', // 'focused' = only the featured tile plays on mobile / reduced motion; 'all' = same as desktop

  // Images: tiles upgrade from the thumbnail when rendered larger than this many device px
  upgradeThreshold: { md: 520, lg: 1400 },
  maxTextureEdge: 1280, // px; larger images (e.g. CMS uploads) are downscaled before upload
  maxTextureEdgeMobile: 1024,
  downgradeAfter: 8, // seconds a larger texture can go unused before it's released

  // Input
  click: false, // tiles don't navigate yet — hover (or tap on touch) reveals the title
  tapCaptionFor: 2.5, // s a tapped tile keeps its caption on touch devices
  wheel: 'page', // 'page' = vertical wheel scrolls the page (header reacts to scroll); 'capture' = header consumes the wheel
  clickSlop: 6, // px of pointer travel before a press counts as a drag

  // Transition when opening a project
  openDuration: 0.9,
  openEase: 'power3.inOut',
};

/** Size of the Figma artboard all design px values are relative to. */
export const ARTBOARD = { width: 1280, height: 794 };
