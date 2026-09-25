/**
 * Shared defaults for every layout. Per-layout configs (top of each file in
 * src/layouts/) override these. Values in "design px" refer to the 1280×794
 * Figma artboard and are scaled to the mount size at runtime.
 */
export const DEFAULTS = {
  // Look (Figma: Light #F2F2F2, #676767 placeholder blocks; radius reduced from the frame's 8px to 4px)
  background: '#f2f2f2',
  placeholder: '#e2e2e2',
  radius: 4, // corner radius in CSS px (fixed at every screen size)

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

  // Project pages: each case study also has its own page at `${projectBase}<slug>` (the Webflow CMS template)
  projectBase: '/work/',
  homePath: '/',
  aboutPath: '/about', // the about section's own page (same header, opens with the about section)
  siteName: 'zachary allott', // project titles become "<Project> — <siteName>", the about section "About — <siteName>"
  homeTitle: 'zachary allott — brand design & art direction', // title when returning to the work from /about or a project page

  // Transition when opening a project (eases are registered in motion.js)
  openDuration: 0.75,
  openEase: 'wc-move', // quick to leave, slow to land
};

/** Size of the Figma artboard all design px values are relative to. */
export const ARTBOARD = { width: 1280, height: 794 };
