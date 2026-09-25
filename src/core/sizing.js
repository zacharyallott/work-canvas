/**
 * Shared tile sizing for layouts whose tiles vary in size (filmstrip, deck).
 *
 * Each tile picks a height from a size scale; its width follows from the
 * image's real aspect ratio. If that makes it too wide or too narrow, the
 * height gives way instead, so images are never cropped unless they're
 * extreme portraits taller than the tallest size.
 */

/**
 * Deterministic sequence of size indexes: seeded random, but never the same
 * size twice in a row (including last → first, for layouts that loop).
 */
export function sizePattern(count, sizes, seed = 1) {
  let a = seed * 0x9e3779b9;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [];
  for (let i = 0; i < count; i++) {
    let k;
    do k = Math.floor(rand() * sizes);
    while (sizes > 1 && (k === out[i - 1] || (i === count - 1 && k === out[0] && sizes > 2)));
    out.push(k);
  }
  return out;
}

/** Width/height for a tile of `aspect` at target `height`, within the width/height limits. */
export function fitSize(aspect, height, { minW, maxW, maxH }) {
  let h = height;
  let w = h * aspect;
  if (w > maxW) [w, h] = [maxW, maxW / aspect];
  if (w < minW) [w, h] = [minW, minW / aspect];
  if (h > maxH) h = maxH; // extreme portraits: crop (cover) rather than tower over everything
  return { w, h };
}
