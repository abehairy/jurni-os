import React from 'react';

/**
 * Tiny inline sparkline — 12 points, drawn as a subtle path.
 * No axes, no labels. Meant to live inside a tile as ambient texture.
 */
export default function Sparkline({ data, color = 'rgba(255,230,200,0.35)', width = 60, height = 14 }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const step = width / (data.length - 1 || 1);
  const points = data.map((v, i) => {
    const x = i * step;
    const y = height - (v / max) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', opacity: 0.55 }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
