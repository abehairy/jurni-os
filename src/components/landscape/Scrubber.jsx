import React from 'react';

/**
 * Timeline scrubber. Slides through weekOffset from `max` (oldest) to 0 (now).
 * The visual scale is natural: left = past, right = now.
 */
export default function Scrubber({ weekOffset, maxOffset, onChange, periodLabel }) {
  const sliderValue = maxOffset - weekOffset;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22,
        padding: '11px 16px',
        background: 'var(--hover-overlay)',
        borderRadius: 10,
        border: '0.5px solid var(--border-strong)',
      }}
    >
      <div style={{
        fontSize: 9, color: 'var(--text-muted)', letterSpacing: 1.8,
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
        fontSize: 10, color: 'var(--text-primary)', whiteSpace: 'nowrap',
        minWidth: 130, textAlign: 'right', letterSpacing: 0.2,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {periodLabel}
      </div>
    </div>
  );
}
