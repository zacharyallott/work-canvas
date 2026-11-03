/**
 * Keeping pieces from the same project apart on the homepage.
 *
 *   shuffleApart(items, key)  a random order with each project's pieces spread as evenly as the mix allows: the
 *                             film strip (two rows, every other piece) and the deck (dealt in order) read it
 *                             straight, and both loop, so the spacing counts around the end too.
 *   placeApart(slots, items, key, period)
 *                             the universe's places, each given a piece so that the same project's pieces sit as
 *                             far apart in the field as they can.
 */

const shuffled = (a) => {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/**
 * Random order with each project's pieces spaced evenly around the loop: a project with c pieces aims them at
 * c points n/c apart from a random start, and everything is sorted by its aim (ties broken at random). Then any
 * two pieces of a project closer than `gap` (as far apart as the biggest project allows, less a little) are fixed
 * by swapping one with a piece elsewhere that leaves both projects at least as far apart as before.
 */
export function shuffleApart(items, key = (m) => m.slug || m.title) {
  const n = items.length;
  if (n < 3) return shuffled(items);
  const groups = new Map();
  for (const m of shuffled(items)) {
    const k = key(m);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const aimed = [];
  for (const g of groups.values()) {
    const start = Math.random();
    g.forEach((m, j) => aimed.push({ m, at: ((start + j) / g.length) % 1, tie: Math.random() }));
  }
  aimed.sort((a, b) => a.at - b.at || a.tie - b.tie);
  const out = aimed.map((a) => a.m);

  // Repair: the closest same-project gap at position i (around the loop).
  const most = Math.max(...[...groups.values()].map((g) => g.length));
  const gap = Math.max(2, Math.floor(n / most) - 1);
  const closest = (i, k = key(out[i])) => {
    let d = Infinity;
    for (let j = 0; j < n; j++) if (j !== i && key(out[j]) === k) d = Math.min(d, Math.abs(i - j), n - Math.abs(i - j));
    return d;
  };
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const before = closest(i);
      if (before >= gap) continue;
      let best = -1;
      let bestGain = 0;
      for (let j = 0; j < n; j++) {
        if (key(out[j]) === key(out[i])) continue;
        const bj = closest(j);
        [out[i], out[j]] = [out[j], out[i]];
        const gain = Math.min(closest(i), closest(j)) - Math.min(before, bj);
        [out[i], out[j]] = [out[j], out[i]];
        if (gain > bestGain) {
          bestGain = gain;
          best = j;
        }
      }
      if (best >= 0) {
        [out[i], out[best]] = [out[best], out[i]];
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

const compare = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -Infinity) - (b[i] ?? -Infinity);
    if (d) return d;
  }
  return 0;
};

/**
 * One piece per slot ({ x, y } in field units, wrapping every `period.x` / `period.y`): every piece once while
 * any is left over, then copies. Slots are filled far-apart first; each takes the piece whose project is furthest
 * from where it already sits (counted up to `enough` — beyond that, they're all far enough, and the project with
 * the most pieces still to place goes first). Returns the piece index for each slot.
 */
export function placeApart(slots, items, key = (m) => m.slug || m.title, period = { x: Infinity, y: Infinity }, enough = Infinity) {
  const n = slots.length;
  const m = items.length;
  const dist = (a, b) => {
    let dx = Math.abs(a.x - b.x) % period.x;
    let dy = Math.abs(a.y - b.y) % period.y;
    if (Number.isFinite(period.x)) dx = Math.min(dx, period.x - dx);
    if (Number.isFinite(period.y)) dy = Math.min(dy, period.y - dy);
    return Math.hypot(dx, dy);
  };
  // Fill order: a random first slot, then always the slot furthest from those filled (spreads the early choices).
  const order = [Math.floor(Math.random() * n)];
  const near = slots.map((s) => dist(s, slots[order[0]]));
  near[order[0]] = -1;
  while (order.length < n) {
    let next = 0;
    for (let i = 1; i < n; i++) if (near[i] > near[next]) next = i;
    order.push(next);
    near[next] = -1;
    for (let i = 0; i < n; i++) if (near[i] >= 0) near[i] = Math.min(near[i], dist(slots[i], slots[next]));
  }

  const keys = items.map(key);
  const unused = new Set(shuffled([...Array(m).keys()]));
  const left = new Map(); // project → pieces not yet placed
  keys.forEach((k) => left.set(k, (left.get(k) ?? 0) + 1));
  const placed = new Map(); // project → slots it sits in
  const uses = new Array(m).fill(0);
  const out = new Array(n);
  for (const s of order) {
    const room = (k) => Math.min(enough, ...(placed.get(k) ?? []).map((t) => dist(slots[s], slots[t])));
    const pool = unused.size ? [...unused] : [...Array(m).keys()];
    let best = -1;
    let bestScore = null;
    for (const i of pool) {
      const k = keys[i];
      const score = [room(k), left.get(k), -uses[i], Math.random()];
      if (!bestScore || compare(score, bestScore) > 0) {
        best = i;
        bestScore = score;
      }
    }
    out[s] = best;
    uses[best]++;
    if (unused.delete(best)) left.set(keys[best], left.get(keys[best]) - 1);
    if (!placed.has(keys[best])) placed.set(keys[best], []);
    placed.get(keys[best]).push(s);
  }
  return out;
}
