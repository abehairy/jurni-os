import React, { useEffect, useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, RefreshCw } from 'lucide-react';
import { squarify } from '../lib/squarify';
import Tile from '../components/landscape/Tile';
import DrillDrawer from '../components/landscape/DrillDrawer';
import Scrubber from '../components/landscape/Scrubber';
import { paletteFor } from '../lib/landscape-theme';

const RANGES = [
  { id: '1w', label: '1W' },
  { id: '4w', label: '4W' },
  { id: '12w', label: '12W' },
  { id: '1y', label: '1Y' },
];

const GROUPS = [
  { id: 'topic', label: 'Topics' },
  { id: 'category', label: 'Domains' },
  { id: 'people', label: 'People' },
  { id: 'time', label: 'Timeline' },
];

export default function LifeLandscape({ api, onGoToSettings, pins = [], onPinsChanged, pinToOpen, onPinOpened }) {
  const [range, setRange] = useState('4w');
  const [group, setGroup] = useState('topic');
  const [weekOffset, setWeekOffset] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTile, setActiveTile] = useState(null);
  const [recatRunning, setRecatRunning] = useState(false);
  const [recatProgress, setRecatProgress] = useState(null);
  const [identity, setIdentity] = useState(null);
  // 'full' = treemap + drawer. 'focused' = only drawer (entered via pin click).
  // Tile clicks keep us in 'full'; only sidebar pin clicks flip to 'focused'.
  const [viewMode, setViewMode] = useState('full');

  // Build a lookup of pinned keys for the current group mode so the drawer
  // can show the pin as filled/outline instantly.
  const pinnedKeysForGroup = useMemo(() => {
    const s = new Set();
    for (const p of pins) {
      if (p.groupMode === group) s.add(p.tileKey);
    }
    return s;
  }, [pins, group]);

  // Respond to sidebar pin clicks: switch group if needed, enter focused
  // mode (drawer-only, no landscape behind it), open the drawer.
  useEffect(() => {
    if (!pinToOpen) return;
    if (pinToOpen.groupMode && pinToOpen.groupMode !== group) {
      setGroup(pinToOpen.groupMode);
    }
    setActiveTile({
      key: pinToOpen.tileKey,
      label: pinToOpen.label,
      category: pinToOpen.category,
      pctOfTotal: 0,
      changePct: 0,
      tone: null,
      count: 0,
    });
    setViewMode('focused');
    onPinOpened?.();
  }, [pinToOpen]);

  const exitFocused = () => {
    setViewMode('full');
    setActiveTile(null);
  };

  // When landscape data refreshes and we have an activeTile, upgrade it with
  // the full tile object if present — keeps the drawer numbers accurate.
  useEffect(() => {
    if (!activeTile || !data?.tiles) return;
    const match = data.tiles.find(t => t.key === activeTile.key);
    if (match && match !== activeTile) setActiveTile(match);
  }, [data]);

  useEffect(() => {
    api.getUserIdentity?.().then(setIdentity).catch(() => {});
  }, [api]);

  const gridRef = useRef(null);
  const [gridSize, setGridSize] = useState({ width: 1000, height: 560 });

  // Fetch landscape data when params change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getLandscape({ range, group, weekOffset }).then(d => {
      if (!cancelled) { setData(d); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, group, weekOffset]);

  // React to live updates (new conversations, recategorization, etc.)
  useEffect(() => {
    const off1 = api.onLandscapeUpdated?.(() => {
      api.getLandscape({ range, group, weekOffset }).then(setData).catch(() => {});
    });
    const off2 = api.onNewMoment?.(() => {
      // Debounce-ish: refetch after 1.5s so it doesn't thrash
      setTimeout(() => {
        api.getLandscape({ range, group, weekOffset }).then(setData).catch(() => {});
      }, 1500);
    });
    const off3 = api.onRecatProgress?.((p) => {
      setRecatProgress(p);
      if (p.stage === 'complete' || p.stage === 'error') {
        setRecatRunning(false);
        api.getLandscape({ range, group, weekOffset }).then(setData).catch(() => {});
      }
    });
    return () => { off1?.(); off2?.(); off3?.(); };
  }, [api, range, group, weekOffset]);

  // Measure grid container for treemap sizing.
  // Re-runs when viewMode flips back to 'full' so the observer re-attaches to
  // the fresh grid DOM node (otherwise after a focused detour the grid would
  // be rendered with a stale 0x0 measurement and no tiles would appear).
  useEffect(() => {
    if (viewMode !== 'full') return;
    if (!gridRef.current) return;
    const el = gridRef.current;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setGridSize({ width: rect.width, height: rect.height });
      }
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      setGridSize({ width: r.width, height: r.height });
    }
    return () => ro.disconnect();
  }, [viewMode]);

  // Compute squarified layout
  const layout = useMemo(() => {
    if (!data || !data.tiles || data.tiles.length === 0) return [];
    const items = data.tiles.map(t => ({ value: Math.max(1, t.count), tile: t }));
    return squarify(
      { width: gridSize.width, height: gridSize.height, padding: 4 },
      items,
    );
  }, [data, gridSize.width, gridSize.height]);

  const maxOffset = 12; // up to 12 weeks back; could make dynamic later
  const periodLabel = useMemo(() => formatPeriodLabel(data?.period), [data]);

  const threadStats = data?.threadStats;
  const needsRecat = threadStats && threadStats.pending > 0 && threadStats.total > 0;
  const hasTiles = data && data.tiles && data.tiles.length > 0;

  const handleRecat = async () => {
    setRecatRunning(true);
    setRecatProgress({ stage: 'start', processed: 0, total: threadStats?.pending || 0, unit: 'threads' });
    try {
      await api.recategorizeMoments();
    } catch {
      setRecatRunning(false);
    }
  };

  const handleTogglePin = async (tile) => {
    if (!tile) return;
    const payload = { tileKey: tile.key, groupMode: group };
    const alreadyPinned = pinnedKeysForGroup.has(tile.key);
    try {
      if (alreadyPinned) {
        await api.removePin?.(payload);
      } else {
        const pal = paletteFor(tile.category);
        await api.addPin?.({
          ...payload,
          label: tile.label,
          category: tile.category,
          colorHex: pal?.accent,
        });
      }
      onPinsChanged?.();
    } catch (e) {
      console.error('Pin toggle failed:', e);
    }
  };

  if (viewMode === 'focused' && activeTile) {
    return (
      <div style={{
        background: 'var(--surface)',
        minHeight: 'calc(100vh - 32px)',
        padding: '24px 40px 48px',
        color: 'var(--text-primary)',
        fontFamily: 'DM Sans, system-ui, sans-serif',
      }}>
        {/* Focused mode = the only thing on the page. Give it real width
            (caps at ~1000px so prose still reads at comfortable line length). */}
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <button
            onClick={exitFocused}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', marginBottom: 18,
              background: 'transparent',
              border: '0.5px solid var(--border-strong)',
              borderRadius: 20,
              color: 'var(--text-muted)',
              fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              letterSpacing: 0.2, transition: 'all 0.12s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.background = 'var(--hover-overlay)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--text-muted)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            ← Landscape
          </button>

          <DrillDrawer
            api={api}
            tile={activeTile}
            range={range}
            weekOffset={weekOffset}
            group={group}
            isPinned={pinnedKeysForGroup.has(activeTile.key)}
            onTogglePin={() => handleTogglePin(activeTile)}
            onClose={exitFocused}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--surface)',
      minHeight: 'calc(100vh - 32px)',
      padding: '18px 40px 40px',
      color: 'var(--text-primary)',
      fontFamily: 'DM Sans, system-ui, sans-serif',
    }}>
      {/* Hero: the narrative IS the title. When data's not ready yet,
          a quiet time-anchored greeting fills the space so the top is never empty. */}
      <Hero data={data} loading={loading} range={range} />

      {identity && !identity.name && (
        <IdentityBanner onClick={onGoToSettings} />
      )}

      <ChipsRow
        range={range} setRange={setRange}
        group={group} setGroup={setGroup}
        onRecat={needsRecat ? handleRecat : null}
        recatRunning={recatRunning}
        recatProgress={recatProgress}
        threadStats={threadStats}
      />

      <Scrubber
        weekOffset={weekOffset}
        maxOffset={maxOffset}
        onChange={(v) => { setWeekOffset(v); setActiveTile(null); }}
        periodLabel={periodLabel}
      />

      <div
        ref={gridRef}
        style={{
          position: 'relative',
          width: '100%',
          height: '56vh',
          minHeight: 420,
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {loading && !hasTiles && <LoadingShimmer />}

        {!loading && !hasTiles && (
          <EmptyState
            threadStats={threadStats}
            onRecat={handleRecat}
            recatRunning={recatRunning}
            recatProgress={recatProgress}
          />
        )}

        <AnimatePresence>
          {hasTiles && layout.map((rect) => (
            <Tile
              key={rect.item.tile.key}
              tile={rect.item.tile}
              x={rect.x}
              y={rect.y}
              w={rect.w}
              h={rect.h}
              dimmed={activeTile && activeTile.key !== rect.item.tile.key}
              onClick={() => {
                setActiveTile(activeTile?.key === rect.item.tile.key ? null : rect.item.tile);
              }}
            />
          ))}
        </AnimatePresence>
      </div>

      <DrillDrawer
        api={api}
        tile={activeTile}
        range={range}
        weekOffset={weekOffset}
        group={group}
        isPinned={activeTile ? pinnedKeysForGroup.has(activeTile.key) : false}
        onTogglePin={activeTile ? () => handleTogglePin(activeTile) : null}
        onClose={() => setActiveTile(null)}
      />

      <Footer data={data} />
    </div>
  );
}

// ---------- Sub-components ----------

/**
 * The landscape has no page title anymore — the narrative is the title.
 * When data isn't ready (first boot, re-sync, empty range), fall back to
 * a calm time-anchored greeting so the top of the screen is never empty.
 */
function Hero({ data, loading, range }) {
  const narrative = useMemo(() => {
    if (!data || !data.tiles || data.tiles.length === 0) return null;
    return narrateLandscape(data);
  }, [data]);

  const text = narrative || fallbackGreeting(range, loading);

  return (
    <motion.div
      key={text}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{
        fontFamily: 'Georgia, serif', fontStyle: 'italic',
        fontSize: narrative ? 22 : 20,
        color: narrative ? 'var(--text-primary)' : 'var(--text-muted)',
        lineHeight: 1.4, marginBottom: 22, maxWidth: 720,
        letterSpacing: -0.2,
      }}
    >
      {text}
    </motion.div>
  );
}

function fallbackGreeting(range, loading) {
  if (loading) return 'Reading the landscape…';
  const hour = new Date().getHours();
  const time =
    hour < 5 ? 'Late night' :
    hour < 12 ? 'Good morning' :
    hour < 18 ? 'Good afternoon' :
    'Good evening';
  const scope =
    range === '1w' ? 'this week' :
    range === '4w' ? 'the past month' :
    range === '12w' ? 'the past quarter' :
    'the past year';
  return `${time}. Here's ${scope}.`;
}

function IdentityBanner({ onClick }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      style={{
        width: '100%', marginBottom: 14, padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--accent-soft)',
        border: '0.5px solid var(--accent-soft-strong)',
        borderRadius: 10,
        color: 'var(--text-primary)', textAlign: 'left', cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <Sparkles size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
          Jurni doesn't know who you are yet
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          Your own name is showing up as a topic or a peer. Set your identity in Settings so the landscape knows you're the narrator.
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0 }}>
        Open Settings →
      </div>
    </motion.button>
  );
}

function ChipsRow({ range, setRange, group, setGroup, onRecat, recatRunning, recatProgress, threadStats }) {
  return (
    <div style={{
      display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14,
      alignItems: 'center',
    }}>
      <Label>Range</Label>
      {RANGES.map(r => (
        <Chip key={r.id} active={range === r.id} onClick={() => setRange(r.id)}>
          {r.label}
        </Chip>
      ))}

      <Divider />

      <Label>Group by</Label>
      {GROUPS.map(g => (
        <Chip key={g.id} active={group === g.id} onClick={() => setGroup(g.id)}>
          {g.label}
        </Chip>
      ))}

      {onRecat && (
        <>
          <div style={{ flex: 1 }} />
          <RecatButton
            onClick={onRecat}
            running={recatRunning}
            progress={recatProgress}
            threadStats={threadStats}
          />
        </>
      )}
    </div>
  );
}

function Label({ children }) {
  return (
    <div style={{
      fontSize: 9, color: 'var(--text-muted)', letterSpacing: 1.8,
      textTransform: 'uppercase', marginRight: 4, fontWeight: 500,
    }}>{children}</div>
  );
}

function Chip({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11, padding: '5px 12px',
        border: `0.5px solid ${active ? 'var(--accent-soft-strong)' : 'var(--border-strong)'}`,
        borderRadius: 20,
        background: active ? 'var(--accent-soft-strong)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        letterSpacing: 0.2,
        transition: 'all 0.12s ease',
      }}
      onMouseEnter={e => {
        if (!active) e.currentTarget.style.background = 'var(--hover-overlay)';
      }}
      onMouseLeave={e => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <div style={{
      width: 1, height: 20, background: 'var(--border-strong)', margin: '0 8px',
    }} />
  );
}

function RecatButton({ onClick, running, progress, threadStats }) {
  if (progress?.stage === 'error') {
    return (
      <div
        title={progress.error || 'Stopped due to error'}
        style={{
          fontSize: 10, color: '#D88A8A', letterSpacing: 0.3,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 12px',
          border: '0.5px solid rgba(216,138,138,0.35)',
          borderRadius: 20,
          maxWidth: 360,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {progress.error?.includes('credits')
            ? 'Out of OpenRouter credits — add credits to continue'
            : 'Categorization stopped'}
        </span>
      </div>
    );
  }
  if (running && progress) {
    const pct = progress.total ? Math.round((progress.processed / progress.total) * 100) : 0;
    const unit = progress.unit || 'threads';
    return (
      <div style={{
        fontSize: 10, color: 'var(--accent)', letterSpacing: 0.3,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 12px',
        border: '0.5px solid var(--accent-soft-strong)',
        borderRadius: 20,
      }}>
        <RefreshCw size={11} className="animate-spin" />
        <span>Reading · {progress.processed}/{progress.total} {unit}</span>
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11, padding: '5px 12px',
        border: '0.5px solid var(--accent-soft-strong)',
        borderRadius: 20,
        background: 'var(--accent-soft)',
        color: 'var(--accent)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', gap: 6,
      }}
    >
      <Sparkles size={11} />
      Read {threadStats?.pending || 0} threads
    </button>
  );
}

function Footer({ data }) {
  if (!data) return null;
  const total = data.tiles?.reduce((s, t) => s + t.count, 0) || 0;
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      marginTop: 18, paddingTop: 16,
      borderTop: '0.5px solid var(--border-strong)',
      fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1.5,
      textTransform: 'uppercase',
    }}>
      <div>{total} messages · {data.tiles?.length || 0} topics</div>
      <div>{data.period?.group || 'topic'} view</div>
    </div>
  );
}

function LoadingShimmer() {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <motion.div
        animate={{ opacity: [0.3, 0.7, 0.3] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          fontSize: 11, letterSpacing: 2, color: 'var(--text-muted)',
          textTransform: 'uppercase',
        }}
      >
        Reading the landscape...
      </motion.div>
    </div>
  );
}

function EmptyState({ threadStats, onRecat, recatRunning, recatProgress }) {
  const hasData = threadStats && threadStats.total > 0;
  const needsRecat = hasData && threadStats.pending > 0;

  if (recatRunning && recatProgress) {
    const pct = recatProgress.total ? (recatProgress.processed / recatProgress.total) : 0;
    const unit = recatProgress.unit || 'threads';
    return (
      <div style={{
        position: 'absolute', inset: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
        gap: 18, padding: 40,
      }}>
        <div style={{
          fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 22,
          color: 'var(--text-primary)', textAlign: 'center',
        }}>
          Reading your conversations...
        </div>
        <div style={{
          width: 320, height: 2, background: 'var(--border-strong)',
          borderRadius: 2, overflow: 'hidden',
        }}>
          <motion.div
            animate={{ width: `${pct * 100}%` }}
            transition={{ duration: 0.3 }}
            style={{ height: '100%', background: 'var(--accent)', borderRadius: 2 }}
          />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 0.5 }}>
          {recatProgress.processed} / {recatProgress.total} {unit}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex',
      alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
      gap: 20, padding: 40, textAlign: 'center',
    }}>
      <div style={{
        fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 22,
        color: 'var(--text-primary)', maxWidth: 420, lineHeight: 1.5,
      }}>
        {hasData
          ? 'Your conversations are captured, but the landscape is still being drawn.'
          : 'Your landscape will form as your conversations come in.'}
      </div>

      <div style={{
        fontSize: 12, color: 'var(--text-muted)', maxWidth: 400, lineHeight: 1.6,
      }}>
        {hasData
          ? `${threadStats.done} of ${threadStats.total} threads mapped so far.`
          : 'Connect Claude or ChatGPT from Settings, or import a conversation archive.'}
      </div>

      {needsRecat && (
        <button
          onClick={onRecat}
          style={{
            fontSize: 12, padding: '9px 18px',
            background: 'var(--accent-soft-strong)',
            border: '0.5px solid var(--accent-soft-strong)',
            borderRadius: 24, color: 'var(--text-primary)',
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 6,
          }}
        >
          <Sparkles size={13} />
          Read {threadStats.pending} conversations
        </button>
      )}
    </div>
  );
}

// ---------- Helpers ----------

function formatPeriodLabel(period) {
  if (!period) return '';
  try {
    const end = new Date(period.end);
    return `Through ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  } catch {
    return '';
  }
}

/**
 * Build a narrative caption from the landscape data.
 *
 * Rule of thumb: name the dominant topic, call out the biggest riser, and
 * flag the biggest faller if meaningful. Keep it short (one sentence).
 *
 * We compose locally instead of calling the LLM for every view-change to
 * keep the UI instant. An LLM-generated poetic line could be layered on
 * later (weekly, cached).
 */
function narrateLandscape(data) {
  const tiles = data.tiles || [];
  if (tiles.length === 0) return null;

  const sorted = [...tiles].sort((a, b) => b.count - a.count);
  const dominant = sorted[0];

  const risers = [...tiles].filter(t => t.changePct > 0.2).sort((a, b) => b.changePct - a.changePct);
  const fallers = [...tiles].filter(t => t.changePct < -0.2).sort((a, b) => a.changePct - b.changePct);

  const parts = [];
  parts.push(`${dominant.label} is the center of gravity`);
  if (dominant.tone) parts[0] += ` — ${dominant.tone.toLowerCase()}`;
  parts[0] += '.';

  if (risers.length > 0 && risers[0].key !== dominant.key) {
    parts.push(`${risers[0].label} is rising (${Math.round(risers[0].changePct * 100)}%).`);
  }

  if (fallers.length > 0) {
    parts.push(`${fallers[0].label} is fading.`);
  }

  return parts.join(' ');
}
