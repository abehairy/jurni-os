import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from './components/Sidebar';
import LifeLandscape from './screens/LifeLandscape';
import Settings from './screens/Settings';
import Onboarding from './screens/Onboarding';
import logoUrl from './assets/logo.png';

const api = window.jurni || createMockApi();

function createMockApi() {
  return {
    getConfig: async () => ({}),
    setConfig: async () => true,
    validateOpenRouterKey: async () => ({ ok: true }),
    getSystemUserName: async () => ({ name: '', source: null }),
    getDashboardData: async () => ({ scores: null, stats: { momentCount: 0 }, patterns: [], topInsights: [] }),
    getScores: async () => null,
    getMoments: async () => [],
    getEntities: async () => [],
    getPatterns: async () => [],
    getStats: async () => ({ momentCount: 0, entityCount: 0, patternCount: 0, emotionCount: 0 }),
    getEntityDetail: async () => null,
    importConversations: async () => ({ success: false, error: 'Not running in Electron' }),
    selectFile: async () => null,
    recalculateScores: async () => null,
    deleteAllData: async () => true,
    exportData: async () => null,
    onImportProgress: () => () => { },
    openConnector: async () => true,
    closeConnector: async () => true,
    getConnectorStatus: async () => ({ isOpen: false, enabled: false }),
    syncProvider: async () => ({ ok: false, error: 'Not running in Electron' }),
    onSyncProgress: () => () => { },
    getPins: async () => [],
    addPin: async () => ({ ok: false, error: 'Not running in Electron' }),
    removePin: async () => ({ ok: false, error: 'Not running in Electron' }),
    onPinsChanged: () => () => { },
    selectPhotosFolder: async () => null,
    onConnectorStatus: () => () => { },
    onNewMoment: () => () => { },
    onScoresUpdated: () => () => { },
    onLandscapeUpdated: () => () => { },
    onRecatProgress: () => () => { },
    getLandscape: async () => ({ tiles: [], period: { start: '', end: '', group: 'topic' }, threadStats: { total: 0, pending: 0, done: 0 } }),
    getTileDetail: async () => ({ stories: [], people: [], totalMentions: 0, threadCount: 0 }),
    getTileBriefing: async () => null,
    chatWithTile: async () => ({ ok: false, error: 'Not running in Electron' }),
    recategorizeMoments: async () => ({ ok: false, error: 'Not running in Electron' }),
    rereadAllThreads: async () => ({ ok: false, error: 'Not running in Electron' }),
    getAvailableModels: async () => ({ landscape: [], analysis: [] }),
    getUserIdentity: async () => ({ name: null, aliases: [] }),
    setUserIdentity: async () => ({ ok: false }),
    getLogs: async () => 'No logs (not running in Electron)',
    getLogPath: async () => '~/.jurni/crawler.log',
    onLogEntry: () => () => { },
  };
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('landscape');
  const [config, setConfig] = useState({});
  const [hasData, setHasData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forceOnboarding, setForceOnboarding] = useState(false);
  const [pins, setPins] = useState([]);
  const [pinToOpen, setPinToOpen] = useState(null);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('jurni_theme') || 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('jurni_theme', theme); } catch {}
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  // Pins: load on mount, refresh on 'pins-changed' events from main process.
  const refreshPins = async () => {
    try { setPins(await api.getPins()); } catch {}
  };
  useEffect(() => {
    refreshPins();
    const off = api.onPinsChanged?.(refreshPins);
    return () => off?.();
  }, []);

  const handleOpenPin = (pin) => {
    setCurrentScreen('landscape');
    setPinToOpen(pin);
  };

  useEffect(() => {
    init();
  }, []);

  async function init() {
    setLoading(true);
    try {
      const cfg = await api.getConfig();
      setConfig(cfg);
      const stats = await api.getStats();
      setHasData(stats.momentCount > 0);
    } catch (e) {
      console.error('Init error:', e);
      setHasData(false);
    }
    setLoading(false);
  }

  const handleSetupComplete = async () => {
    setForceOnboarding(false);
    // Reload config and data state
    const cfg = await api.getConfig();
    setConfig(cfg);
    const stats = await api.getStats();
    setHasData(stats.momentCount > 0);
    setCurrentScreen('landscape');
  };

  const handleReset = () => {
    setConfig({});
    setHasData(false);
    setForceOnboarding(true);
    setCurrentScreen('landscape');
  };

  const hasAnyConnector = config.connector_claude === 'enabled' ||
    config.connector_chatgpt === 'enabled' ||
    config.connector_photos === 'enabled';
  const needsSetup = !loading && (forceOnboarding || !config.openrouter_api_key || (!hasData && !hasAnyConnector));

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: 'var(--shell)' }}>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
          <img
            src={logoUrl}
            alt="Jurni"
            width={88}
            height={88}
            style={{ display: 'inline-block', marginBottom: 18 }}
          />
          <h1 className="font-display text-4xl mb-2" style={{ color: 'var(--text-primary)' }}>Jurni</h1>
          <p className="font-light" style={{ color: 'var(--text-muted)' }}>Loading your dashboard…</p>
        </motion.div>
      </div>
    );
  }

  if (needsSetup) {
    return <Onboarding api={api} config={config} onComplete={handleSetupComplete} />;
  }

  const screens = {
    landscape: (
      <LifeLandscape
        api={api}
        onGoToSettings={() => setCurrentScreen('settings')}
        pins={pins}
        onPinsChanged={refreshPins}
        pinToOpen={pinToOpen}
        onPinOpened={() => setPinToOpen(null)}
      />
    ),
    settings: <Settings api={api} config={config} setConfig={setConfig} onReset={handleReset} />,
  };

  // Guard against stale localStorage keys or code paths trying to navigate to deleted screens
  const activeScreen = screens[currentScreen] ? currentScreen : 'landscape';

  // Paint <main> with the same bg as the current screen's surface so the
  // titlebar-drag strip visually continues the screen (no seam at top).
  const mainBg = activeScreen === 'settings' ? 'var(--shell)' : 'var(--surface)';

  return (
    <div className="h-screen flex overflow-hidden">
      <Sidebar
        current={activeScreen}
        onNavigate={setCurrentScreen}
        pins={pins}
        onOpenPin={handleOpenPin}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <main className="flex-1 overflow-y-auto" style={{ background: mainBg }}>
        <div className="titlebar-drag h-8 flex-shrink-0" />
        <AnimatePresence mode="wait">
          <motion.div
            key={activeScreen}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {screens[activeScreen]}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
