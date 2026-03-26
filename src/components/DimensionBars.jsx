import React from 'react';
import { motion } from 'framer-motion';
import { Heart, Brain, Users, Calendar, Briefcase } from 'lucide-react';

const DIMENSIONS = [
  { key: 'emotional', label: 'Emotional', icon: Heart, max: 20 },
  { key: 'mental', label: 'Mental', icon: Brain, max: 20 },
  { key: 'relational', label: 'Relational', icon: Users, max: 20 },
  { key: 'routine', label: 'Routine', icon: Calendar, max: 20 },
  { key: 'professional', label: 'Professional', icon: Briefcase, max: 20 },
];

function getBarColor(value, max) {
  const pct = value / max;
  if (pct >= 0.7) return 'bg-score-green';
  if (pct >= 0.4) return 'bg-score-yellow';
  return 'bg-score-red';
}

export default function DimensionBars({ scores }) {
  if (!scores) return null;

  return (
    <div className="space-y-4">
      {DIMENSIONS.map(({ key, label, icon: Icon, max }, i) => {
        const value = scores[key] || 0;
        const pct = (value / max) * 100;

        return (
          <motion.div
            key={key}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.8 + i * 0.1 }}
            className="flex items-center gap-3"
          >
            <Icon size={16} className="text-warm-gray flex-shrink-0" />
            <span className="text-sm text-charcoal-light w-24">{label}</span>
            <div className="flex-1 bg-cream-dark rounded-full h-2.5 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 1, delay: 1 + i * 0.1, ease: 'easeOut' }}
                className={`dimension-bar ${getBarColor(value, max)}`}
              />
            </div>
            <span className="text-sm font-medium text-charcoal w-10 text-right">
              {value}/{max}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}
