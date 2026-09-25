import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';

gsap.registerPlugin(CustomEase);

/**
 * One motion vocabulary for the whole header.
 *
 * - Things that travel (the tile → project morph, arrow loops) accelerate
 *   hard and take their time to land: an asymmetric curve, not a symmetric
 *   in-out.
 * - Things that answer the cursor (captions) start fast so there's no lag.
 * - Opacity changes are plain, short dissolves. Nothing drifts up while it
 *   fades in, nothing overshoots, nothing zooms on hover.
 *
 * The curves are registered by name, so config strings like
 * `openEase: 'wc-move'` work anywhere GSAP takes an ease.
 */
export const EASE = {
  move: CustomEase.create('wc-move', '0.65,0,0.15,1'),
  out: CustomEase.create('wc-out', '0.2,0.7,0.1,1'),
  in: 'power2.in',
  fade: 'none',
};

/** Same curve as EASE.move, for CSS transitions. */
export const CSS_MOVE = 'cubic-bezier(.65,0,.15,1)';
