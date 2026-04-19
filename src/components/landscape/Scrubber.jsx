import React from 'react';

/**
 * Timeline scrubber. Slides through weekOffset from `max` (oldest) to 0 (now).
 * The visual scale is natural: left = past, right = now.
 */
export default function Scrubber({ weekOffset, maxOffset, onChange, periodLabel }) {
  // weekOffset: 0 = now, maxOffset = farthest back
  // Slider value: maxOffset - weekOffset → left is past, right is now
  const sliderValue = maxOffset - weekOffset;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22,
        padding: '11px 16px',
        background: 'rgba(245,235,216,0.04)',
        borderRadius: 10,
        border: '0.5px solid rgba(245,235,216,0.08)',
      }}
    >
      <div style={{
        fontSize: 9, color: '#8B7A5E', letterSpacing: 1.8,
        textTransform: 'uppercase', whiteSpace: 'nowrap', fontWeight: 500,
      }}>
        Scrub
      </div>
      <input
        type="range"
        min={0}
        max={maxOffset}
        value={sliderValue}
        onChange={(e) => onChange(maxOffset - parseInt(e.target.value, 10))}
        className="jl-scrubber"
        style={{ flex: 1 }}
      />
      <div style={{
        fontSize: 10, color: '#D4C4A8', whiteSpace: 'nowrap',
        minWidth: 130, textAlign: 'right', letterSpacing: 0.2,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {periodLabel}
      </div>
    </div>
  );
}
