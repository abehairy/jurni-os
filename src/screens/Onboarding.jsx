import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Key, ArrowRight, Sparkles, AlertCircle, MessageSquare, Image,
  CalendarDays, Upload, ToggleLeft, ToggleRight, FileJson, Heart,
  Brain, Users, Waves, Activity,
} from 'lucide-react';
import ScoreRing from '../components/ScoreRing';
import DimensionBars from '../components/DimensionBars';

export default function Onboarding({ api, config, onComplete }) {
  const [step, setStep] = useState(config.openrouter_api_key ? 'connectors' : 'welcome');
  const [apiKey, setApiKey] = useState(config.openrouter_api_key || '');

  const [connectors, setConnectors] = useState({
    claude: { enabled: false, status: 'idle', capturedCount: 0 },
    chatgpt: { enabled: false, status: 'idle', capturedCount: 0 },
    photos: { enabled: false, folder: null },
    calendar: { enabled: false, status: 'idle' },
  });

  const [showImport, setShowImport] = useState(null);
  const [importProgress, setImportProgress] = useState(null);
  const [importError, setImportError] = useState(null);

  // Ingestion / discovery counters
  const [counters, setCounters] = useState({
    moments: 0, emotions: 0, patterns: 0, people: 0,
  });
  const [discoveryLines, setDiscoveryLines] = useState([]);
  const [scores, setScores] = useState(null);
  const discoveryRef = useRef(null);

  useEffect(() => {
    if (!api.onConnectorStatus) return;
    const cleanup = api.onConnectorStatus((status) => {
      if (status.provider) {
        setConnectors(prev => ({
          ...prev,
          [status.provider]: {
            ...prev[status.provider],
            status: status.status,
            lastMessage: status.lastMessage,
            capturedCount: status.capturedCount ?? prev[status.provider]?.capturedCount ?? 0,
          },
        }));
        // Feed crawl progress into discovery log
        if (status.message && step === 'discovering') {
          addDiscoveryLine(status.message);
        }
      }
    });
    return cleanup;
  }, [api, step]);

  useEffect(() => {
    async function loadConnectorStates() {
      const cfg = await api.getConfig();
      setConnectors(prev => ({
        ...prev,
        claude: { ...prev.claude, enabled: cfg.connector_claude === 'enabled' },
        chatgpt: { ...prev.chatgpt, enabled: cfg.connector_chatgpt === 'enabled' },
        photos: { ...prev.photos, enabled: cfg.connector_photos === 'enabled', folder: cfg.photos_folder },
      }));
    }
    loadConnectorStates();
  }, [api]);

  // Poll for data during the "discovering" step
  useEffect(() => {
    if (step !== 'discovering') return;
    let active = true;

    const poll = async () => {
      while (active) {
        try {
          const stats = await api.getStats();
          setCounters(prev => {
            const updated = {
              moments: stats.momentCount || 0,
              emotions: stats.emotionCount || 0,
              patterns: stats.patternCount || 0,
              people: stats.entityCount || 0,
            };
            // Add discovery log lines for new milestones
            if (updated.moments > prev.moments && updated.moments % 5 === 0) {
              addDiscoveryLine(`${updated.moments} moments ingested...`);
            }
            if (updated.emotions > prev.emotions && updated.emotions > 0 && updated.emotions !== prev.emotions) {
              addDiscoveryLine(`${updated.emotions} emotions detected`);
            }
            if (updated.patterns > prev.patterns) {
              addDiscoveryLine(`New pattern discovered — ${updated.patterns} total`);
            }
            if (updated.people > prev.people) {
              addDiscoveryLine(`${updated.people} people identified`);
            }
            return updated;
          });

          const latestScores = await api.getScores();
          if (latestScores) setScores(latestScores);
        } catch (e) { /* ignore */ }

        await new Promise(r => setTimeout(r, 2000));
      }
    };

    addDiscoveryLine('Connecting to your sources...');
    setTimeout(() => addDiscoveryLine('Watching for conversations...'), 1500);

    poll();
    return () => { active = false; };
  }, [step, api]);

  // Listen for import progress during the discovering step
  useEffect(() => {
    if (step !== 'discovering') return;
    const cleanup = api.onImportProgress?.((p) => {
      if (p.message) addDiscoveryLine(p.message);
    });
    return cleanup;
  }, [step, api]);

  function addDiscoveryLine(text) {
    setDiscoveryLines(prev => [...prev.slice(-12), { text, id: Date.now() + Math.random() }]);
  }

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;
    await api.setConfig('openrouter_api_key', apiKey.trim());
    setStep('connectors');
  };

  const handleToggleConnector = async (provider) => {
    if (provider === 'claude' || provider === 'chatgpt') {
      if (connectors[provider].enabled) {
        await api.closeConnector(provider);
        setConnectors(prev => ({
          ...prev,
          [provider]: { ...prev[provider], enabled: false, status: 'idle', capturedCount: 0 },
        }));
      } else {
        await api.openConnector(provider);
        setConnectors(prev => ({
          ...prev,
          [provider]: { ...prev[provider], enabled: true, status: 'connecting' },
        }));
      }
    } else if (provider === 'photos') {
      if (connectors.photos.enabled) {
        await api.setConfig('connector_photos', 'disabled');
        setConnectors(prev => ({ ...prev, photos: { enabled: false, folder: null } }));
      } else {
        const folder = await api.selectPhotosFolder();
        if (folder) setConnectors(prev => ({ ...prev, photos: { enabled: true, folder } }));
      }
    }
  };

  const handleHistoricalImport = async () => {
    const filePath = await api.selectFile();
    if (!filePath) return;
    setImportError(null);
    setImportProgress({ stage: 'starting', message: 'Starting import...' });

    const cleanup = api.onImportProgress((p) => setImportProgress(p));
    try {
      const result = await api.importConversations(filePath);
      if (result.success) {
        setImportProgress({ stage: 'complete', message: `Imported ${result.momentsCount} moments!` });
        setScores(result.scores);
      } else {
        setImportError(result.error);
        setImportProgress(null);
      }
    } catch (err) {
      setImportError(err.message);
      setImportProgress(null);
    }
    cleanup();
  };

  const hasAnyConnector = connectors.claude.enabled || connectors.chatgpt.enabled ||
    connectors.photos.enabled || importProgress?.stage === 'complete';

  const handleContinueToDiscovery = () => {
    setStep('discovering');
  };

  const handleGoToDashboard = () => {
    onComplete();
  };

  return (
    <div className="h-screen flex items-center justify-center bg-cream overflow-hidden">
      <AnimatePresence mode="wait">

        {/* ---- STEP 1: Welcome ---- */}
        {step === 'welcome' && (
          <FadeStep key="welcome">
            <div className="text-center max-w-lg">
              <motion.h1
                className="font-display text-5xl text-charcoal mb-4 leading-tight"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8 }}
              >
                Your life has patterns<br />you can't see.
              </motion.h1>
              <motion.p
                className="text-lg text-warm-gray font-light mb-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6, duration: 0.8 }}
              >
                Jurni sees them.
              </motion.p>
              <motion.p
                className="text-sm text-warm-gray/60 mb-10 max-w-sm mx-auto"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.2, duration: 0.8 }}
              >
                Connect your AI conversations, photos, and calendar.
                Jurni analyzes them locally on your device and reveals your
                mental, emotional, and relational patterns.
              </motion.p>
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.8 }}
                onClick={() => setStep('apikey')}
                className="px-8 py-3 bg-terracotta text-white rounded-xl font-medium
                           hover:bg-terracotta-dark transition-colors flex items-center gap-2 mx-auto"
              >
                Get Started <ArrowRight size={16} />
              </motion.button>
            </div>
          </FadeStep>
        )}

        {/* ---- STEP 2: API Key ---- */}
        {step === 'apikey' && (
          <FadeStep key="apikey">
            <div className="max-w-md w-full">
              <div className="text-center mb-8">
                <Key size={32} className="text-terracotta mx-auto mb-3" />
                <h2 className="font-display text-2xl mb-2">Connect to AI</h2>
                <p className="text-sm text-warm-gray">
                  Jurni uses AI to understand your conversations.
                  Your data stays on your machine — only anonymized chunks are sent for analysis.
                </p>
              </div>
              <div className="glass-card p-6">
                <label className="text-sm font-medium text-charcoal block mb-2">
                  OpenRouter API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-or-v1-..."
                  className="w-full px-3 py-2.5 bg-white/60 border border-cream-dark rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-terracotta/30 mb-3"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleSaveKey()}
                />
                <a href="https://openrouter.ai/keys" target="_blank" rel="noopener"
                  className="text-xs text-terracotta underline mb-4 block">
                  Don't have one? Get a key at openrouter.ai/keys
                </a>
                <button onClick={handleSaveKey} disabled={!apiKey.trim()}
                  className="w-full px-4 py-2.5 bg-terracotta text-white rounded-lg font-medium
                    hover:bg-terracotta-dark transition-colors disabled:opacity-50
                    flex items-center justify-center gap-2">
                  Continue <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </FadeStep>
        )}

        {/* ---- STEP 3: Connect Sources ---- */}
        {step === 'connectors' && (
          <FadeStep key="connectors">
            <div className="max-w-xl w-full">
              <div className="text-center mb-8">
                <h2 className="font-display text-3xl mb-2">Connect Your Sources</h2>
                <p className="text-sm text-warm-gray">
                  The more you connect, the richer your patterns. Enable at least one.
                </p>
              </div>

              <div className="space-y-4">
                <ConnectorCard
                  icon={MessageSquare} title="Claude"
                  description="Sign in to claude.ai. Jurni observes your conversations."
                  enabled={connectors.claude.enabled}
                  status={connectors.claude.status}
                  capturedCount={connectors.claude.capturedCount}
                  lastMessage={connectors.claude.lastMessage}
                  onToggle={() => handleToggleConnector('claude')}
                  accentColor="terracotta"
                >
                  <button onClick={() => setShowImport(showImport === 'claude' ? null : 'claude')}
                    className="text-xs text-warm-gray hover:text-charcoal-light mt-2 flex items-center gap-1">
                    <FileJson size={12} />
                    {showImport === 'claude' ? 'Hide' : 'Or import historical data (JSON export)'}
                  </button>
                  {showImport === 'claude' && (
                    <ImportSection onImport={handleHistoricalImport}
                      progress={importProgress} error={importError}
                      hint="Claude: Settings → Export" />
                  )}
                </ConnectorCard>

                <ConnectorCard
                  icon={MessageSquare} title="ChatGPT"
                  description="Sign in to chatgpt.com. Jurni observes your conversations."
                  enabled={connectors.chatgpt.enabled}
                  status={connectors.chatgpt.status}
                  capturedCount={connectors.chatgpt.capturedCount}
                  lastMessage={connectors.chatgpt.lastMessage}
                  onToggle={() => handleToggleConnector('chatgpt')}
                  accentColor="terracotta"
                >
                  <button onClick={() => setShowImport(showImport === 'chatgpt' ? null : 'chatgpt')}
                    className="text-xs text-warm-gray hover:text-charcoal-light mt-2 flex items-center gap-1">
                    <FileJson size={12} />
                    {showImport === 'chatgpt' ? 'Hide' : 'Or import historical data (JSON export)'}
                  </button>
                  {showImport === 'chatgpt' && (
                    <ImportSection onImport={handleHistoricalImport}
                      progress={importProgress} error={importError}
                      hint="ChatGPT: Settings → Data Controls → Export" />
                  )}
                </ConnectorCard>

                <ConnectorCard icon={Image} title="Photos"
                  description={connectors.photos.folder ? `Watching: ${connectors.photos.folder}` : 'Select your Photos folder.'}
                  enabled={connectors.photos.enabled}
                  status={connectors.photos.enabled ? 'connected' : 'idle'}
                  onToggle={() => handleToggleConnector('photos')}
                  accentColor="sage" />

                <ConnectorCard icon={CalendarDays} title="Google Calendar"
                  description="Connect your calendar. Coming soon."
                  enabled={false} status="coming_soon"
                  onToggle={() => {}} accentColor="amber" disabled />
              </div>

              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                className="mt-8 flex justify-center">
                <button onClick={handleContinueToDiscovery} disabled={!hasAnyConnector}
                  className="px-8 py-3 bg-terracotta text-white rounded-xl font-medium
                    hover:bg-terracotta-dark transition-colors disabled:opacity-40
                    flex items-center gap-2">
                  Continue <ArrowRight size={16} />
                </button>
              </motion.div>
              {!hasAnyConnector && (
                <p className="text-center text-xs text-warm-gray mt-3">
                  Enable a source or import data to continue
                </p>
              )}
            </div>
          </FadeStep>
        )}

        {/* ---- STEP 4: The "HER" Discovering Moment ---- */}
        {step === 'discovering' && (
          <FadeStep key="discovering">
            <div className="max-w-lg w-full">
              {/* Animated spinner */}
              <div className="flex justify-center mb-8">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
                  className="relative w-24 h-24"
                >
                  <motion.div
                    className="absolute inset-0 rounded-full border-2 border-terracotta/20"
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  <motion.div
                    className="absolute inset-2 rounded-full border-2 border-terracotta/40"
                    animate={{ scale: [1, 0.95, 1] }}
                    transition={{ duration: 2.5, repeat: Infinity }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Sparkles size={28} className="text-terracotta" />
                  </div>
                </motion.div>
              </div>

              <h2 className="font-display text-2xl text-center mb-8">
                {scores ? 'Your patterns are emerging...' : 'Discovering your patterns...'}
              </h2>

              {/* Live counters */}
              <div className="grid grid-cols-4 gap-3 mb-8">
                <CounterBox icon={MessageSquare} value={counters.moments} label="Moments" delay={0} />
                <CounterBox icon={Heart} value={counters.emotions} label="Emotions" delay={0.2} />
                <CounterBox icon={Users} value={counters.people} label="People" delay={0.4} />
                <CounterBox icon={Waves} value={counters.patterns} label="Patterns" delay={0.6} />
              </div>

              {/* Discovery log — the cinematic text feed */}
              <div ref={discoveryRef}
                className="glass-card p-4 h-48 overflow-y-auto space-y-1.5">
                <AnimatePresence initial={false}>
                  {discoveryLines.map((line) => (
                    <motion.div
                      key={line.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4 }}
                      className="flex items-center gap-2"
                    >
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-terracotta/40 flex-shrink-0" />
                      <span className="text-sm text-charcoal-light">{line.text}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {discoveryLines.length === 0 && (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-warm-gray/50 text-sm">Waiting for data...</p>
                  </div>
                )}
              </div>

              {/* Score preview — appears when scores arrive */}
              <AnimatePresence>
                {scores && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                    className="mt-6 flex justify-center"
                  >
                    <ScoreRing score={scores.overall}
                      summary={getRevealSummary(scores.overall)} />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Go to Dashboard */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 3 }}
                className="mt-8 flex flex-col items-center gap-3"
              >
                <button onClick={handleGoToDashboard}
                  className="px-8 py-3 bg-terracotta text-white rounded-xl font-medium
                    hover:bg-terracotta-dark transition-colors flex items-center gap-2">
                  {scores ? 'Explore Your Dashboard' : 'Go to Dashboard'}
                  <ArrowRight size={16} />
                </button>
                <p className="text-xs text-warm-gray">
                  {scores
                    ? 'Your score is ready. Jurni keeps learning in the background.'
                    : 'Jurni will keep ingesting data in the background. You can explore while it works.'}
                </p>
              </motion.div>
            </div>
          </FadeStep>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- Sub-components ----

function FadeStep({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4 }}
      className="flex items-center justify-center px-6 w-full"
    >
      {children}
    </motion.div>
  );
}

function CounterBox({ icon: Icon, value, label, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, type: 'spring', stiffness: 200 }}
      className="glass-card p-3 text-center"
    >
      <Icon size={16} className="text-terracotta mx-auto mb-1" />
      <motion.div
        key={value}
        initial={{ scale: 1.3 }}
        animate={{ scale: 1 }}
        className="text-xl font-bold font-display text-charcoal"
      >
        {value}
      </motion.div>
      <div className="text-xs text-warm-gray">{label}</div>
    </motion.div>
  );
}

function ConnectorCard({ icon: Icon, title, description, enabled, status, capturedCount, lastMessage, onToggle, accentColor, children, disabled }) {
  const colorMap = {
    terracotta: { icon: 'text-terracotta', activeBg: 'bg-terracotta/10', border: 'border-terracotta/20' },
    sage: { icon: 'text-sage-dark', activeBg: 'bg-sage/10', border: 'border-sage/20' },
    amber: { icon: 'text-amber', activeBg: 'bg-amber/10', border: 'border-amber/20' },
  };
  const c = colorMap[accentColor] || colorMap.terracotta;

  const statusLabel = {
    idle: '', connecting: 'Opening browser...', login_required: 'Sign in to continue',
    logged_in: 'Connected — observing', observing: 'Observing', capturing: 'Capturing',
    loaded: 'Connected', navigating: 'Loading...', connected: 'Connected',
    disconnected: 'Disconnected', coming_soon: 'Coming soon',
  };
  const isActive = ['logged_in', 'observing', 'capturing', 'connected', 'loaded'].includes(status);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border p-5 transition-all ${
        enabled ? `${c.activeBg} ${c.border}` : 'bg-white/40 border-cream-dark'
      } ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <div className={`mt-0.5 ${c.icon}`}><Icon size={22} /></div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-medium text-charcoal">{title}</h3>
              {status && statusLabel[status] && (
                <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${
                  isActive ? 'bg-score-green/10 text-score-green'
                    : status === 'coming_soon' ? 'bg-warm-gray/10 text-warm-gray'
                    : 'bg-amber/10 text-amber'}`}>
                  {isActive && <span className="inline-block w-1.5 h-1.5 bg-score-green rounded-full animate-pulse" />}
                  {statusLabel[status]}
                </span>
              )}
              {capturedCount > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-terracotta/10 text-terracotta font-medium">
                  {capturedCount} captured
                </span>
              )}
            </div>
            <p className="text-sm text-warm-gray mt-1">{description}</p>
            {lastMessage && (
              <p className="text-xs text-charcoal-light mt-1.5 truncate italic opacity-70">
                Latest: "{lastMessage}"
              </p>
            )}
            {children}
          </div>
        </div>
        <button onClick={onToggle} disabled={disabled}
          className="ml-4 mt-1 flex-shrink-0 disabled:cursor-not-allowed">
          {enabled ? <ToggleRight size={28} className="text-terracotta" />
            : <ToggleLeft size={28} className="text-warm-gray/40" />}
        </button>
      </div>
    </motion.div>
  );
}

function ImportSection({ onImport, progress, error, hint }) {
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3">
      <button onClick={onImport}
        className="w-full px-3 py-3 bg-white/50 border border-dashed border-terracotta/20
          rounded-xl text-xs text-charcoal-light hover:bg-white/70 transition-colors
          flex items-center justify-center gap-2">
        <Upload size={14} /> Select JSON export file
      </button>
      <p className="text-xs text-warm-gray/60 mt-1 text-center">{hint}</p>
      {error && (
        <div className="mt-2 p-2 bg-score-red/10 text-score-red text-xs rounded-lg flex items-start gap-1">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />{error}
        </div>
      )}
      {progress && (
        <div className="mt-2 p-2 bg-white/40 rounded-lg">
          <p className="text-xs text-charcoal">{progress.message}</p>
          {progress.total > 0 && progress.processed > 0 && (
            <div className="mt-1 bg-cream-dark rounded-full h-1.5 overflow-hidden">
              <div className="h-full bg-terracotta rounded-full transition-all duration-300"
                style={{ width: `${(progress.processed / progress.total) * 100}%` }} />
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

function getRevealSummary(score) {
  if (score >= 70) return "You're doing well. Jurni will help you stay on track.";
  if (score >= 40) return "There are patterns worth watching. Jurni is here to help.";
  return "Jurni sees some things that need attention. Let's work through them together.";
}
