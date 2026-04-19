import React from 'react';
import { motion } from 'framer-motion';
import { paletteFor, formatChangePct } from '../../lib/landscape-theme';
import Sparkline from './Sparkline';

/**
 * A single tile in the landscape treemap.
 *
 * Progressive disclosure based on tile area:
 *   - Large  (> 200*120):  full treatment — category label, topic name (serif),
 *                          summary/tone, change %, sparkline
 *   - Medium (> 120*80):   category label, topic name, change %
 *   - Small  (< 120*80):   compact — category + topic inline, change %
 *
 * Dimmed state applies when another tile is open for drill-down.
 */
export default function Tile({ tile, x, y, w, h, dimmed, onClick }) {
  const pal = paletteFor(tile.category);
  const area = w * h;
  const isLarge = area > 200 * 120;
  const isMedium = !isLarge && area > 120 * 80;
  const change = formatChangePct(tile.changePct);

  // For very thin tiles, use flat background (gradients look bad when small)
  const useGradient = isLarge || (w > 140 && h > 50);

  return (
    <motion.button
      layout
      layoutId={tile.key}
      onClick={onClick}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{
        opacity: dimmed ? 0.38 : 1,
        scale: 1,
        filter: dimmed ? 'saturate(0.6)' : 'saturate(1)',
      }}
      whileHover={{
        y: -2,
        filter: dimmed ? 'saturate(0.7)' : 'brightness(1.08)',
        transition: { duration: 0.15 },
      }}
      transition={{ type: 'spring', stiffness: 220, damping: 28, mass: 0.9 }}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        background: useGradient ? pal.grad : pal.flat,
        borderRadius: 8,
        border: 'none',
        textAlign: 'left',
        padding: isLarge ? '14px 16px' : isMedium ? '10px 12px' : '7px 10px',
        cursor: 'pointer',
        overflow: 'hidden',
        boxShadow: isLarge ? 'inset 0 1px 0 rgba(255,230,200,0.08)' : 'none',
        color: pal.title,
        fontFamily: 'inherit',
      }}
      aria-label={`${pal.label}: ${tile.label}`}
    >
      {isLarge ? (
        <LargeContent tile={tile} pal={pal} change={change} />
      ) : isMedium ? (
        <MediumContent tile={tile} pal={pal} change={change} />
      ) : (
        <SmallContent tile={tile} pal={pal} change={change} />
      )}
    </motion.button>
  );
}

function LargeContent({ tile, pal, change }) {
  const isCategory = tile.subTopics !== null && tile.subTopics !== undefined;
  // Category tile: show the domain as the big label, nothing above it.
  // Topic tile: show CATEGORY kicker + topic as big label.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {!isCategory && (
            <div style={{
              fontSize: 9, letterSpacing: 2, color: pal.accent,
              textTransform: 'uppercase', opacity: 0.85, fontWeight: 500,
            }}>
              {pal.label}
            </div>
          )}
          <div style={{
            fontFamily: 'Georgia, serif', fontSize: isCategory ? 26 : 22,
            color: pal.title, marginTop: isCategory ? 0 : 4,
            lineHeight: 1.08, letterSpacing: '-0.3px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            textTransform: isCategory ? 'lowercase' : 'none',
          }}>
            {isCategory ? pal.label.toLowerCase() : tile.label}
          </div>
          <div style={{
            fontSize: 10, color: pal.meta, opacity: 0.75, marginTop: 6,
            letterSpacing: 0.2,
          }}>
            {Math.round(tile.pctOfTotal * 100)}% of period
            {tile.isNew ? ' · new' : (change.text ? ` · ${change.symbol} ${change.text}` : '')}
            {tile.tone ? ` · ${tile.tone}` : ''}
          </div>
        </div>
        <Sparkline data={tile.spark} color={pal.accent} width={54} height={16} />
      </div>

      {isCategory && tile.subTopics && tile.subTopics.length > 0 ? (
        <SubTopicsList subTopics={tile.subTopics} pal={pal} />
      ) : tile.summary ? (
        <div style={{
          fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 12.5,
          color: pal.meta, opacity: 0.82, lineHeight: 1.45, marginTop: 8,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {tile.summary}
        </div>
      ) : null}
    </div>
  );
}

function SubTopicsList({ subTopics, pal }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10,
    }}>
      {subTopics.slice(0, 5).map(st => (
        <div key={st.topic} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          gap: 8, fontSize: 11.5,
        }}>
          <span style={{
            fontFamily: 'Georgia, serif', color: pal.title, opacity: 0.92,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            flex: 1, minWidth: 0,
          }}>
            {st.topic}
          </span>
          <span style={{
            fontSize: 9.5, color: pal.meta, opacity: 0.6, flexShrink: 0,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {Math.round(st.weight * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function MediumContent({ tile, pal, change }) {
  const isCategory = tile.subTopics !== null && tile.subTopics !== undefined;
  const topTopic = isCategory && tile.subTopics?.[0]?.topic;
  return (
    <div>
      {!isCategory && (
        <div style={{
          fontSize: 9, letterSpacing: 1.5, color: pal.accent,
          textTransform: 'uppercase', opacity: 0.8,
        }}>
          {pal.label}
        </div>
      )}
      <div style={{
        fontFamily: 'Georgia, serif', fontSize: isCategory ? 17 : 15,
        color: pal.title, marginTop: isCategory ? 0 : 3, lineHeight: 1.15,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textTransform: isCategory ? 'lowercase' : 'none',
      }}>
        {isCategory ? pal.label.toLowerCase() : tile.label}
      </div>
      {topTopic && (
        <div style={{
          fontFamily: 'Georgia, serif', fontStyle: 'italic',
          fontSize: 11, color: pal.meta, opacity: 0.75, marginTop: 4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          mostly {topTopic}
        </div>
      )}
      <div style={{ fontSize: 9, color: pal.meta, opacity: 0.65, marginTop: 4 }}>
        {tile.isNew ? 'new' : (change.text ? `${change.symbol} ${change.text}` : '—')}
        {tile.tone ? ` · ${tile.tone}` : ''}
      </div>
    </div>
  );
}

function SmallContent({ tile, pal, change }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      height: '100%', gap: 8,
    }}>
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: 8, letterSpacing: 1.5, color: pal.accent,
          textTransform: 'uppercase', opacity: 0.7, flexShrink: 0,
        }}>
          {pal.label}
        </span>
        <span style={{
          fontFamily: 'Georgia, serif', fontSize: 11, color: pal.title,
          opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {tile.label}
        </span>
      </div>
      <div style={{ fontSize: 9, color: pal.meta, opacity: 0.65, flexShrink: 0 }}>
        {change.symbol}
      </div>
    </div>
  );
}
