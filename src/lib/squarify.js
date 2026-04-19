/**
 * Squarified treemap layout.
 *
 * Bruls, Huijbregts, van Wijk (2000). Produces rectangles with good aspect
 * ratios (close to 1:1) for weighted items, laid out inside a parent rect.
 *
 * This is pure geometry — no DOM. Call it with { width, height, items } where
 * each item has a `value` > 0. Returns an array of rects { x, y, w, h, item }.
 */

function worst(row, w) {
  // w = length of the side we're laying out along.
  // Returns the worst aspect ratio of any rectangle in the row.
  const s = row.reduce((a, b) => a + b.value, 0);
  const rMax = Math.max(...row.map(r => r.value));
  const rMin = Math.min(...row.map(r => r.value));
  const s2 = s * s;
  const w2 = w * w;
  return Math.max((w2 * rMax) / s2, s2 / (w2 * rMin));
}

function layoutRow(row, rect, horizontal) {
  const s = row.reduce((a, b) => a + b.value, 0);
  const results = [];
  if (horizontal) {
    // Row fills full width along x, fixed height based on area
    const h = s / rect.w;
    let x = rect.x;
    for (const item of row) {
      const w = item.value / h;
      results.push({ x, y: rect.y, w, h, item: item.source });
      x += w;
    }
    return { rects: results, remaining: { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h } };
  } else {
    // Column fills full height along y, fixed width
    const w = s / rect.h;
    let y = rect.y;
    for (const item of row) {
      const h = item.value / w;
      results.push({ x: rect.x, y, w, h, item: item.source });
      y += h;
    }
    return { rects: results, remaining: { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h } };
  }
}

/**
 * @param {{width:number,height:number,padding?:number}} rect
 * @param {Array<{value:number}>} items  Must be sorted descending by value for best results.
 */
export function squarify({ width, height, padding = 0 }, items) {
  const total = items.reduce((a, b) => a + (b.value || 0), 0);
  if (total <= 0 || width <= 0 || height <= 0 || items.length === 0) return [];

  // Scale values so sum equals rect area
  const area = width * height;
  const scale = area / total;
  const scaled = items
    .filter(i => i.value > 0)
    .map(i => ({ value: i.value * scale, source: i }))
    .sort((a, b) => b.value - a.value);

  const placed = [];
  let rect = { x: 0, y: 0, w: width, h: height };

  let i = 0;
  while (i < scaled.length) {
    const row = [scaled[i]];
    let shortSide = Math.min(rect.w, rect.h);
    const horizontal = rect.w >= rect.h;

    // Greedily extend the row while aspect ratios don't get worse
    while (i + row.length < scaled.length) {
      const candidate = scaled[i + row.length];
      const newRow = [...row, candidate];
      if (worst(newRow, shortSide) <= worst(row, shortSide)) {
        row.push(candidate);
      } else {
        break;
      }
    }

    const { rects, remaining } = layoutRow(row, rect, !horizontal);
    // ^^ if rect is wider than tall (horizontal==true), we lay a column (vertical strip). Invert.
    placed.push(...rects);
    rect = remaining;
    i += row.length;
  }

  // Apply padding (inset each rect)
  if (padding > 0) {
    return placed.map(r => ({
      x: r.x + padding / 2,
      y: r.y + padding / 2,
      w: Math.max(0, r.w - padding),
      h: Math.max(0, r.h - padding),
      item: r.item,
    }));
  }
  return placed;
}
