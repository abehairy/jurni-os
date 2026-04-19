import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { paletteFor, formatChangePct } from '../../lib/landscape-theme';

/**
 * The drill-down drawer that reveals the stories behind a tile.
 * Slides up from below the treemap when a tile is clicked.
 */
export default function DrillDrawer({ api, tile, range, weekOffset, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [briefing, setBriefing] = useState(null);
  const [briefingLoading, setBriefingLoading] = useState(false);

  useEffect(() => {
    if (!tile) { setDetail(null); setBriefing(null); return; }
    let cancelled = false;
    setLoading(true);
    api.getTileDetail({
      key: tile.key,
      group: 'topic',
      range,
      weekOffset,
    }).then(d => {
      if (!cancelled) { setDetail(d); setLoading(false); }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    // Briefing runs in parallel — if it comes back null, section hides silently.
    setBriefing(null);
    setBriefingLoading(true);
    if (typeof api.getTileBriefing === 'function') {
      api.getTileBriefing({
        key: tile.key,
        group: 'topic',
        range,
        weekOffset,
        category: tile.category,
        label: tile.label,
        tone: tile.tone,
        pctOfTotal: tile.pctOfTotal,
        changePct: tile.changePct,
      }).then(b => {
        if (!cancelled) { setBriefing(b); setBriefingLoading(false); }
      }).catch(() => {
        if (!cancelled) setBriefingLoading(false);
      });
    } else {
      setBriefingLoading(false);
    }
    return () => { cancelled = true; };
  }, [tile?.key, range, weekOffset]);

  return (
    <AnimatePresence>
      {tile && (
        <motion.div
          initial={{ opacity: 0, y: 20, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: 20, height: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          style={{
            marginTop: 18,
            background: 'rgba(245,235,216,0.04)',
            border: '0.5px solid rgba(245,235,216,0.1)',
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          <DrawerContent
            tile={tile}
            detail={detail}
            loading={loading}
            briefing={briefing}
            briefingLoading={briefingLoading}
            onClose={onClose}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DrawerContent({ tile, detail, loading, briefing, briefingLoading, onClose }) {
  const pal = paletteFor(tile.category);
  const change = formatChangePct(tile.changePct);

  return (
    <div style={{ padding: '20px 22px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 14,
      }}>
        <div>
          <div style={{
            fontSize: 9, letterSpacing: 2, color: pal.accent,
            textTransform: 'uppercase', opacity: 0.85,
          }}>
            {pal.label}
          </div>
          <div style={{
            fontFamily: 'Georgia, serif', fontSize: 28, color: '#F5EBD8',
            marginTop: 4, lineHeight: 1.1, letterSpacing: '-0.3px',
          }}>
            {tile.label}
          </div>
          <div style={{
            fontSize: 11, color: '#A89A82', marginTop: 6,
          }}>
            {Math.round(tile.pctOfTotal * 100)}% of period
            <span style={{ margin: '0 8px', opacity: 0.4 }}>·</span>
            <span style={{ color: pal.meta }}>{change.symbol} {change.text}</span>
            {tile.tone && (
              <>
                <span style={{ margin: '0 8px', opacity: 0.4 }}>·</span>
                <span style={{ fontStyle: 'italic' }}>{tile.tone}</span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#8B7A5E', padding: 4, display: 'flex', alignItems: 'center',
            justifyContent: 'center', borderRadius: 6,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(245,235,216,0.06)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <X size={16} />
        </button>
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: '#8B7A5E', fontStyle: 'italic' }}>
          Reading your archive...
        </div>
      )}

      <Briefing briefing={briefing} loading={briefingLoading} palette={pal} />

      {detail && !loading && (
        <>
          {detail.stories && detail.stories.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{
                fontSize: 9, letterSpacing: 1.5, color: '#8B7A5E',
                textTransform: 'uppercase', marginBottom: 10,
              }}>
                Stories
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {detail.stories.map((story, i) => (
                  <StoryRow key={i} story={story} palette={pal} />
                ))}
              </div>
            </div>
          )}

          {detail.people && detail.people.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{
                fontSize: 9, letterSpacing: 1.5, color: '#8B7A5E',
                textTransform: 'uppercase', marginBottom: 10,
              }}>
                People mentioned
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {detail.people.slice(0, 10).map(p => (
                  <span key={p.name} style={{
                    fontSize: 11, padding: '4px 10px',
                    background: 'rgba(245,235,216,0.05)',
                    border: '0.5px solid rgba(245,235,216,0.1)',
                    borderRadius: 20, color: '#D4C4A8',
                  }}>
                    {p.name} <span style={{ opacity: 0.5 }}>({p.mentions})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {(!detail.stories || detail.stories.length === 0) && (
            <div style={{ fontSize: 12, color: '#8B7A5E', fontStyle: 'italic', marginTop: 8 }}>
              No story summaries yet for this topic. Summaries appear after conversations are processed.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StoryRow({ story, palette }) {
  const dateLabel = story.when ? formatDate(story.when) : '';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr auto',
        gap: 14, alignItems: 'baseline',
        padding: '8px 6px',
        borderRadius: 6,
        cursor: 'default',
      }}
    >
      <div style={{
        fontSize: 10, color: '#8B7A5E', letterSpacing: 0.3,
        whiteSpace: 'nowrap',
      }}>
        {dateLabel}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, color: '#E8D8BC', fontFamily: 'Georgia, serif',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {story.what || 'Conversation'}
        </div>
        {story.excerpt && (
          <div style={{
            fontSize: 11, color: '#A89A82', marginTop: 3, lineHeight: 1.5,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {story.excerpt}
          </div>
        )}
      </div>
      {story.tone && (
        <div style={{
          fontSize: 10, color: palette.meta, fontStyle: 'italic',
          opacity: 0.7, whiteSpace: 'nowrap',
        }}>
          {story.tone}
        </div>
      )}
    </div>
  );
}

/**
 * The on-demand briefing: LLM-generated summary + category-specific
 * structured fields (key figures for money, metrics for body, open
 * questions for mind, etc.). Renders only the fields the LLM emitted.
 * If briefing is null (no API key, no stories, or LLM error), section
 * is invisible — drawer looks exactly like the pre-briefing version.
 */
function Briefing({ briefing, loading, palette }) {
  if (loading && !briefing) {
    return (
      <div style={{
        marginTop: 20, marginBottom: 10, fontSize: 12,
        color: '#8B7A5E', fontStyle: 'italic',
      }}>
        Preparing briefing…
      </div>
    );
  }
  if (!briefing) return null;

  return (
    <div style={{ marginTop: 22, marginBottom: 14 }}>
      <div style={{
        fontSize: 9, letterSpacing: 1.5, color: '#8B7A5E',
        textTransform: 'uppercase', marginBottom: 10,
      }}>
        The Briefing
      </div>
      <p style={{
        fontFamily: 'Georgia, serif',
        fontSize: 15, lineHeight: 1.55, color: '#E8D8BC',
        margin: 0, marginBottom: briefing.key_figures || briefing.metrics ? 14 : 10,
      }}>
        {briefing.briefing}
      </p>

      {briefing.key_figures?.length > 0 && (
        <KeyFiguresRow figures={briefing.key_figures} palette={palette} />
      )}
      {briefing.metrics?.length > 0 && (
        <MetricsList metrics={briefing.metrics} palette={palette} />
      )}
      {briefing.next_move && (
        <InlineLabelValue label="Next move" value={briefing.next_move} />
      )}
      {briefing.blockers?.length > 0 && (
        <InlineChips label="Blockers" items={briefing.blockers} />
      )}
      {briefing.open_questions?.length > 0 && (
        <InlineChips label="Open questions" items={briefing.open_questions} />
      )}
      {briefing.themes?.length > 0 && (
        <InlineChips label="Themes" items={briefing.themes} />
      )}
      {briefing.last_touchpoint && (briefing.last_touchpoint.date || briefing.last_touchpoint.context) && (
        <InlineLabelValue
          label="Last touchpoint"
          value={[briefing.last_touchpoint.date, briefing.last_touchpoint.context]
            .filter(Boolean).join(' — ')}
        />
      )}
      {briefing.temperature && (
        <InlineLabelValue label="Temperature" value={briefing.temperature} />
      )}
    </div>
  );
}

function KeyFiguresRow({ figures, palette }) {
  const cols = Math.min(figures.length, 4);
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gap: 10, marginBottom: 12,
    }}>
      {figures.slice(0, 4).map((f, i) => (
        <div key={i} style={{
          padding: '10px 12px',
          background: 'rgba(245,235,216,0.04)',
          border: '0.5px solid rgba(245,235,216,0.1)',
          borderRadius: 8,
          minWidth: 0,
        }}>
          <div style={{
            fontFamily: 'Georgia, serif', fontSize: 18, color: '#E8D8BC',
            lineHeight: 1.15, letterSpacing: '-0.2px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {f.value}
          </div>
          <div style={{
            fontSize: 10, color: '#8B7A5E', marginTop: 4, letterSpacing: 0.3,
          }}>
            {f.label}
          </div>
          {f.context && (
            <div style={{
              fontSize: 9, color: palette.meta, opacity: 0.7,
              marginTop: 2, fontStyle: 'italic',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {f.context}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function MetricsList({ metrics, palette }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
      {metrics.slice(0, 4).map((m, i) => (
        <div key={i} style={{ fontSize: 12, color: '#D4C4A8' }}>
          <span style={{ color: '#8B7A5E' }}>· </span>
          <span style={{ color: '#E8D8BC' }}>{m.label}:</span>{' '}
          <span>{m.value}</span>
          {m.trend && (
            <span style={{
              marginLeft: 6, color: palette.meta,
              fontStyle: 'italic', fontSize: 10,
            }}>
              ({m.trend})
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function InlineLabelValue({ label, value }) {
  return (
    <div style={{
      fontSize: 12, color: '#D4C4A8', marginBottom: 7,
      display: 'flex', gap: 10, alignItems: 'baseline',
    }}>
      <span style={{
        fontSize: 9, textTransform: 'uppercase', letterSpacing: 1.5,
        color: '#8B7A5E', whiteSpace: 'nowrap', minWidth: 90,
      }}>
        {label}
      </span>
      <span style={{ lineHeight: 1.4 }}>{value}</span>
    </div>
  );
}

function InlineChips({ label, items }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 9, textTransform: 'uppercase', letterSpacing: 1.5,
        color: '#8B7A5E', marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.slice(0, 5).map((t, i) => (
          <span key={i} style={{
            fontSize: 11, padding: '3px 9px',
            background: 'rgba(245,235,216,0.04)',
            border: '0.5px solid rgba(245,235,216,0.1)',
            borderRadius: 20, color: '#D4C4A8',
          }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const days = Math.round((now - d) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}
