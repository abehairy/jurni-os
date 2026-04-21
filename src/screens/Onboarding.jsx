import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Key, ArrowRight, Sparkles, AlertCircle, MessageSquare, Image,
  CalendarDays, Upload, ToggleLeft, ToggleRight, FileJson, Heart,
  Users, Waves, User, Loader2, CheckCircle2, Lock, Eye, Shield,
} from 'lucide-react';
import ScoreRing from '../components/ScoreRing';
import logoUrl from '../assets/logo.png';

/**
 * First-run flow. Five steps, split-canvas layout:
 *   welcome (hero + SVG landscape preview)
 *   → apikey (key input + trust panel)
 *   → identity (name input + orbit graphic)
 *   → connectors (full-width cards)
 *   → discovering (full-width counters + score)
 *
 * A thin progress bar at the top spans steps 2-5. Welcome is the "front door"
 * and has no progress rail. All surfaces use CSS variables so light/dark
 * themes just work.
 */

const FLOW_STEPS = ['apikey', 'identity', 'connectors', 'discovering'];
const STEP_LABELS = {
  apikey: 'AI',
  identity: 'YOU',
  connectors: 'SOURCES',
  discovering: 'READING',
};

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
  const [nameSuggestedFromOs, setNameSuggestedFromOs] = useState(false);

  // If the user has no name saved yet, try to pre-fill from the OS.
  // Runs once on mount; never overwrites a value the user has typed.
  useEffect(() => {
    if (config.user_name || identityName) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await api.getSystemUserName?.();
        if (cancelled || !result?.name) return;
        setIdentityName(prev => {
          if (prev) return prev;
          setNameSuggestedFromOs(true);
          return result.name;
        });
      } catch (_) { /* silent — fallback is the user typing it */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Connectors ----
  const [connectors, setConnectors] = useState({
    claude: { enabled: false, status: 'idle', capturedCount: 0 },
    chatgpt: { enabled: false, status: 'idle', capturedCount: 0 },
    x: { enabled: false, status: 'idle', capturedCount: 0 },
    linkedin: { enabled: false, status: 'idle', capturedCount: 0 },
    instagram: { enabled: false, status: 'idle', capturedCount: 0 },
    facebook: { enabled: false, status: 'idle', capturedCount: 0 },
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
        x: { ...prev.x, enabled: cfg.connector_x === 'enabled' },
        linkedin: { ...prev.linkedin, enabled: cfg.connector_linkedin === 'enabled' },
        instagram: { ...prev.instagram, enabled: cfg.connector_instagram === 'enabled' },
        facebook: { ...prev.facebook, enabled: cfg.connector_facebook === 'enabled' },
        photos: { ...prev.photos, enabled: cfg.connector_photos === 'enabled', folder: cfg.photos_folder },
      }));
    }
    loadConnectorStates();
  }, [api]);

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
      await api.setConfig('openrouter_api_key', trimmed);
      setKeyInfo(result.data || null);
      setKeyChecking(false);
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
    const browserProviders = ['claude', 'chatgpt', 'x', 'linkedin', 'instagram', 'facebook'];
    if (browserProviders.includes(provider)) {
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

  const hasAnyConnector =
    connectors.claude.enabled ||
    connectors.chatgpt.enabled ||
    connectors.x.enabled ||
    connectors.linkedin.enabled ||
    connectors.instagram.enabled ||
    connectors.facebook.enabled ||
    connectors.photos.enabled ||
    importProgress?.stage === 'complete';

  return (
    <div style={shellStyle()}>
      {step !== 'welcome' && (
        <div style={{
          borderBottom: '0.5px solid var(--border-strong)',
          background: 'var(--shell)',
          flexShrink: 0,
        }}>
          <TopBrand />
          <ProgressBar activeStep={step} />
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <AnimatePresence mode="wait">

        {step === 'welcome' && (
            <StepFrame key="welcome">
              <SplitLayout
                left={
                  <WelcomeContent onNext={() => setStep('apikey')} />
                }
                right={<LandscapePreview />}
              />
            </StepFrame>
          )}

          {step === 'apikey' && (
            <StepFrame key="apikey">
              <SplitLayout
                left={
                  <ApiKeyContent
                    apiKey={apiKey}
                    setApiKey={(v) => { setApiKey(v); setKeyError(null); }}
                    keyChecking={keyChecking}
                    keyError={keyError}
                    keyInfo={keyInfo}
                    onSave={handleSaveKey}
                  />
                }
                right={<TrustPanel />}
              />
            </StepFrame>
          )}

          {step === 'identity' && (
            <StepFrame key="identity">
              <CenteredLayout>
                <IdentityContent
                  identityName={identityName}
                  setIdentityName={(v) => { setIdentityName(v); setNameSuggestedFromOs(false); }}
                  identityAliases={identityAliases}
                  setIdentityAliases={setIdentityAliases}
                  onSave={handleSaveIdentity}
                  suggestedFromOs={nameSuggestedFromOs}
                />
              </CenteredLayout>
            </StepFrame>
          )}

          {step === 'connectors' && (
            <StepFrame key="connectors">
              <FullLayout>
                <ConnectorsContent
                  connectors={connectors}
                  showImport={showImport}
                  setShowImport={setShowImport}
                  importProgress={importProgress}
                  importError={importError}
                  onToggle={handleToggleConnector}
                  onImport={handleHistoricalImport}
                  hasAny={hasAnyConnector}
                  onNext={() => setStep('discovering')}
                />
              </FullLayout>
            </StepFrame>
          )}

          {step === 'discovering' && (
            <StepFrame key="discovering">
              <FullLayout>
                <DiscoveringContent
                  counters={counters}
                  discoveryLines={discoveryLines}
                  discoveryRef={discoveryRef}
                  scores={scores}
                  onComplete={onComplete}
                />
              </FullLayout>
            </StepFrame>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Shell / layout primitives
// ═══════════════════════════════════════════════════════════════════════

function TopBrand() {
  // Left padding of 92px clears the macOS traffic lights (3 buttons × ~20px
  // + margins). 14px top/bottom gives the row ~44px total height which is
  // about the same as the native titlebar, so it feels native.
  return (
    <div style={{
      padding: '14px 40px 14px 92px',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <img src={logoUrl} alt="" width={18} height={18} style={{ display: 'block' }} />
      <span style={{
        fontFamily: 'Georgia, serif',
        fontSize: 14,
        letterSpacing: -0.2,
        color: 'var(--text-primary)',
        opacity: 0.9,
      }}>
        Jurni
      </span>
    </div>
  );
}

function ProgressBar({ activeStep }) {
  const currentIdx = FLOW_STEPS.indexOf(activeStep);
  return (
    <div style={{
      padding: '0 40px 14px 40px',
      display: 'flex', gap: 4,
    }}>
      {FLOW_STEPS.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={s} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <div style={{
              height: 2, borderRadius: 2,
              background: done || active ? 'var(--accent)' : 'var(--border-strong)',
              opacity: done ? 1 : active ? 1 : 0.4,
              transition: 'all 300ms ease',
            }} />
            <div style={{
              fontSize: 9, letterSpacing: 1.8,
              color: active ? 'var(--accent)' : 'var(--text-muted)',
              opacity: active ? 1 : 0.55,
              fontWeight: 500,
              textAlign: 'center',
              fontFamily: 'DM Sans, sans-serif',
            }}>
              {`0${i + 1}`} · {STEP_LABELS[s]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StepFrame({ children }) {
  return (
    <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      style={{ width: '100%', height: '100%', display: 'flex' }}
    >
      {children}
    </motion.div>
  );
}

function SplitLayout({ left, right }) {
  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '40px 72px', minWidth: 0,
      }}>
        <div style={{ maxWidth: 480, width: '100%' }}>
          {left}
        </div>
      </div>
      <div style={{
        flex: 1,
        background: 'var(--surface)',
        borderLeft: '0.5px solid var(--border-strong)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 40, minWidth: 0, overflow: 'hidden',
      }}>
        <div style={{ width: '100%', maxWidth: 560 }}>
          {right}
        </div>
      </div>
    </div>
  );
}

function FullLayout({ children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: '100%', padding: '40px 24px', overflowY: 'auto',
    }}>
      {children}
    </div>
  );
}

function CenteredLayout({ children }) {
  // Single-column centered layout for steps that are just a focused form
  // (like Identity). No split, no right panel — just content.
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: '100%', padding: '40px 24px', overflowY: 'auto',
    }}>
      <div style={{ maxWidth: 460, width: '100%' }}>
        {children}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Step content (left panels)
// ═══════════════════════════════════════════════════════════════════════

function WelcomeContent({ onNext }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 36,
        }}
      >
        <img src={logoUrl} alt="" width={40} height={40} style={{ display: 'block' }} />
        <span style={{
          fontFamily: 'Georgia, serif',
          fontSize: 24,
          letterSpacing: -0.3,
          color: 'var(--text-primary)',
          fontWeight: 400,
        }}>
          Jurni
        </span>
      </motion.div>

      <h1 style={{
        fontFamily: 'Georgia, serif',
        fontStyle: 'italic',
        fontSize: 48,
        lineHeight: 1.08,
        color: 'var(--text-primary)',
        margin: 0,
        marginBottom: 16,
        letterSpacing: -0.8,
      }}>
        A dashboard<br />for your life.
      </h1>
      <p style={{
        fontSize: 16,
        color: 'var(--text-muted)',
        lineHeight: 1.5,
        marginBottom: 36,
        maxWidth: 360,
      }}>
        Like WHOOP, but for everything else.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 36 }}>
        <Pillar icon={Eye} title="See where you stand" text="One clear view. No more scrolling to find the thread." />
        <Pillar icon={Lock} title="Private by default" text="Everything stays on your Mac. No Jurni server, no accounts." />
        <Pillar icon={Sparkles} title="Bring your own AI" text="You control the model and the cost. Typical spend: $2–5/mo." />
            </div>

      <button onClick={onNext} style={primaryBtn()}>
        Get started <ArrowRight size={16} />
      </button>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.7, marginTop: 12 }}>
        About 2 minutes. You'll need an OpenRouter key.
      </p>
    </motion.div>
  );
}

function Pillar({ icon: Icon, title, text }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8,
        background: 'var(--accent-soft)',
        border: '0.5px solid var(--accent-soft-strong)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, marginTop: 2,
      }}>
        <Icon size={13} style={{ color: 'var(--accent)' }} />
              </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {text}
        </div>
      </div>
    </div>
  );
}

function ApiKeyContent({ apiKey, setApiKey, keyChecking, keyError, keyInfo, onSave }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <Eyebrow>Step 01 · AI</Eyebrow>
      <h1 style={heroHeading()}>Bring your own AI.</h1>
      <p style={heroSubhead()}>
        Jurni uses a model you control. Your key stays on this Mac.
      </p>

      <label style={label()}>OpenRouter API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-or-v1-..."
                  autoFocus
        disabled={keyChecking}
        onKeyDown={e => e.key === 'Enter' && onSave()}
        style={input()}
      />
      <a
        href="https://openrouter.ai/keys"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontSize: 12, color: 'var(--accent)', textDecoration: 'underline',
          display: 'inline-block', marginTop: 8, marginBottom: 16,
        }}
      >
        Don't have one? Create a key at openrouter.ai/keys →
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
        onClick={onSave}
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
    </motion.div>
  );
}

function IdentityContent({ identityName, setIdentityName, identityAliases, setIdentityAliases, onSave, suggestedFromOs }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <Eyebrow>Step 02 · You</Eyebrow>
      <h1 style={heroHeading()}>Put yourself in the picture.</h1>
      <p style={heroSubhead()}>
        Jurni reads your conversations from your own point of view. Without
        your name, you'd show up as a stranger in your own dashboard.
      </p>

      <label style={label()}>
        Your name
        {suggestedFromOs && (
          <span style={{
            fontSize: 10, fontWeight: 400, color: 'var(--text-muted)',
            opacity: 0.7, marginLeft: 8, letterSpacing: 0.2,
            textTransform: 'none',
          }}>
            · pulled from your Mac, edit if wrong
          </span>
        )}
      </label>
      <input
        type="text"
        value={identityName}
        onChange={e => setIdentityName(e.target.value)}
        placeholder="e.g. Ahmed Behairy"
        autoFocus
        onKeyDown={e => { if (e.key === 'Enter' && identityName.trim()) onSave(); }}
        style={input()}
      />

      <label style={{ ...label(), marginTop: 18 }}>
        Also known as <span style={{ color: 'var(--text-muted)', fontSize: 11, opacity: 0.75, fontWeight: 400 }}>(optional)</span>
      </label>
      <input
        type="text"
        value={identityAliases}
        onChange={e => setIdentityAliases(e.target.value)}
        placeholder="Beh, Behairy, Ahmed B."
        onKeyDown={e => { if (e.key === 'Enter' && identityName.trim()) onSave(); }}
        style={input()}
      />
      <p style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.8, marginTop: 6, marginBottom: 22 }}>
        Comma-separated. Nicknames, short forms, how people address you.
      </p>

      <button
        onClick={onSave}
        disabled={!identityName.trim()}
        style={primaryBtn({ full: true, disabled: !identityName.trim() })}
      >
        Continue <ArrowRight size={16} />
      </button>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, opacity: 0.75 }}>
        You can change this anytime in Settings.
      </p>
    </motion.div>
  );
}

function ConnectorsContent({
  connectors, showImport, setShowImport, importProgress, importError,
  onToggle, onImport, hasAny, onNext,
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{ width: '100%', maxWidth: 640 }}
    >
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <Eyebrow center>Step 03 · Sources</Eyebrow>
        <h1 style={{ ...heroHeading(), fontSize: 36, textAlign: 'center' }}>
          Bring in your life.
        </h1>
        <p style={{ ...heroSubhead(), textAlign: 'center', margin: '0 auto' }}>
          The more you connect, the sharper the view. Enable at least one.
                </p>
              </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <ConnectorCard
          icon={MessageSquare}
          title="Claude"
          description="Sign in to claude.ai. Jurni reads your conversations as they happen."
                  enabled={connectors.claude.enabled}
                  status={connectors.claude.status}
                  capturedCount={connectors.claude.capturedCount}
                  lastMessage={connectors.claude.lastMessage}
          onToggle={() => onToggle('claude')}
        >
          <InlineImportToggle
            open={showImport === 'claude'}
            onToggle={() => setShowImport(showImport === 'claude' ? null : 'claude')}
            onImport={onImport}
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
          onToggle={() => onToggle('chatgpt')}
        >
          <InlineImportToggle
            open={showImport === 'chatgpt'}
            onToggle={() => setShowImport(showImport === 'chatgpt' ? null : 'chatgpt')}
            onImport={onImport}
            progress={importProgress}
            error={importError}
            hint="ChatGPT: Settings → Data Controls → Export"
          />
                </ConnectorCard>

        <ConnectorCard
          icon={MessageSquare}
          title="X"
          description="Sign in to x.com. Jurni reads your visible posts from your feed."
          enabled={connectors.x.enabled}
          status={connectors.x.status}
          capturedCount={connectors.x.capturedCount}
          lastMessage={connectors.x.lastMessage}
          onToggle={() => onToggle('x')}
        />

        <ConnectorCard
          icon={MessageSquare}
          title="LinkedIn"
          description="Sign in to linkedin.com. Jurni reads visible posts from your feed."
          enabled={connectors.linkedin.enabled}
          status={connectors.linkedin.status}
          capturedCount={connectors.linkedin.capturedCount}
          lastMessage={connectors.linkedin.lastMessage}
          onToggle={() => onToggle('linkedin')}
        />

        <ConnectorCard
          icon={MessageSquare}
          title="Instagram"
          description="Sign in to instagram.com. Jurni reads visible posts from your feed."
          enabled={connectors.instagram.enabled}
          status={connectors.instagram.status}
          capturedCount={connectors.instagram.capturedCount}
          lastMessage={connectors.instagram.lastMessage}
          onToggle={() => onToggle('instagram')}
        />

        <ConnectorCard
          icon={MessageSquare}
          title="Facebook"
          description="Sign in to facebook.com. Jurni reads visible posts from your feed."
          enabled={connectors.facebook.enabled}
          status={connectors.facebook.status}
          capturedCount={connectors.facebook.capturedCount}
          lastMessage={connectors.facebook.lastMessage}
          onToggle={() => onToggle('facebook')}
        />

        <ConnectorCard
          icon={Image}
          title="Photos"
                  description={connectors.photos.folder ? `Watching: ${connectors.photos.folder}` : 'Select your Photos folder.'}
                  enabled={connectors.photos.enabled}
                  status={connectors.photos.enabled ? 'connected' : 'idle'}
          onToggle={() => onToggle('photos')}
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
          onClick={onNext}
          disabled={!hasAny}
          style={primaryBtn({ disabled: !hasAny })}
        >
                  Continue <ArrowRight size={16} />
                </button>
              </motion.div>
      {!hasAny && (
        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 10, opacity: 0.8 }}>
                  Enable a source or import data to continue
                </p>
              )}
    </motion.div>
  );
}

function DiscoveringContent({ counters, discoveryLines, discoveryRef, scores, onComplete }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{ maxWidth: 560, width: '100%' }}
    >
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <Eyebrow center>Step 04 · Reading</Eyebrow>
            </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
                <motion.div
                  animate={{ rotate: 360 }}
          transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
          style={{ position: 'relative', width: 76, height: 76 }}
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
            <Sparkles size={24} style={{ color: 'var(--accent)' }} />
                  </div>
                </motion.div>
              </div>

      <h1 style={{
        fontFamily: 'Georgia, serif', fontStyle: 'italic',
        fontSize: 26, textAlign: 'center', margin: 0, marginBottom: 24,
        color: 'var(--text-primary)', letterSpacing: -0.3,
      }}>
        {scores ? 'Your dashboard is coming together…' : 'Reading your last few weeks…'}
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
        <CounterBox icon={MessageSquare} value={counters.moments} label="Moments" />
        <CounterBox icon={Heart} value={counters.emotions} label="Emotions" />
        <CounterBox icon={Users} value={counters.people} label="People" />
        <CounterBox icon={Waves} value={counters.patterns} label="Signals" />
              </div>

      <div
        ref={discoveryRef}
        style={{ ...card(), padding: 14, height: 168, overflowY: 'auto' }}
      >
                <AnimatePresence initial={false}>
                  {discoveryLines.map((line) => (
                    <motion.div
                      key={line.id}
              initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4 }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, opacity: 0.7 }}>Waiting for data…</p>
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
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Right panel visuals
// ═══════════════════════════════════════════════════════════════════════

/**
 * Stylized mosaic of the Life Landscape. Tiles use the same warm-earth
 * palette families as the real app (work brown, rose, gold, sage, indigo,
 * coral). Tiles fade in with a staggered delay to hint at the narrative
 * moment the real app creates when first opened.
 */
function LandscapePreview() {
  const tiles = [
    { x: 0,   y: 0,   w: 300, h: 220, label: 'Work',   fill: 'url(#gWork)',   spark: true  },
    { x: 300, y: 0,   w: 220, h: 130, label: 'Family', fill: 'url(#gFamily)', spark: false },
    { x: 300, y: 130, w: 220, h: 90,  label: 'Money',  fill: 'url(#gMoney)',  spark: true  },
    { x: 0,   y: 220, w: 180, h: 180, label: 'Mind',   fill: 'url(#gMind)',   spark: false },
    { x: 180, y: 220, w: 120, h: 180, label: 'Body',   fill: 'url(#gBody)',   spark: false },
    { x: 300, y: 220, w: 220, h: 180, label: 'Peers',  fill: 'url(#gPeers)',  spark: true  },
  ];

  return (
    <div style={{ width: '100%' }}>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 0.8 }}
        style={{
          fontFamily: 'Georgia, serif', fontStyle: 'italic',
          fontSize: 17, color: 'var(--text-muted)',
          textAlign: 'center', marginBottom: 20, letterSpacing: -0.2,
          lineHeight: 1.45,
        }}
      >
        This week is quieter on the work front.<br />
        Family is warming up.
      </motion.p>

      <div style={{
        borderRadius: 14,
        overflow: 'hidden',
        border: '0.5px solid var(--border-strong)',
        boxShadow: '0 8px 28px rgba(93, 66, 40, 0.07)',
      }}>
        <svg viewBox="0 0 520 400" width="100%" style={{ display: 'block' }}>
          <defs>
            <linearGradient id="gWork"   x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#B88A66" /><stop offset="1" stopColor="#8C6444" /></linearGradient>
            <linearGradient id="gFamily" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E3B59A" /><stop offset="1" stopColor="#C48A6E" /></linearGradient>
            <linearGradient id="gMoney"  x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#D4B275" /><stop offset="1" stopColor="#A8864A" /></linearGradient>
            <linearGradient id="gMind"   x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9DA7B8" /><stop offset="1" stopColor="#6E7A8C" /></linearGradient>
            <linearGradient id="gBody"   x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#A8BE98" /><stop offset="1" stopColor="#7A9369" /></linearGradient>
            <linearGradient id="gPeers"  x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#DFA38A" /><stop offset="1" stopColor="#B8765E" /></linearGradient>
          </defs>

          {tiles.map((t, i) => (
            <motion.g
              key={t.label}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 + i * 0.12, duration: 0.6 }}
            >
              <rect
                x={t.x + 3} y={t.y + 3} width={t.w - 6} height={t.h - 6}
                rx="8" fill={t.fill}
              />
              <text
                x={t.x + 16} y={t.y + 30}
                fontFamily="Georgia, serif" fontStyle="italic"
                fontSize="15" fill="rgba(255,255,255,0.96)"
                letterSpacing="-0.3"
              >
                {t.label}
              </text>
              {t.w > 150 && t.h > 100 && (
                <text
                  x={t.x + 16} y={t.y + 50}
                  fontFamily="DM Sans, sans-serif"
                  fontSize="9" fill="rgba(255,255,255,0.7)"
                  letterSpacing="1.2"
                >
                  {Math.round(t.w * t.h / 400)}%
                </text>
              )}
              {t.spark && t.w > 150 && (
                <Sparkline x={t.x + 16} y={t.y + t.h - 28} width={t.w - 32} />
              )}
            </motion.g>
          ))}
        </svg>
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.0, duration: 0.8 }}
        style={{
          fontSize: 11, color: 'var(--text-muted)', opacity: 0.7,
          textAlign: 'center', marginTop: 14, letterSpacing: 0.5,
        }}
      >
        A preview · yours will be built from your own conversations
      </motion.p>
    </div>
  );
}

function Sparkline({ x, y, width }) {
  // Simple decorative sparkline across the bottom of a tile.
  const points = [0.4, 0.6, 0.3, 0.7, 0.5, 0.8, 0.55, 0.75];
  const stepX = width / (points.length - 1);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x + i * stepX} ${y - p * 14}`).join(' ');
  return (
    <path d={path} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  );
}

/**
 * Trust panel for the API key step. Three cards describing what actually
 * happens when the user pastes a key, plus a cost callout.
 */
function TrustPanel() {
  // Tints come from the landscape category palette so the onboarding
  // feels like the rest of the app rather than a different universe.
  const rows = [
    {
      icon: Lock,
      title: 'Stored on this Mac',
      text: 'Saved in your local Jurni folder. Never synced, never uploaded.',
      tint: '#7A9369', // body / sage = privacy
      tintSoft: 'rgba(122, 147, 105, 0.12)',
    },
    {
      icon: Eye,
      title: 'Used to read your conversations',
      text: 'Messages are sent to OpenRouter as you chat, in anonymized chunks.',
      tint: '#6E7A8C', // mind / indigo = reading
      tintSoft: 'rgba(110, 122, 140, 0.12)',
    },
    {
      icon: Shield,
      title: 'No Jurni server',
      text: 'Your key talks straight to OpenRouter. We never see it or your data.',
      tint: '#A8864A', // money / gold = trust / ownership
      tintSoft: 'rgba(168, 134, 74, 0.12)',
    },
  ];

  return (
    <div style={{ width: '100%' }}>
      <div style={{
        fontSize: 10, letterSpacing: 1.6, fontWeight: 500,
        color: 'var(--text-muted)', marginBottom: 14, opacity: 0.7,
      }}>
        WHAT HAPPENS WITH YOUR KEY
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(({ icon: Icon, title, text, tint, tintSoft }, i) => (
    <motion.div
            key={title}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.1, duration: 0.4 }}
            style={{
              display: 'flex', gap: 14, padding: '14px 16px',
              background: 'var(--surface-alt)',
              border: '0.5px solid var(--border-strong)',
              borderLeft: `3px solid ${tint}`,
              borderRadius: 12,
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: tintSoft,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Icon size={14} style={{ color: tint }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 3 }}>
                {title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {text}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        style={{
          marginTop: 18, padding: '14px 16px',
          background: 'var(--accent-soft)',
          border: '0.5px solid var(--accent-soft-strong)',
          borderRadius: 12,
          display: 'flex', alignItems: 'center', gap: 14,
        }}
      >
        <div style={{
          fontFamily: 'Georgia, serif', fontStyle: 'italic',
          fontSize: 22, color: 'var(--accent)', lineHeight: 1,
        }}>
          $2–5
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
            Typical cost per month
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            You pay OpenRouter directly. Jurni takes nothing.
          </div>
        </div>
    </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Reusable bits (kept from the previous version)
// ═══════════════════════════════════════════════════════════════════════

function Eyebrow({ children, center = false }) {
  return (
    <div style={{
      fontSize: 10, letterSpacing: 2, fontWeight: 500,
      color: 'var(--text-muted)', opacity: 0.7,
      textTransform: 'uppercase',
      marginBottom: 14,
      textAlign: center ? 'center' : 'left',
    }}>
      {children}
    </div>
  );
}

function CounterBox({ icon: Icon, value, label }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 22 }}
      style={{ ...card(), padding: 12, textAlign: 'center' }}
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

// ═══════════════════════════════════════════════════════════════════════
// Style helpers
// ═══════════════════════════════════════════════════════════════════════

function shellStyle() {
  return {
    height: '100vh',
    width: '100vw',
    background: 'var(--shell)',
    color: 'var(--text-primary)',
    fontFamily: 'DM Sans, system-ui, sans-serif',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  };
}

function heroHeading() {
  return {
    fontFamily: 'Georgia, serif',
    fontSize: 40,
    color: 'var(--text-primary)',
    letterSpacing: -0.6,
    margin: 0,
    marginBottom: 14,
    lineHeight: 1.15,
  };
}

function heroSubhead() {
  return {
    fontSize: 14,
    color: 'var(--text-muted)',
    lineHeight: 1.65,
    marginBottom: 28,
    maxWidth: 420,
  };
}

function primaryBtn({ full = false, disabled = false } = {}) {
  return {
    padding: '12px 22px',
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
    margin: full ? 0 : '0 auto 0 0',
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
    padding: '11px 14px',
    fontSize: 13,
    background: 'var(--surface-alt)',
    border: '0.5px solid var(--border-strong)',
    borderRadius: 10,
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
