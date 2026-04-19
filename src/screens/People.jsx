import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, TrendingUp, TrendingDown, Minus, ArrowLeft } from 'lucide-react';

export default function People({ api }) {
  const [entities, setEntities] = useState([]);
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.getEntities('person').then(data => {
        if (cancelled) return;
        setEntities(data);
        setLoading(false);
      });
    };
    load();
    const off = api.onLandscapeUpdated?.(load);
    return () => { cancelled = true; off?.(); };
  }, []);

  async function handleSelect(entity) {
    setSelectedEntity(entity);
    const d = await api.getEntityDetail(entity.id);
    setDetail(d);
  }

  if (loading) {
    return <p className="text-warm-gray font-light text-center py-12">Loading people...</p>;
  }

  if (selectedEntity && detail) {
    return (
      <div className="max-w-2xl mx-auto py-6">
        <button
          onClick={() => { setSelectedEntity(null); setDetail(null); }}
          className="flex items-center gap-2 text-sm text-warm-gray hover:text-charcoal mb-6"
        >
          <ArrowLeft size={16} /> Back to People
        </button>

        <div className="glass-card p-6 mb-6">
          <h2 className="font-display text-2xl mb-1">{detail.name}</h2>
          <p className="text-sm text-warm-gray mb-4">
            Mentioned {detail.mention_count} times &middot;
            First seen {formatDate(detail.first_seen)} &middot;
            Last seen {formatDate(detail.last_seen)}
          </p>

          {detail.sentiment_trajectory?.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Sentiment over time</h4>
              <div className="flex items-center gap-2 flex-wrap">
                {detail.sentiment_trajectory.map((s, i) => (
                  <span
                    key={i}
                    className={`inline-block w-6 h-6 rounded-full text-xs flex items-center justify-center
                      ${s.sentiment > 0.2 ? 'bg-score-green/20 text-score-green' :
                        s.sentiment < -0.2 ? 'bg-score-red/20 text-score-red' :
                        'bg-score-yellow/20 text-score-yellow'}`}
                    title={`${s.sentiment.toFixed(2)} on ${formatDate(s.date)}`}
                  >
                    {s.sentiment > 0.2 ? '+' : s.sentiment < -0.2 ? '-' : '~'}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {detail.moments?.length > 0 && (
          <div>
            <h4 className="font-display text-lg mb-3">Related Moments</h4>
            <div className="space-y-2">
              {detail.moments.slice(0, 20).map(m => (
                <div key={m.id} className="glass-card p-3">
                  <p className="text-sm text-charcoal line-clamp-2">{m.raw_content}</p>
                  <span className="text-xs text-warm-gray mt-1 block">
                    {formatDate(m.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-6">
      <h2 className="font-display text-2xl mb-6">People</h2>

      {entities.length === 0 ? (
        <div className="text-center py-12">
          <Users size={32} className="text-warm-gray/40 mx-auto mb-3" />
          <p className="text-warm-gray">No people detected yet. Import conversations to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entities.map((entity, i) => {
            const latestSentiment = entity.sentiment_trajectory?.length > 0
              ? entity.sentiment_trajectory[entity.sentiment_trajectory.length - 1].sentiment
              : null;

            return (
              <motion.button
                key={entity.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => handleSelect(entity)}
                className="w-full glass-card p-4 flex items-center gap-4 hover:bg-white/70 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-full bg-terracotta/10 flex items-center justify-center">
                  <span className="font-display text-lg text-terracotta">
                    {entity.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-charcoal truncate">{entity.name}</p>
                  <p className="text-xs text-warm-gray">
                    {entity.mention_count} mention{entity.mention_count !== 1 ? 's' : ''}
                  </p>
                </div>
                <SentimentIndicator value={latestSentiment} />
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SentimentIndicator({ value }) {
  if (value === null || value === undefined) return null;

  if (value > 0.2) return <TrendingUp size={16} className="text-score-green" />;
  if (value < -0.2) return <TrendingDown size={16} className="text-score-red" />;
  return <Minus size={16} className="text-score-yellow" />;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}
