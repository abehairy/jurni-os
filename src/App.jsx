import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from './components/Sidebar';
import LifeLandscape from './screens/LifeLandscape';
import Settings from './screens/Settings';
import Onboarding from './screens/Onboarding';

const api = window.jurni || createMockApi();

function createMockApi() {
  return {
    getConfig: async () => ({}),
    setConfig: async () => true,
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
    selectPhotosFolder: async () => null,
    onConnectorStatus: () => () => { },
    onNewMoment: () => () => { },
    onScoresUpdated: () => () => { },
    onLandscapeUpdated: () => () => { },
    onRecatProgress: () => () => { },
    getLandscape: async () => ({ tiles: [], period: { start: '', end: '', group: 'topic' }, threadStats: { total: 0, pending: 0, done: 0 } }),
    getTileDetail: async () => ({ stories: [], people: [], totalMentions: 0, threadCount: 0 }),
    getTileBriefing: async () => null,
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
      <div className="h-screen flex items-center justify-center bg-cream">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
          <h1 className="font-display text-4xl text-charcoal mb-2">Jurni</h1>
          <p className="text-warm-gray font-light">Loading your life patterns...</p>
        </motion.div>
      </div>
    );
  }

  if (needsSetup) {
    return <Onboarding api={api} config={config} onComplete={handleSetupComplete} />;
  }

  const screens = {
    landscape: <LifeLandscape api={api} onGoToSettings={() => setCurrentScreen('settings')} />,
    settings: <Settings api={api} config={config} setConfig={setConfig} onReset={handleReset} />,
  };

  // Guard against stale localStorage keys or code paths trying to navigate to deleted screens
  const activeScreen = screens[currentScreen] ? currentScreen : 'landscape';

  return (
    <div className="h-screen flex overflow-hidden bg-cream">
      <Sidebar current={activeScreen} onNavigate={setCurrentScreen} />
      <main className="flex-1 overflow-y-auto">
        <div className="titlebar-drag h-8 flex-shrink-0" />
        <AnimatePresence mode="wait">
          <motion.div
            key={activeScreen}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="px-8 pb-8"
          >
            {screens[activeScreen]}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
