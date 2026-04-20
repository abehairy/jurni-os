import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Pin, Send, Loader2, Sparkles } from 'lucide-react';
import { paletteFor, formatChangePct } from '../../lib/landscape-theme';

/**
 * The drill-down drawer that shows the moments behind a tile.
 * Slides up from below the treemap when a tile is clicked.
 */
export default function DrillDrawer({ api, tile, range, weekOffset, group = 'topic', isPinned = false, onTogglePin, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [briefing, setBriefing] = useState(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  // chatByTile: { [tileKey]: { messages: [{role, content}], loading, error } }
  // Kept at the drawer level so switching between tiles preserves each chat
  // for the lifetime of the drawer. Cleared when the drawer unmounts.
  const [chatByTile, setChatByTile] = useState({});

  useEffect(() => {
    if (!tile) { setDetail(null); setBriefing(null); return; }
    let cancelled = false;
    setLoading(true);
    api.getTileDetail({
      key: tile.key,
      group,
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
        group,
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
  }, [tile?.key, range, weekOffset, group]);

  const chatState = (tile && chatByTile[tile.key]) || { messages: [], loading: false, error: null };

  const sendChat = async (text) => {
    if (!tile || !text.trim()) return;
    const trimmed = text.trim();
    const priorMessages = chatState.messages;
    const nextMessages = [...priorMessages, { role: 'user', content: trimmed }];

    setChatByTile(prev => ({
      ...prev,
      [tile.key]: { messages: nextMessages, loading: true, error: null },
    }));

    try {
      const result = await api.chatWithTile?.({
        key: tile.key,
        group,
        range,
        weekOffset,
        category: tile.category,
        label: tile.label,
        tone: tile.tone,
        pctOfTotal: tile.pctOfTotal,
        changePct: tile.changePct,
        messages: nextMessages,
      });

      if (result?.ok && result.reply) {
        setChatByTile(prev => ({
          ...prev,
          [tile.key]: {
            messages: [...nextMessages, { role: 'assistant', content: result.reply }],
            loading: false,
            error: null,
          },
        }));
      } else {
        setChatByTile(prev => ({
          ...prev,
          [tile.key]: {
            messages: nextMessages,
            loading: false,
            error: result?.error || 'Chat failed',
          },
        }));
      }
    } catch (e) {
      setChatByTile(prev => ({
        ...prev,
        [tile.key]: {
          messages: nextMessages,
          loading: false,
          error: e.message || 'Chat failed',
        },
      }));
    }
  };

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
            background: 'var(--surface-alt)',
            border: '0.5px solid var(--border-strong)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <DrawerContent
            tile={tile}
            detail={detail}
            loading={loading}
            briefing={briefing}
            briefingLoading={briefingLoading}
            isPinned={isPinned}
            onTogglePin={onTogglePin}
            onClose={onClose}
            chatMessages={chatState.messages}
            chatLoading={chatState.loading}
            chatError={chatState.error}
            onSendChat={sendChat}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DrawerContent({
  tile, detail, loading, briefing, briefingLoading, isPinned, onTogglePin, onClose,
  chatMessages, chatLoading, chatError, onSendChat,
}) {
  const pal = paletteFor(tile.category);

  return (
    <div style={{ padding: '24px 28px 28px' }}>
      <DrawerHeader
        tile={tile} palette={pal}
        isPinned={isPinned} onTogglePin={onTogglePin} onClose={onClose}
      />

      {/* Briefing zone — always renders its header so loading is obvious. */}
      <Section title="The Briefing" accent={pal.accent}>
        <Briefing briefing={briefing} loading={briefingLoading} palette={pal} />
      </Section>

      {/* Stories zone — skeleton rows while detail loads. */}
      <Section title="Stories" accent={pal.accent}>
        {loading && <StoriesSkeleton />}
        {!loading && detail?.stories?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {detail.stories.map((story, i) => (
              <StoryRow key={i} story={story} palette={pal} />
            ))}
          </div>
        )}
        {!loading && (!detail?.stories || detail.stories.length === 0) && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No story summaries yet for this topic. Summaries appear after conversations are processed.
          </div>
        )}
      </Section>

      {/* People zone — only if there are any. */}
      {!loading && detail?.people?.length > 0 && (
        <Section title="People mentioned" accent={pal.accent}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {detail.people.slice(0, 10).map(p => (
              <span key={p.name} style={{
                fontSize: 11, padding: '5px 11px',
                background: 'var(--surface)',
                border: '0.5px solid var(--border-strong)',
                borderRadius: 20, color: 'var(--text-primary)',
              }}>
                {p.name} <span style={{ opacity: 0.5 }}>({p.mentions})</span>
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Chat is its own framed panel — clearly the "interactive" zone,
          visually separated from the read-only sections above. */}
      <div style={{
        marginTop: 28,
        padding: '20px 22px 18px',
        background: 'var(--surface)',
        border: '0.5px solid var(--border-strong)',
        borderRadius: 12,
      }}>
        <ChatSection
          tile={tile}
          palette={pal}
          messages={chatMessages}
          loading={chatLoading}
          error={chatError}
          onSend={onSendChat}
          disabled={loading || !detail || !detail.stories || detail.stories.length === 0}
          detailLoading={loading}
        />
      </div>
    </div>
  );
}

function DrawerHeader({ tile, palette, isPinned, onTogglePin, onClose }) {
  const change = formatChangePct(tile.changePct);
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      marginBottom: 22, paddingBottom: 18,
      borderBottom: '0.5px solid var(--border-strong)',
    }}>
      <div>
        <div style={{
          fontSize: 9, letterSpacing: 2, color: palette.accent,
          textTransform: 'uppercase', opacity: 0.85,
        }}>
          {palette.label}
        </div>
        <div style={{
          fontFamily: 'Georgia, serif', fontSize: 32, color: 'var(--text-primary)',
          marginTop: 4, lineHeight: 1.1, letterSpacing: '-0.3px',
        }}>
          {tile.label}
        </div>
        <div style={{
          fontSize: 11, color: 'var(--text-muted)', marginTop: 8,
        }}>
          {Math.round(tile.pctOfTotal * 100)}% of period
          <span style={{ margin: '0 8px', opacity: 0.4 }}>·</span>
          <span style={{ color: palette.meta }}>{change.symbol} {change.text}</span>
          {tile.tone && (
            <>
              <span style={{ margin: '0 8px', opacity: 0.4 }}>·</span>
              <span style={{ fontStyle: 'italic' }}>{tile.tone}</span>
            </>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {onTogglePin && (
          <button
            onClick={onTogglePin}
            aria-label={isPinned ? 'Unpin' : 'Pin to sidebar'}
            title={isPinned ? 'Unpin' : 'Pin to sidebar'}
            style={{
              background: isPinned ? 'var(--accent-soft)' : 'transparent',
              border: 'none', cursor: 'pointer',
              color: isPinned ? 'var(--accent)' : 'var(--text-muted)',
              padding: 6, display: 'flex', alignItems: 'center',
              justifyContent: 'center', borderRadius: 6,
              transition: 'background 120ms ease, color 120ms ease',
            }}
            onMouseEnter={e => {
              if (!isPinned) {
                e.currentTarget.style.background = 'var(--hover-overlay)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }
            }}
            onMouseLeave={e => {
              if (!isPinned) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-muted)';
              }
            }}
          >
            <Pin size={14} fill={isPinned ? 'currentColor' : 'none'} />
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: 6, display: 'flex', alignItems: 'center',
            justifyContent: 'center', borderRadius: 6,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-overlay)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

// Consistent section frame: small accent dot + uppercase label + content.
// Used for Briefing / Stories / People so they all read with the same rhythm.
function Section({ title, accent, children }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{
        fontSize: 10, letterSpacing: 1.8, color: 'var(--text-muted)',
        textTransform: 'uppercase', marginBottom: 12, fontWeight: 500,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {accent && (
          <span style={{
            width: 5, height: 5, borderRadius: '50%', background: accent,
            opacity: 0.75,
          }} />
        )}
        {title}
      </div>
      {children}
    </div>
  );
}

function Skeleton({ width = '100%', height = 12, style }) {
  return (
    <motion.div
      animate={{ opacity: [0.35, 0.7, 0.35] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      style={{
        width, height, borderRadius: 4,
        background: 'var(--border-strong)',
        ...style,
      }}
    />
  );
}

function StoriesSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[0, 1, 2, 3].map(i => (
        <div key={i} style={{
          display: 'grid',
          gridTemplateColumns: '90px 1fr auto',
          gap: 14, alignItems: 'center',
          padding: '6px 6px',
        }}>
          <Skeleton width={50} height={9} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skeleton width="68%" height={12} />
            <Skeleton width="92%" height={9} />
          </div>
          <Skeleton width={32} height={9} />
        </div>
      ))}
    </div>
  );
}

// Conversational panel scoped to the tile. Shows prior turns, an input, and
// a send button. First turn surfaces a couple of suggested prompts so the
// user doesn't stare at a blank box.
function ChatSection({ tile, palette, messages, loading, error, onSend, disabled, detailLoading }) {
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages?.length, loading]);

  const submit = () => {
    if (!input.trim() || loading || disabled) return;
    onSend(input);
    setInput('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const suggestions = tile ? suggestionsFor(tile) : [];
  const isEmpty = !messages || messages.length === 0;

  const placeholder = detailLoading
    ? 'Loading context…'
    : disabled
      ? 'No stories yet to chat about…'
      : `Ask anything about ${tile?.label || 'this tile'}…`;

  return (
    <div>
      <div style={{
        fontSize: 11, letterSpacing: 1.5, color: 'var(--text-muted)',
        textTransform: 'uppercase', marginBottom: 14, display: 'flex',
        alignItems: 'center', gap: 8, fontWeight: 500,
      }}>
        <Sparkles size={12} style={{ color: palette?.accent || 'var(--accent)' }} />
        Ask Jurni about {tile?.label || 'this tile'}
      </div>

      {!isEmpty && (
        <div
          ref={scrollRef}
          style={{
            maxHeight: 340, overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 12,
            marginBottom: 12, paddingRight: 4,
          }}
        >
          {messages.map((m, i) => (
            <ChatBubble key={i} role={m.role} content={m.content} palette={palette} />
          ))}
          {loading && <ChatTypingIndicator />}
        </div>
      )}

      {isEmpty && suggestions.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12,
        }}>
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => onSend(s)}
              disabled={disabled || loading}
              style={{
                fontSize: 11, padding: '6px 12px',
                background: 'var(--surface-alt)',
                border: '0.5px solid var(--border-strong)',
                borderRadius: 14, color: 'var(--text-muted)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                opacity: disabled ? 0.5 : 1,
                transition: 'color 120ms ease, background 120ms ease',
              }}
              onMouseEnter={e => {
                if (!disabled) e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'var(--text-muted)';
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div style={{
          fontSize: 11, color: 'var(--text-muted)',
          background: 'var(--hover-overlay)',
          border: '0.5px solid var(--border-strong)',
          borderRadius: 8, padding: '7px 10px', marginBottom: 10,
        }}>
          {error}
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 8,
        background: 'var(--surface-alt)',
        border: '0.5px solid var(--border-strong)',
        borderRadius: 12, padding: '10px 10px 10px 14px',
      }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          style={{
            flex: 1, resize: 'none', minHeight: 22, maxHeight: 120,
            background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text-primary)', fontSize: 14,
            fontFamily: 'inherit', lineHeight: 1.5,
          }}
        />
        <button
          onClick={submit}
          disabled={!input.trim() || loading || disabled}
          aria-label="Send"
          style={{
            background: input.trim() && !loading ? 'var(--accent)' : 'var(--accent-soft)',
            color: input.trim() && !loading ? '#FFFFFF' : 'var(--accent)',
            border: 'none', borderRadius: 8,
            padding: '7px 9px', cursor: (!input.trim() || loading || disabled) ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 120ms ease',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  );
}

function ChatBubble({ role, content, palette }) {
  const isUser = role === 'user';
  return (
    <div style={{
      display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start',
    }}>
      <div style={{
        maxWidth: '82%',
        padding: '10px 14px',
        borderRadius: 14,
        background: isUser ? (palette?.accent || 'var(--accent)') : 'var(--surface-alt)',
        border: isUser ? 'none' : '0.5px solid var(--border-strong)',
        color: isUser ? '#FFFFFF' : 'var(--text-primary)',
        fontSize: 13, lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        fontFamily: isUser ? 'inherit' : 'Georgia, serif',
      }}>
        {content}
      </div>
    </div>
  );
}

function ChatTypingIndicator() {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div style={{
        padding: '10px 14px',
        borderRadius: 14,
        background: 'var(--surface-alt)',
        border: '0.5px solid var(--border-strong)',
        display: 'flex', gap: 4, alignItems: 'center',
      }}>
        {[0, 1, 2].map(i => (
          <motion.span
            key={i}
            animate={{ opacity: [0.25, 1, 0.25] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
            style={{
              width: 5, height: 5, borderRadius: '50%',
              background: 'var(--text-muted)',
            }}
          />
        ))}
      </div>
    </div>
  );
}

function suggestionsFor(tile) {
  const cat = tile.category || 'other';
  if (cat === 'work' || cat === 'craft' || cat === 'money') {
    return ['What\'s my next move here?', 'What\'s blocking progress?', 'Summarize where this stands'];
  }
  if (cat === 'body' || cat === 'mind') {
    return ['What should I focus on here?', "What's been shifting?", 'What am I missing?'];
  }
  if (cat === 'love' || cat === 'family' || cat === 'peers' || cat === 'child' || cat === 'hearth') {
    return ['How has this evolved?', 'What\'s the current temperature?', 'What\'s unsaid here?'];
  }
  return ['What stands out?', 'What\'s the through-line?', 'What questions are still open?'];
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
        fontSize: 10, color: 'var(--text-muted)', letterSpacing: 0.3,
        whiteSpace: 'nowrap',
      }}>
        {dateLabel}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, color: 'var(--text-primary)', fontFamily: 'Georgia, serif',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {story.what || 'Conversation'}
        </div>
        {story.excerpt && (
          <div style={{
            fontSize: 11, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5,
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
  // Loading state: paragraph-shaped skeleton so the user sees we're working
  // on the briefing, not a tiny italic line that's easy to miss.
  if (loading && !briefing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Skeleton width="96%" height={14} />
        <Skeleton width="89%" height={14} />
        <Skeleton width="72%" height={14} />
        <div style={{
          fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic',
          marginTop: 4, opacity: 0.8,
        }}>
          Preparing briefing…
        </div>
      </div>
    );
  }
  if (!briefing) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
        No briefing available yet for this tile.
      </div>
    );
  }

  return (
    <div>
      <p style={{
        fontFamily: 'Georgia, serif',
        fontSize: 16, lineHeight: 1.6, color: 'var(--text-primary)',
        margin: 0, marginBottom: briefing.key_figures || briefing.metrics ? 16 : 12,
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
          background: 'var(--hover-overlay)',
          border: '0.5px solid var(--border-strong)',
          borderRadius: 8,
          minWidth: 0,
        }}>
          <div style={{
            fontFamily: 'Georgia, serif', fontSize: 18, color: 'var(--text-primary)',
            lineHeight: 1.15, letterSpacing: '-0.2px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {f.value}
          </div>
          <div style={{
            fontSize: 10, color: 'var(--text-muted)', marginTop: 4, letterSpacing: 0.3,
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
        <div key={i} style={{ fontSize: 12, color: 'var(--text-primary)' }}>
          <span style={{ color: 'var(--text-muted)' }}>· </span>
          <span style={{ color: 'var(--text-primary)' }}>{m.label}:</span>{' '}
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
      fontSize: 12, color: 'var(--text-primary)', marginBottom: 7,
      display: 'flex', gap: 10, alignItems: 'baseline',
    }}>
      <span style={{
        fontSize: 9, textTransform: 'uppercase', letterSpacing: 1.5,
        color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 90,
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
        color: 'var(--text-muted)', marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.slice(0, 5).map((t, i) => (
          <span key={i} style={{
            fontSize: 11, padding: '3px 9px',
            background: 'var(--hover-overlay)',
            border: '0.5px solid var(--border-strong)',
            borderRadius: 20, color: 'var(--text-primary)',
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
