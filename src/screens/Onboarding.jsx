import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Key, ArrowRight, Sparkles, AlertCircle, MessageSquare, Image,
  CalendarDays, Upload, ToggleLeft, ToggleRight, FileJson, Heart,
  Users, Waves, User, Loader2, CheckCircle2,
} from 'lucide-react';
import ScoreRing from '../components/ScoreRing';
import logoUrl from '../assets/logo.png';

/**
 * First-run flow. Five steps:
 *   welcome → apikey → identity → connectors → discovering
 *
 * Styling uses the same CSS variables as the rest of the app so the shell
 * feels continuous (no jarring cream pop into a dark landscape).
 */
export default function Onboarding({ api, config, onComplete }) {
  const [step, setStep] = useState(() => {
    if (!config.openrouter_api_key) return 'welcome';
    if (!config.user_name) return 'identity';
    return 'connectors';
  });

  // ---- API key ----
  const [apiKey, setApiKey] = useState(config.openrouter_api_key || '');
  const [keyChecking, setKeyChecking] = useState(false);
  const [keyError, setKeyError] = useState(null);
  const [keyInfo, setKeyInfo] = useState(null);

  // ---- Identity ----
  const [identityName, setIdentityName] = useState(config.user_name || '');
  const [identityAliases, setIdentityAliases] = useState(config.user_aliases || '');

  // ---- Connectors ----
  const [connectors, setConnectors] = useState({
    claude: { enabled: false, status: 'idle', capturedCount: 0 },
    chatgpt: { enabled: false, status: 'idle', capturedCount: 0 },
    photos: { enabled: false, folder: null },
    calendar: { enabled: false, status: 'idle' },
  });

  const [showImport, setShowImport] = useState(null);
  const [importProgress, setImportProgress] = useState(null);
  const [importError, setImportError] = useState(null);

  // ---- Discovering counters ----
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

  // Poll for data during discovery
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
            if (updated.moments > prev.moments && updated.moments % 5 === 0) {
              addDiscoveryLine(`${updated.moments} moments ingested...`);
            }
            if (updated.emotions > prev.emotions && updated.emotions > 0 && updated.emotions !== prev.emotions) {
              addDiscoveryLine(`${updated.emotions} emotions detected`);
            }
            if (updated.patterns > prev.patterns) {
              addDiscoveryLine(`Another signal — ${updated.patterns} so far`);
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

  // Validate the OpenRouter key with a single auth-check call before
  // moving past the API key step. Prevents the "silent typo" failure mode.
  const handleSaveKey = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    setKeyError(null);
    setKeyInfo(null);
    setKeyChecking(true);
    try {
      const result = await api.validateOpenRouterKey?.(trimmed);
      if (!result || !result.ok) {
        setKeyError(result?.reason || 'Could not validate the key');
        setKeyChecking(false);
        return;
      }
      // Persist only after validation passes
      await api.setConfig('openrouter_api_key', trimmed);
      setKeyInfo(result.data || null);
      setKeyChecking(false);
      // Tiny delay so user sees the ✓ before transition
      setTimeout(() => setStep('identity'), 420);
    } catch (e) {
      setKeyError(e.message || 'Validation failed');
      setKeyChecking(false);
    }
  };

  const handleSaveIdentity = async () => {
    if (!identityName.trim()) return;
    await api.setUserIdentity({
      name: identityName.trim(),
      aliases: identityAliases.trim(),
    });
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

  const containerStyle = {
    height: '100vh',
    width: '100vw',
    background: 'var(--shell)',
    color: 'var(--text-primary)',
    fontFamily: 'DM Sans, system-ui, sans-serif',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <div style={containerStyle}>
      <AnimatePresence mode="wait">

        {/* ---- Welcome ---- */}
        {step === 'welcome' && (
          <FadeStep key="welcome">
            <div style={{ textAlign: 'center', maxWidth: 520 }}>
              <motion.img
                src={logoUrl}
                alt="Jurni"
                width={110}
                height={110}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                style={{ display: 'inline-block', marginBottom: 26 }}
              />
              <motion.h1
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.8 }}
                style={{
                  fontFamily: 'Georgia, serif',
                  fontStyle: 'italic',
                  fontSize: 42,
                  lineHeight: 1.2,
                  color: 'var(--text-primary)',
                  marginBottom: 16,
                  letterSpacing: -0.3,
                }}
              >
                A dashboard<br />for your life.
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7, duration: 0.8 }}
                style={{
                  fontSize: 16,
                  color: 'var(--text-muted)',
                  marginBottom: 10,
                }}
              >
                Clarity, not noise.
              </motion.p>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.1, duration: 0.8 }}
                style={{
                  fontSize: 13,
                  color: 'var(--text-muted)',
                  opacity: 0.8,
                  marginBottom: 36,
                  lineHeight: 1.6,
                  maxWidth: 400,
                  marginLeft: 'auto',
                  marginRight: 'auto',
                }}
              >
                Jurni quietly reads what you're already doing — your conversations,
                photos, calendar — and turns it into one clear view of where you stand.
                So you can decide what matters next, without over-thinking it.
              </motion.p>
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5 }}
                onClick={() => setStep('apikey')}
                style={primaryBtn()}
              >
                Get Started <ArrowRight size={16} />
              </motion.button>
            </div>
          </FadeStep>
        )}

        {/* ---- API key ---- */}
        {step === 'apikey' && (
          <FadeStep key="apikey">
            <div style={{ maxWidth: 440, width: '100%' }}>
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <div style={iconBadge()}>
                  <Key size={20} style={{ color: 'var(--accent)' }} />
                </div>
                <h2 style={sectionHeading()}>Connect to AI</h2>
                <p style={sectionSubheading()}>
                  Jurni uses AI to read your conversations. Everything stays on
                  your machine — only anonymized chunks ever leave it.
                </p>
              </div>
              <div style={card()}>
                <label style={label()}>OpenRouter API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); setKeyError(null); }}
                  placeholder="sk-or-v1-..."
                  autoFocus
                  disabled={keyChecking}
                  onKeyDown={e => e.key === 'Enter' && handleSaveKey()}
                  style={input()}
                />
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 12,
                    color: 'var(--accent)',
                    textDecoration: 'underline',
                    display: 'block',
                    marginTop: 10,
                    marginBottom: 16,
                  }}
                >
                  Don't have one? Get a key at openrouter.ai/keys
                </a>

                {keyError && (
                  <div style={errorBox()}>
                    <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>{keyError}</span>
                  </div>
                )}
                {keyInfo && !keyError && (
                  <div style={successBox()}>
                    <CheckCircle2 size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      Key verified{keyInfo.label ? ` — ${keyInfo.label}` : ''}
                      {typeof keyInfo.limit === 'number' && typeof keyInfo.usage === 'number'
                        ? ` · $${(keyInfo.limit - keyInfo.usage).toFixed(2)} remaining`
                        : ''}
                    </span>
                  </div>
                )}

                <button
                  onClick={handleSaveKey}
                  disabled={!apiKey.trim() || keyChecking}
                  style={primaryBtn({ full: true, disabled: !apiKey.trim() || keyChecking })}
                >
                  {keyChecking ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      Verifying…
                    </>
                  ) : (
                    <>
                      Continue <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </div>
            </div>
          </FadeStep>
        )}

        {/* ---- Identity ---- */}
        {step === 'identity' && (
          <FadeStep key="identity">
            <div style={{ maxWidth: 440, width: '100%' }}>
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <div style={iconBadge()}>
                  <User size={20} style={{ color: 'var(--accent)' }} />
                </div>
                <h2 style={sectionHeading()}>Who are you?</h2>
                <p style={sectionSubheading()}>
                  Jurni reads your conversations from your own point of view.
                  Without your name, you'd show up as a stranger in your own
                  dashboard.
                </p>
              </div>
              <div style={card()}>
                <label style={label()}>Your name</label>
                <input
                  type="text"
                  value={identityName}
                  onChange={e => setIdentityName(e.target.value)}
                  placeholder="e.g. Ahmed Behairy"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter' && identityName.trim()) handleSaveIdentity(); }}
                  style={input()}
                />

                <label style={{ ...label(), marginTop: 18 }}>
                  Also known as <span style={{ color: 'var(--text-muted)', fontSize: 11, opacity: 0.75 }}>(optional)</span>
                </label>
                <input
                  type="text"
                  value={identityAliases}
                  onChange={e => setIdentityAliases(e.target.value)}
                  placeholder="Beh, Behairy, Ahmed B."
                  onKeyDown={e => { if (e.key === 'Enter' && identityName.trim()) handleSaveIdentity(); }}
                  style={input()}
                />
                <p style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.8, marginTop: 6, marginBottom: 18 }}>
                  Comma-separated. Nicknames, short forms, how people address you.
                </p>

                <button
                  onClick={handleSaveIdentity}
                  disabled={!identityName.trim()}
                  style={primaryBtn({ full: true, disabled: !identityName.trim() })}
                >
                  Continue <ArrowRight size={16} />
                </button>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 14, opacity: 0.8 }}>
                  You can change this anytime in Settings.
                </p>
              </div>
            </div>
          </FadeStep>
        )}

        {/* ---- Connectors ---- */}
        {step === 'connectors' && (
          <FadeStep key="connectors">
            <div style={{ maxWidth: 600, width: '100%' }}>
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <h2 style={{ ...sectionHeading(), fontSize: 30 }}>Connect your sources</h2>
                <p style={sectionSubheading()}>
                  The more you connect, the richer your patterns. Enable at least one.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <ConnectorCard
                  icon={MessageSquare}
                  title="Claude"
                  description="Sign in to claude.ai. Jurni reads your conversations as they happen."
                  enabled={connectors.claude.enabled}
                  status={connectors.claude.status}
                  capturedCount={connectors.claude.capturedCount}
                  lastMessage={connectors.claude.lastMessage}
                  onToggle={() => handleToggleConnector('claude')}
                >
                  <InlineImportToggle
                    open={showImport === 'claude'}
                    onToggle={() => setShowImport(showImport === 'claude' ? null : 'claude')}
                    onImport={handleHistoricalImport}
                    progress={importProgress}
                    error={importError}
                    hint="Claude: Settings → Export"
                  />
                </ConnectorCard>

                <ConnectorCard
                  icon={MessageSquare}
                  title="ChatGPT"
                  description="Sign in to chatgpt.com. Jurni reads your conversations as they happen."
                  enabled={connectors.chatgpt.enabled}
                  status={connectors.chatgpt.status}
                  capturedCount={connectors.chatgpt.capturedCount}
                  lastMessage={connectors.chatgpt.lastMessage}
                  onToggle={() => handleToggleConnector('chatgpt')}
                >
                  <InlineImportToggle
                    open={showImport === 'chatgpt'}
                    onToggle={() => setShowImport(showImport === 'chatgpt' ? null : 'chatgpt')}
                    onImport={handleHistoricalImport}
                    progress={importProgress}
                    error={importError}
                    hint="ChatGPT: Settings → Data Controls → Export"
                  />
                </ConnectorCard>

                <ConnectorCard
                  icon={Image}
                  title="Photos"
                  description={connectors.photos.folder ? `Watching: ${connectors.photos.folder}` : 'Select your Photos folder.'}
                  enabled={connectors.photos.enabled}
                  status={connectors.photos.enabled ? 'connected' : 'idle'}
                  onToggle={() => handleToggleConnector('photos')}
                />

                <ConnectorCard
                  icon={CalendarDays}
                  title="Google Calendar"
                  description="Connect your calendar. Coming soon."
                  enabled={false}
                  status="coming_soon"
                  onToggle={() => {}}
                  disabled
                />
              </div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                style={{ marginTop: 28, display: 'flex', justifyContent: 'center' }}
              >
                <button
                  onClick={() => setStep('discovering')}
                  disabled={!hasAnyConnector}
                  style={primaryBtn({ disabled: !hasAnyConnector })}
                >
                  Continue <ArrowRight size={16} />
                </button>
              </motion.div>
              {!hasAnyConnector && (
                <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 10, opacity: 0.8 }}>
                  Enable a source or import data to continue
                </p>
              )}
            </div>
          </FadeStep>
        )}

        {/* ---- Discovering ---- */}
        {step === 'discovering' && (
          <FadeStep key="discovering">
            <div style={{ maxWidth: 540, width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
                  style={{ position: 'relative', width: 90, height: 90 }}
                >
                  <motion.div
                    animate={{ scale: [1, 1.08, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    style={{
                      position: 'absolute', inset: 0, borderRadius: '50%',
                      border: '2px solid var(--accent-soft-strong)',
                    }}
                  />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Sparkles size={28} style={{ color: 'var(--accent)' }} />
                  </div>
                </motion.div>
              </div>

              <h2 style={{
                fontFamily: 'Georgia, serif', fontStyle: 'italic',
                fontSize: 24, textAlign: 'center', marginBottom: 28,
                color: 'var(--text-primary)',
              }}>
                {scores ? 'Your dashboard is coming together…' : 'Reading your last few weeks…'}
              </h2>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 22 }}>
                <CounterBox icon={MessageSquare} value={counters.moments} label="Moments" />
                <CounterBox icon={Heart} value={counters.emotions} label="Emotions" />
                <CounterBox icon={Users} value={counters.people} label="People" />
                <CounterBox icon={Waves} value={counters.patterns} label="Signals" />
              </div>

              <div
                ref={discoveryRef}
                style={{
                  ...card(),
                  padding: 14,
                  height: 172,
                  overflowY: 'auto',
                }}
              >
                <AnimatePresence initial={false}>
                  {discoveryLines.map((line) => (
                    <motion.div
                      key={line.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4 }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '3px 0',
                      }}
                    >
                      <span style={{
                        width: 5, height: 5, borderRadius: '50%',
                        background: 'var(--accent)', opacity: 0.55, flexShrink: 0,
                      }} />
                      <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{line.text}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {discoveryLines.length === 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100%',
                  }}>
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, opacity: 0.7 }}>
                      Waiting for data…
                    </p>
                  </div>
                )}
              </div>

              <AnimatePresence>
                {scores && (
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}
                  >
                    <ScoreRing score={scores.overall} summary={getRevealSummary(scores.overall)} />
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 2.5 }}
                style={{ marginTop: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}
              >
                <button onClick={onComplete} style={primaryBtn()}>
                  {scores ? 'Open your dashboard' : 'Go to dashboard'}
                  <ArrowRight size={16} />
                </button>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.8 }}>
                  {scores
                    ? "You're ready. Jurni stays running in the background."
                    : 'Jurni will keep reading in the background. Explore while it works.'}
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
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.4 }}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 24px', width: '100%',
      }}
    >
      {children}
    </motion.div>
  );
}

function CounterBox({ icon: Icon, value, label }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 22 }}
      style={{
        ...card(),
        padding: 12,
        textAlign: 'center',
      }}
    >
      <Icon size={15} style={{ color: 'var(--accent)', margin: '0 auto 4px', display: 'block' }} />
      <motion.div
        key={value}
        initial={{ scale: 1.2 }}
        animate={{ scale: 1 }}
        style={{
          fontFamily: 'Georgia, serif',
          fontSize: 22,
          color: 'var(--text-primary)',
          fontWeight: 500,
        }}
      >
        {value}
      </motion.div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 2 }}>
        {label}
      </div>
    </motion.div>
  );
}

function ConnectorCard({ icon: Icon, title, description, enabled, status, capturedCount, lastMessage, onToggle, children, disabled }) {
  const statusLabel = {
    idle: '', connecting: 'Opening browser…', login_required: 'Sign in to continue',
    logged_in: 'Connected — observing', observing: 'Observing', capturing: 'Capturing',
    loaded: 'Connected', navigating: 'Loading…', connected: 'Connected',
    disconnected: 'Disconnected', coming_soon: 'Coming soon',
  };
  const isActive = ['logged_in', 'observing', 'capturing', 'connected', 'loaded'].includes(status);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        padding: 18,
        borderRadius: 12,
        background: enabled ? 'var(--accent-soft)' : 'var(--surface)',
        border: `0.5px solid ${enabled ? 'var(--accent-soft-strong)' : 'var(--border-strong)'}`,
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ display: 'flex', gap: 12, flex: 1, minWidth: 0 }}>
          <Icon size={20} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>{title}</h3>
              {status && statusLabel[status] && (
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 10,
                  background: isActive ? 'rgba(107, 158, 107, 0.14)' : 'var(--hover-overlay)',
                  color: isActive ? '#6B9E6B' : 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', gap: 5,
                  letterSpacing: 0.3,
                }}>
                  {isActive && (
                    <span style={{
                      width: 5, height: 5, borderRadius: '50%', background: '#6B9E6B',
                      animation: 'pulse 1.5s infinite',
                    }} />
                  )}
                  {statusLabel[status]}
                </span>
              )}
              {capturedCount > 0 && (
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 10,
                  background: 'var(--accent-soft-strong)',
                  color: 'var(--accent)',
                  fontWeight: 500,
                }}>
                  {capturedCount} captured
                </span>
              )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0, lineHeight: 1.5 }}>
              {description}
            </p>
            {lastMessage && (
              <p style={{
                fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic',
                marginTop: 4, marginBottom: 0, opacity: 0.75,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                Latest: "{lastMessage}"
              </p>
            )}
            {children}
          </div>
        </div>
        <button
          onClick={onToggle}
          disabled={disabled}
          style={{
            background: 'transparent', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
            padding: 0, flexShrink: 0, marginTop: 2,
          }}
          aria-label={enabled ? `Disable ${title}` : `Enable ${title}`}
        >
          {enabled
            ? <ToggleRight size={28} style={{ color: 'var(--accent)' }} />
            : <ToggleLeft size={28} style={{ color: 'var(--text-muted)', opacity: 0.6 }} />}
        </button>
      </div>
    </motion.div>
  );
}

function InlineImportToggle({ open, onToggle, onImport, progress, error, hint }) {
  return (
    <>
      <button
        onClick={onToggle}
        style={{
          fontSize: 11, color: 'var(--text-muted)', background: 'transparent', border: 'none',
          padding: 0, marginTop: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          fontFamily: 'inherit',
        }}
      >
        <FileJson size={11} />
        {open ? 'Hide' : 'Or import historical data (JSON export)'}
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          style={{ marginTop: 10 }}
        >
          <button
            onClick={onImport}
            style={{
              width: '100%', padding: '12px 14px',
              background: 'var(--surface-alt)',
              border: '1px dashed var(--accent-soft-strong)',
              borderRadius: 10,
              fontSize: 12, color: 'var(--text-primary)',
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <Upload size={13} /> Select JSON export file
          </button>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.75, marginTop: 4, textAlign: 'center' }}>
            {hint}
          </p>
          {error && (
            <div style={{ ...errorBox(), marginTop: 8 }}>
              <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />{error}
            </div>
          )}
          {progress && (
            <div style={{
              marginTop: 8, padding: 10,
              background: 'var(--hover-overlay)',
              border: '0.5px solid var(--border-strong)',
              borderRadius: 8,
            }}>
              <p style={{ fontSize: 11, color: 'var(--text-primary)', margin: 0 }}>{progress.message}</p>
              {progress.total > 0 && progress.processed > 0 && (
                <div style={{
                  marginTop: 6, height: 2,
                  background: 'var(--border-strong)',
                  borderRadius: 2, overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%', background: 'var(--accent)',
                    width: `${(progress.processed / progress.total) * 100}%`,
                    transition: 'width 300ms ease',
                  }} />
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}
    </>
  );
}

function getRevealSummary(score) {
  if (score >= 70) return 'Steady across the board.';
  if (score >= 40) return 'A few things pulling on your attention.';
  return 'A lot stacked up right now.';
}

// ---- Styles ----

function primaryBtn({ full = false, disabled = false } = {}) {
  return {
    padding: '11px 22px',
    background: disabled ? 'var(--accent-soft)' : 'var(--accent)',
    color: disabled ? 'var(--accent)' : '#FFFFFF',
    border: 'none',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    fontFamily: 'inherit',
    width: full ? '100%' : 'auto',
    margin: full ? 0 : '0 auto',
    transition: 'all 0.15s ease',
    opacity: disabled ? 0.7 : 1,
  };
}

function card() {
  return {
    padding: 22,
    background: 'var(--surface)',
    border: '0.5px solid var(--border-strong)',
    borderRadius: 14,
  };
}

function iconBadge() {
  return {
    width: 44, height: 44, borderRadius: '50%',
    background: 'var(--accent-soft)',
    border: '0.5px solid var(--accent-soft-strong)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    margin: '0 auto 14px',
  };
}

function sectionHeading() {
  return {
    fontFamily: 'Georgia, serif',
    fontSize: 24,
    color: 'var(--text-primary)',
    letterSpacing: -0.3,
    marginBottom: 8,
    margin: 0,
    marginTop: 0,
  };
}

function sectionSubheading() {
  return {
    fontSize: 13,
    color: 'var(--text-muted)',
    lineHeight: 1.6,
    marginTop: 8,
    maxWidth: 380,
    marginLeft: 'auto',
    marginRight: 'auto',
  };
}

function label() {
  return {
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--text-primary)',
    display: 'block',
    marginBottom: 6,
    letterSpacing: 0.3,
  };
}

function input() {
  return {
    width: '100%',
    padding: '10px 12px',
    fontSize: 13,
    background: 'var(--surface-alt)',
    border: '0.5px solid var(--border-strong)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    outline: 'none',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s ease',
  };
}

function errorBox() {
  return {
    display: 'flex', alignItems: 'flex-start', gap: 6,
    fontSize: 11,
    color: '#C44444',
    background: 'rgba(196, 68, 68, 0.08)',
    border: '0.5px solid rgba(196, 68, 68, 0.25)',
    borderRadius: 8,
    padding: '8px 10px',
    marginBottom: 12,
    lineHeight: 1.45,
  };
}

function successBox() {
  return {
    display: 'flex', alignItems: 'flex-start', gap: 6,
    fontSize: 11,
    color: '#5E8C5E',
    background: 'rgba(107, 158, 107, 0.10)',
    border: '0.5px solid rgba(107, 158, 107, 0.25)',
    borderRadius: 8,
    padding: '8px 10px',
    marginBottom: 12,
    lineHeight: 1.45,
  };
}
