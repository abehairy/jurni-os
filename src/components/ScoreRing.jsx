import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const RADIUS = 90;
const STROKE_WIDTH = 10;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function getColor(score) {
  if (score >= 70) return { stroke: '#6B9E6B', glow: 'rgba(107,158,107,0.2)' };
  if (score >= 40) return { stroke: '#D4A843', glow: 'rgba(212,168,67,0.2)' };
  return { stroke: '#C4745A', glow: 'rgba(196,116,90,0.2)' };
}

export default function ScoreRing({ score, summary }) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const { stroke, glow } = getColor(score);
  const offset = CIRCUMFERENCE - (animatedScore / 100) * CIRCUMFERENCE;

  useEffect(() => {
    let frame;
    const start = Date.now();
    const duration = 1500;
    const from = 0;
    const to = score;

    function animate() {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setAnimatedScore(Math.round(from + (to - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(animate);
    }

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [score]);

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width="220" height="220" viewBox="0 0 220 220">
          {/* Background ring */}
          <circle
            cx="110" cy="110" r={RADIUS}
            fill="none"
            stroke="#E8E0D6"
            strokeWidth={STROKE_WIDTH}
          />
          {/* Score ring */}
          <circle
            cx="110" cy="110" r={RADIUS}
            fill="none"
            stroke={stroke}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            transform="rotate(-90 110 110)"
            className="score-ring"
            style={{ filter: `drop-shadow(0 0 8px ${glow})` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            key={animatedScore}
            className="font-display text-6xl font-bold"
            style={{ color: stroke }}
          >
            {animatedScore}
          </motion.span>
          <span className="text-xs text-warm-gray uppercase tracking-widest mt-1">
            Life Recovery
          </span>
        </div>
      </div>
      {summary && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
          className="text-center text-warm-gray mt-4 max-w-xs font-light"
        >
          {summary}
        </motion.p>
      )}
    </div>
  );
}
