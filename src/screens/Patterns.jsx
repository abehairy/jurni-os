import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Waves, AlertTriangle, TrendingUp, RotateCcw, Zap, Shield, ArrowDownRight } from 'lucide-react';

const PATTERN_ICONS = {
  indecision_loop: RotateCcw,
  energy_cycle: Zap,
  trigger: AlertTriangle,
  habit: Shield,
  growth: TrendingUp,
  regression: ArrowDownRight,
  avoidance: AlertTriangle,
};

const CONFIDENCE_LABELS = {
  high: { min: 0.7, label: 'High confidence', color: 'text-score-green' },
  medium: { min: 0.4, label: 'Moderate confidence', color: 'text-score-yellow' },
  low: { min: 0, label: 'Low confidence', color: 'text-score-red' },
};

function getConfidence(value) {
  if (value >= 0.7) return CONFIDENCE_LABELS.high;
  if (value >= 0.4) return CONFIDENCE_LABELS.medium;
  return CONFIDENCE_LABELS.low;
}

export default function Patterns({ api }) {
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getPatterns().then(data => {
      setPatterns(data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <p className="text-warm-gray font-light text-center py-12">Detecting patterns...</p>;
  }

  return (
    <div className="max-w-2xl mx-auto py-6">
      <h2 className="font-display text-2xl mb-6">Patterns</h2>

      {patterns.length === 0 ? (
        <div className="text-center py-12">
          <Waves size={32} className="text-warm-gray/40 mx-auto mb-3" />
          <p className="text-warm-gray">No patterns detected yet. More data reveals more patterns.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {patterns.map((pattern, i) => {
            const Icon = PATTERN_ICONS[pattern.type] || Waves;
            const conf = getConfidence(pattern.confidence);

            return (
              <motion.div
                key={pattern.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="glass-card p-5"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 text-terracotta">
                    <Icon size={20} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs uppercase tracking-wider text-warm-gray font-medium">
                        {pattern.type?.replace(/_/g, ' ')}
                      </span>
                      <span className={`text-xs ${conf.color}`}>&middot; {conf.label}</span>
                    </div>
                    <p className="text-sm text-charcoal leading-relaxed">{pattern.description}</p>

                    {pattern.evidence?.length > 0 && (
                      <details className="mt-3">
                        <summary className="text-xs text-warm-gray cursor-pointer hover:text-charcoal-light">
                          {pattern.evidence.length} supporting moment{pattern.evidence.length !== 1 ? 's' : ''}
                        </summary>
                        <div className="mt-2 space-y-1">
                          {pattern.evidence.slice(0, 5).map((e, j) => (
                            <div key={j} className="text-xs text-warm-gray pl-3 border-l-2 border-cream-dark">
                              {e.excerpt}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
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
