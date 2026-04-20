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
            stroke="var(--border-strong)"
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
            style={{
              color: stroke,
              fontFamily: 'Georgia, serif',
              fontSize: 64,
              fontWeight: 500,
              lineHeight: 1,
            }}
          >
            {animatedScore}
          </motion.span>
          <span style={{
            fontSize: 11, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: 2, marginTop: 6,
          }}>
            Life Recovery
          </span>
        </div>
      </div>
      {summary && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
          style={{
            textAlign: 'center', color: 'var(--text-muted)',
            marginTop: 16, maxWidth: 280, fontWeight: 300, fontSize: 13, lineHeight: 1.55,
          }}
        >
          {summary}
        </motion.p>
      )}
    </div>
  );
}
