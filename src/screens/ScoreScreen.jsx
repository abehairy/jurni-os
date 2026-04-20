import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ScoreRing from '../components/ScoreRing';
import DimensionBars from '../components/DimensionBars';
import { MessageSquare, Image, CalendarDays, Sparkles, Activity, Loader2 } from 'lucide-react';

function getSummary(score) {
  if (!score) return '';
  const s = score.overall;
  if (s >= 80) return "You're thriving. Keep doing what you're doing.";
  if (s >= 70) return "You're in good shape. A few things to watch.";
  if (s >= 55) return "Stress is building. Pay attention to the signals.";
  if (s >= 40) return "Things are getting heavy. Take care of yourself.";
  if (s >= 25) return "You need a reset. Reach out to someone you trust.";
  return "Take care of yourself today. Seriously.";
}

export default function ScoreScreen({ api }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Initial load
  useEffect(() => {
    loadData();
  }, []);

  // Live updates — poll every 10s and listen for score events
  useEffect(() => {
    const interval = setInterval(loadData, 10000);

    const cleanupScores = api.onScoresUpdated?.((scores) => {
      setData(prev => prev ? { ...prev, scores } : prev);
    });

    const cleanupMoment = api.onNewMoment?.(() => {
      setTimeout(loadData, 500);
    });

    return () => {
      clearInterval(interval);
      cleanupScores?.();
      cleanupMoment?.();
    };
  }, [api]);

  async function loadData() {
    try {
      const d = await api.getDashboardData();
      setData(d);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }

  const { scores, stats, topInsights } = data || {};

  // ---- Waiting for data state (lively!) ----
  if (!loading && !scores) {
    return (
      <div className="max-w-2xl mx-auto py-6 space-y-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex justify-center"
        >
          <WaitingScoreRing stats={stats} />
        </motion.div>

        {/* Preview dimension bars as skeleton */}
        <div className="glass-card p-6">
          <h3 className="font-display text-lg mb-4 text-warm-gray/60">Dimensions</h3>
          <div className="space-y-4">
            {['Emotional', 'Mental', 'Relational', 'Routine', 'Professional'].map((label, i) => (
              <motion.div key={label} className="flex items-center gap-3"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.1 }}>
                <div className="w-4 h-4 rounded bg-cream-dark" />
                <span className="text-sm text-warm-gray/50 w-24">{label}</span>
                <div className="flex-1 bg-cream-dark rounded-full h-2.5 overflow-hidden">
                  <motion.div
                    className="h-full bg-terracotta/20 rounded-full"
                    animate={{ width: ['0%', '30%', '15%', '25%'] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                  />
                </div>
                <span className="text-sm text-warm-gray/30 w-10 text-right">—</span>
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
          className="flex justify-center gap-8 text-center">
          <StatBadge icon={MessageSquare} value={stats?.messageCount || 0} label="Messages" />
          <StatBadge icon={Image} value={stats?.photoCount || 0} label="Photos" />
          <StatBadge icon={CalendarDays} value={stats?.calendarCount || 0} label="Events" />
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
          <div className="glass-card p-5 text-center">
            <Loader2 size={16} className="text-terracotta animate-spin mx-auto mb-2" />
            <p className="text-sm text-warm-gray">
              Jurni is reading your data in the background.
              Your score shows up here as soon as there's enough to read.
            </p>
            <p className="text-xs text-warm-gray/50 mt-2">
              {stats?.messageCount > 0
                ? `${stats.messageCount} messages from ${stats.threadCount || 0} conversations ingested so far...`
                : 'Use Claude or ChatGPT with the connector open to start capturing data.'}
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <p className="text-warm-gray font-light">Loading your score...</p>
      </div>
    );
  }

  // ---- Full score view ----
  return (
    <div className="max-w-2xl mx-auto py-6 space-y-10">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="flex justify-center"
      >
        <ScoreRing score={scores.overall} summary={getSummary(scores)} />
      </motion.div>

      <div className="glass-card p-6">
        <h3 className="font-display text-lg mb-4">Dimensions</h3>
        <DimensionBars scores={scores} />
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        className="flex justify-center gap-8 text-center">
        <StatBadge icon={MessageSquare} value={stats?.messageCount || 0} label="Messages" />
        <StatBadge icon={Image} value={stats?.photoCount || 0} label="Photos" />
        <StatBadge icon={CalendarDays} value={stats?.calendarCount || 0} label="Events" />
      </motion.div>

      {topInsights && topInsights.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5 }}>
          <h3 className="font-display text-lg mb-3">What's pulling on you</h3>
          <div className="space-y-3">
            {topInsights.map((insight, i) => (
              <div key={i} className={`insight-card ${insight.severity}`}>
                <p className="text-sm text-charcoal">{insight.text}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function WaitingScoreRing({ stats }) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width="220" height="220" viewBox="0 0 220 220">
          <circle cx="110" cy="110" r="90" fill="none" stroke="#E8E0D6" strokeWidth="10" />
          <motion.circle
            cx="110" cy="110" r="90" fill="none" stroke="#C4745A" strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={565}
            strokeDashoffset={565}
            animate={{ strokeDashoffset: [565, 400, 500, 450] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            transform="rotate(-90 110 110)"
            opacity={0.3}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.div
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Activity size={28} className="text-terracotta/50" />
          </motion.div>
          <span className="text-xs text-warm-gray uppercase tracking-widest mt-2">
            Reading
          </span>
        </div>
      </div>
      <p className="text-center text-warm-gray mt-4 max-w-xs font-light text-sm">
        Your score is coming together…
      </p>
    </div>
  );
}

function StatBadge({ icon: Icon, value, label }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Icon size={18} className="text-warm-gray" />
      <motion.span key={value} initial={{ scale: 1.2 }} animate={{ scale: 1 }}
        className="text-lg font-semibold text-charcoal">{value}</motion.span>
      <span className="text-xs text-warm-gray">{label}</span>
    </div>
  );
}
