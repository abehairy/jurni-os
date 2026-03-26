import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, Image, CalendarDays, Filter } from 'lucide-react';
import { format } from 'date-fns';

const SOURCE_ICONS = {
  conversation: MessageSquare,
  photo: Image,
  calendar: CalendarDays,
};

const SOURCE_COLORS = {
  conversation: 'text-terracotta',
  photo: 'text-sage',
  calendar: 'text-amber',
};

export default function Timeline({ api }) {
  const [moments, setMoments] = useState([]);
  const [filter, setFilter] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMoments();
  }, [filter]);

  async function loadMoments() {
    setLoading(true);
    const filters = { limit: 100 };
    if (filter) filters.source = filter;
    const data = await api.getMoments(filters);
    setMoments(data);
    setLoading(false);
  }

  return (
    <div className="max-w-2xl mx-auto py-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl">Timeline</h2>
        <div className="flex gap-2">
          {[null, 'conversation', 'photo', 'calendar'].map(f => (
            <button
              key={f || 'all'}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                ${filter === f
                  ? 'bg-terracotta text-white'
                  : 'bg-white/50 text-charcoal-light hover:bg-white/80'}`}
            >
              {f ? f.charAt(0).toUpperCase() + f.slice(1) + 's' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-warm-gray font-light text-center py-12">Loading moments...</p>
      ) : moments.length === 0 ? (
        <div className="text-center py-12">
          <Filter size={32} className="text-warm-gray/40 mx-auto mb-3" />
          <p className="text-warm-gray">No moments found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {moments.map((moment, i) => {
            const Icon = SOURCE_ICONS[moment.source] || MessageSquare;
            const colorClass = SOURCE_COLORS[moment.source] || 'text-warm-gray';

            return (
              <motion.div
                key={moment.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="glass-card p-4"
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 ${colorClass}`}>
                    <Icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-charcoal leading-relaxed line-clamp-3">
                      {moment.raw_content}
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-warm-gray">
                        {formatTimestamp(moment.timestamp)}
                      </span>
                      {moment.metadata?.conversation_name && (
                        <span className="text-xs text-warm-gray/70 truncate">
                          {moment.metadata.conversation_name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatTimestamp(ts) {
  try {
    return format(new Date(ts), 'MMM d, yyyy h:mm a');
  } catch {
    return ts;
  }
}
