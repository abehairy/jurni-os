import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Key, Upload, Trash2, Download, FileJson, Check, AlertCircle, Loader2, RotateCcw, Terminal, Copy, FolderOpen, Sparkles, Brain, User, RefreshCw } from 'lucide-react';

export default function Settings({ api, config, setConfig, onReset }) {
  const [apiKey, setApiKey] = useState(config.openrouter_api_key || '');
  const [saved, setSaved] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [logPath, setLogPath] = useState('');
  const logEndRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [availableModels, setAvailableModels] = useState({ landscape: [], analysis: [] });
  const [modelSaved, setModelSaved] = useState(null);
  const [rereadRunning, setRereadRunning] = useState(false);
  const [rereadDone, setRereadDone] = useState(null);
  const [identityName, setIdentityName] = useState('');
  const [identityAliases, setIdentityAliases] = useState('');
  const [identitySaved, setIdentitySaved] = useState(null);
  // Per-provider sync state: { claude: { running, added, skipped, stage, result } }
  const [syncState, setSyncState] = useState({});

  useEffect(() => {
    api.getAvailableModels?.().then(setAvailableModels).catch(() => {});
    api.getUserIdentity?.().then(i => {
      setIdentityName(i?.name || '');
      // Don't include the auto-derived token aliases — only what the user typed
      const typed = (config.user_aliases || '').trim();
      setIdentityAliases(typed);
    }).catch(() => {});
  }, [api]);

  // Wire up live sync-progress events so the button reflects real progress.
  useEffect(() => {
    if (!api.onSyncProgress) return;
    const cleanup = api.onSyncProgress((p) => {
      setSyncState(prev => ({
        ...prev,
        [p.provider]: {
          running: p.stage !== 'complete' && p.stage !== 'error',
          stage: p.stage,
          message: p.message ?? prev[p.provider]?.message ?? null,
          added: p.added ?? prev[p.provider]?.added ?? 0,
          skipped: p.skipped ?? prev[p.provider]?.skipped ?? 0,
          processed: p.processed ?? prev[p.provider]?.processed ?? 0,
          total: p.total ?? prev[p.provider]?.total ?? 0,
          fetched: p.fetched ?? prev[p.provider]?.fetched ?? 0,
          threadsSkipped: p.threadsSkipped ?? prev[p.provider]?.threadsSkipped ?? 0,
          error: p.error || null,
          finishedAt: (p.stage === 'complete' || p.stage === 'error') ? Date.now() : prev[p.provider]?.finishedAt,
        },
      }));
    });
    return cleanup;
  }, [api]);

  const handleSyncProvider = async (provider) => {
    if (syncState[provider]?.running) return;

    // If the IPC handler isn't wired up (old main process / web dev), fail loud.
    if (typeof api.syncProvider !== 'function') {
      setSyncState(prev => ({ ...prev, [provider]: {
        running: false, stage: 'error', added: 0, skipped: 0,
        error: 'Sync not available — please fully restart the app.',
      }}));
      return;
    }

    setSyncState(prev => ({ ...prev, [provider]: {
      running: true, stage: 'starting', added: 0, skipped: 0, error: null, message: null,
    }}));

    try {
      const result = await api.syncProvider(provider);
      // If the sync-progress event already marked us complete, respect that.
      // Otherwise fall back to the Promise result so the UI never hangs.
      setSyncState(prev => {
        const cur = prev[provider] || {};
        if (!cur.running) return prev;
        return {
          ...prev,
          [provider]: {
            running: false,
            stage: result?.ok ? 'complete' : 'error',
            message: null,
            added: result?.added ?? cur.added ?? 0,
            skipped: result?.skipped ?? cur.skipped ?? 0,
            error: result?.ok ? null : (result?.error || 'Sync did not complete'),
            finishedAt: Date.now(),
          },
        };
      });
    } catch (err) {
      // IPC failure (missing handler, main crashed, etc.) — never hang.
      setSyncState(prev => ({ ...prev, [provider]: {
        running: false, stage: 'error', added: 0, skipped: 0,
        error: err?.message || 'Sync failed to start. Try restarting the app.',
      }}));
    }
  };

  const handleSaveIdentity = async () => {
    const result = await api.setUserIdentity?.({ name: identityName, aliases: identityAliases });
    setConfig(prev => ({ ...prev, user_name: identityName, user_aliases: identityAliases }));
    setIdentitySaved({
      removedEntities: result?.removedEntities || 0,
      resetThreads: result?.resetThreads || 0,
    });
    setTimeout(() => setIdentitySaved(null), 4000);
  };

  const handleModelChange = async (kind, modelId) => {
    const configKey = kind === 'landscape' ? 'landscape_model' : 'analysis_model';
    await api.setConfig(configKey, modelId);
    setConfig(prev => ({ ...prev, [configKey]: modelId }));
    setModelSaved(kind);
    setTimeout(() => setModelSaved(null), 1800);
  };

  const handleReread = async () => {
    if (!confirm('Wipe all existing topic/category/tone/summary data and re-read every conversation with the current model and prompt? This will take a while.')) return;
    setRereadRunning(true);
    setRereadDone(null);
    try {
      const result = await api.rereadAllThreads?.();
      setRereadDone(result?.wiped ?? 0);
      setTimeout(() => setRereadRunning(false), 2000);
    } catch {
      setRereadRunning(false);
    }
  };

  const handleSaveKey = async () => {
    await api.setConfig('openrouter_api_key', apiKey);
    setConfig(prev => ({ ...prev, openrouter_api_key: apiKey }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleImport = useCallback(async () => {
    const filePath = await api.selectFile();
    if (!filePath) return;

    setImporting(true);
    setImportResult(null);
    setImportProgress({ stage: 'starting', message: 'Starting import...' });

    const cleanup = api.onImportProgress((progress) => {
      setImportProgress(progress);
    });

    try {
      const result = await api.importConversations(filePath);
      setImportResult(result);
    } catch (err) {
      setImportResult({ success: false, error: err.message });
    }

    setImporting(false);
    cleanup();
  }, [api]);

  const handleReset = async () => {
    if (!confirm('Reset Jurni completely? This deletes ALL data and connectors, and takes you back to the welcome screen. This cannot be undone.')) return;
    await api.deleteAllData();
    // Clear all config keys
    await api.setConfig('openrouter_api_key', '');
    await api.setConfig('connector_claude', '');
    await api.setConfig('connector_chatgpt', '');
    await api.setConfig('connector_photos', '');
    await api.setConfig('photos_folder', '');
    // Close any open connectors
    try { await api.closeConnector('claude'); } catch {}
    try { await api.closeConnector('chatgpt'); } catch {}
    if (onReset) onReset();
  };

  useEffect(() => {
    if (!showLogs) return;
    api.getLogPath().then(p => setLogPath(p));
    api.getLogs().then(text => {
      setLogLines(text.split('\n').filter(Boolean));
    });
    const cleanup = api.onLogEntry((entry) => {
      const line = `[${entry.ts}] [${entry.source}] ${entry.message}${entry.data ? ' | ' + JSON.stringify(entry.data) : ''}`;
      setLogLines(prev => [...prev.slice(-500), line]);
    });
    return cleanup;
  }, [showLogs, api]);

  useEffect(() => {
    if (showLogs && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logLines, showLogs]);

  const handleCopyLogs = async () => {
    try {
      const text = await api.getLogs();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleDeleteData = async () => {
    if (!confirm('Delete all processed data? Your connectors and API key will stay. This cannot be undone.')) return;
    await api.deleteAllData();
    setImportResult({ success: true, message: 'All data deleted. Reconnect or import to start fresh.' });
  };

  const handleExport = async () => {
    const path = await api.exportData();
    if (path) {
      setImportResult({ success: true, error: null, message: `Exported to ${path}` });
    }
  };

  return (
    <div
      style={{
        background: 'var(--shell)',
        color: 'var(--text-primary)',
        minHeight: 'calc(100vh - 32px)',
        padding: '32px 40px 40px',
      }}
    >
      <div className="max-w-xl mx-auto space-y-8">
      <h2 className="font-display text-2xl">Settings</h2>

      {/* About You */}
      <section className="glass-card p-6">
        <div className="flex items-center gap-2 mb-3">
          <User size={18} className="text-terracotta" />
          <h3 className="font-display text-lg">About You</h3>
        </div>
        <p className="text-sm text-warm-gray mb-4">
          Jurni needs to know your name so it doesn't treat you as a subject inside
          your own life. Without this, you end up as a &ldquo;peer&rdquo; and your name becomes a
          topic, which makes the landscape meaningless.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-warm-gray block mb-1">Your name</label>
            <input
              type="text"
              value={identityName}
              onChange={e => setIdentityName(e.target.value)}
              placeholder="e.g. Ahmed Behairy"
              className="w-full px-3 py-2 bg-white/60 border border-cream-dark rounded-lg text-sm
                focus:outline-none focus:ring-2 focus:ring-terracotta/30"
            />
          </div>
          <div>
            <label className="text-xs text-warm-gray block mb-1">
              Also known as <span className="text-warm-gray/70">(comma-separated, optional)</span>
            </label>
            <input
              type="text"
              value={identityAliases}
              onChange={e => setIdentityAliases(e.target.value)}
              placeholder="e.g. Beh, Behairy, Ahmed B."
              className="w-full px-3 py-2 bg-white/60 border border-cream-dark rounded-lg text-sm
                focus:outline-none focus:ring-2 focus:ring-terracotta/30"
            />
            <p className="text-xs text-warm-gray/70 mt-1">
              Aliases include how people address you, sign-offs, short forms, etc.
            </p>
          </div>
          <button
            onClick={handleSaveIdentity}
            disabled={!identityName.trim()}
            className="px-4 py-2 bg-terracotta text-white rounded-lg text-sm font-medium
              hover:bg-terracotta-dark transition-colors disabled:opacity-50
              disabled:cursor-not-allowed flex items-center gap-2"
          >
            {identitySaved
              ? <><Check size={14} /> Saved</>
              : 'Save identity'}
          </button>
          {identitySaved && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-xs text-score-green"
            >
              Cleaned {identitySaved.removedEntities} entity rows,
              {' '}reset {identitySaved.resetThreads} moments — they'll be re-categorized.
            </motion.p>
          )}
        </div>
      </section>

      {/* API Key */}
      <section className="glass-card p-6">
        <div className="flex items-center gap-2 mb-3">
          <Key size={18} className="text-terracotta" />
          <h3 className="font-display text-lg">OpenRouter API Key</h3>
        </div>
        <p className="text-sm text-warm-gray mb-4">
          Jurni uses AI to read your conversations. Your data stays on your machine —
          only message text is sent out for processing.{' '}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noopener"
            className="text-terracotta underline">Get a key</a>
        </p>
        <div className="flex gap-2">
          <input type="password" value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-or-v1-..."
            className="flex-1 px-3 py-2 bg-white/60 border border-cream-dark rounded-lg text-sm
              focus:outline-none focus:ring-2 focus:ring-terracotta/30" />
          <button onClick={handleSaveKey}
            className="px-4 py-2 bg-terracotta text-white rounded-lg text-sm font-medium
              hover:bg-terracotta-dark transition-colors flex items-center gap-2">
            {saved ? <><Check size={14} /> Saved</> : 'Save'}
          </button>
        </div>
      </section>

      {/* AI Models */}
      <section className="glass-card p-6">
        <div className="flex items-center gap-2 mb-3">
          <Brain size={18} className="text-terracotta" />
          <h3 className="font-display text-lg">AI Models</h3>
        </div>
        <p className="text-sm text-warm-gray mb-5">
          Jurni uses two models: one for shaping the Landscape (topics and groupings), and one
          for reading each message. Quality here is the core of the product.
        </p>

        <ModelPicker
          kind="landscape"
          icon={<Sparkles size={14} />}
          title="Landscape model"
          description="Reads each conversation and names its topic + domain. Quality matters most here."
          options={availableModels.landscape}
          current={config.landscape_model}
          defaultLabel="Gemini 2.5 Flash"
          saved={modelSaved === 'landscape'}
          onChange={(id) => handleModelChange('landscape', id)}
        />

        <div className="h-4" />

        <ModelPicker
          kind="analysis"
          icon={<Brain size={14} />}
          title="Message-reading model"
          description="Reads emotions, threads, and decisions from each message. A cheap model is fine."
          options={availableModels.analysis}
          current={config.analysis_model}
          defaultLabel="Mistral Small"
          saved={modelSaved === 'analysis'}
          onChange={(id) => handleModelChange('analysis', id)}
        />

        <div className="h-5" />
        <div className="border-t border-cream-dark pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-charcoal flex items-center gap-2">
                <RotateCcw size={13} /> Re-read everything
              </div>
              <p className="text-xs text-warm-gray mt-0.5">
                Wipe existing topics and re-generate with the current model + prompt.
                Use this after changing the landscape model or when the interpretation feels off.
              </p>
            </div>
            <button
              onClick={handleReread}
              disabled={rereadRunning}
              className="text-xs px-3 py-2 rounded-lg bg-terracotta/10 border border-terracotta/30
                text-terracotta hover:bg-terracotta/20 transition-colors disabled:opacity-60
                flex-shrink-0 flex items-center gap-1.5 font-medium"
            >
              {rereadRunning
                ? <><Loader2 size={12} className="animate-spin" /> Starting…</>
                : rereadDone !== null
                ? <><Check size={12} /> Wiped {rereadDone}</>
                : 'Re-read all'}
            </button>
          </div>
        </div>
      </section>

      {/* Sync Conversations */}
      <section className="glass-card p-6">
        <div className="flex items-center gap-2 mb-1">
          <RefreshCw size={18} className="text-terracotta" />
          <h3 className="font-display text-lg">Sync Conversations</h3>
        </div>
        <p className="text-sm text-warm-gray mb-4">
          Pull the latest threads from connected sources. Already-captured
          messages are skipped automatically — safe to click any time.
        </p>
        <div className="space-y-3">
          {['claude', 'chatgpt'].map(provider => {
            const enabled = config[`connector_${provider}`] === 'enabled';
            const state = syncState[provider] || {};
            const label = provider === 'claude' ? 'Claude' : 'ChatGPT';
            const pct = state.total > 0 ? Math.min(100, Math.round((state.processed / state.total) * 100)) : 0;
            return (
              <div key={provider} className="p-3 bg-white/40 rounded-lg">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-charcoal">{label}</span>
                      {enabled ? (
                        <span className="text-[10px] uppercase tracking-wider text-score-green bg-score-green/10 px-2 py-0.5 rounded-full">Connected</span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wider text-warm-gray bg-warm-gray/10 px-2 py-0.5 rounded-full">Not connected</span>
                      )}
                      {state.running && state.total > 0 && (
                        <span className="text-[10px] font-mono text-warm-gray">
                          {state.processed}/{state.total} · {pct}%
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-warm-gray mt-1 truncate">
                      {state.running && state.stage === 'starting' && 'Starting — opening browser…'}
                      {state.running && state.stage === 'connecting' && (state.message || 'Waiting for login…')}
                      {state.running && state.stage === 'crawling' && (
                        state.total > 0
                          ? `Fetched ${state.fetched} · skipped ${state.threadsSkipped} up-to-date · +${state.added} new messages`
                          : (state.message || `Syncing — +${state.added} new, ${state.skipped} already had`)
                      )}
                      {state.running && state.stage === 'capturing' && `Syncing — +${state.added} new, ${state.skipped} already had`}
                      {!state.running && state.stage === 'complete' && (
                        state.added === 0
                          ? `Up to date — nothing new${state.threadsSkipped > 0 ? ` (${state.threadsSkipped} threads already current)` : ''}`
                          : `Synced +${state.added} new message${state.added === 1 ? '' : 's'}${state.threadsSkipped > 0 ? ` · ${state.threadsSkipped} threads skipped` : ''}`
                      )}
                      {!state.running && state.stage === 'error' && (
                        <span className="text-score-red">{state.error || 'Sync failed'}</span>
                      )}
                      {!state.stage && (enabled ? 'Ready to sync' : 'Connect first from onboarding')}
                    </p>
                  </div>
                  <button
                    onClick={() => handleSyncProvider(provider)}
                    disabled={!enabled || state.running}
                    className="px-4 py-2 bg-terracotta/10 border border-terracotta/30 rounded-lg
                      text-sm font-medium text-terracotta hover:bg-terracotta/20
                      transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                      flex items-center gap-2 shrink-0">
                    {state.running
                      ? <><Loader2 size={14} className="animate-spin" /> Syncing</>
                      : <><RefreshCw size={14} /> Sync now</>}
                  </button>
                </div>
                {state.running && state.total > 0 && (
                  <div className="mt-2 bg-cream-dark rounded-full h-1.5 overflow-hidden">
                    <motion.div
                      className="h-full bg-terracotta rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Import Conversations */}
      <section className="glass-card p-6">
        <div className="flex items-center gap-2 mb-3">
          <FileJson size={18} className="text-terracotta" />
          <h3 className="font-display text-lg">Import Conversations</h3>
        </div>
        <p className="text-sm text-warm-gray mb-4">
          Upload a Claude or ChatGPT JSON export file.
        </p>
        <button onClick={handleImport}
          disabled={importing || !config.openrouter_api_key}
          className="w-full px-4 py-3 bg-terracotta/10 border-2 border-dashed border-terracotta/30
            rounded-xl text-sm font-medium text-terracotta hover:bg-terracotta/20
            transition-colors disabled:opacity-50 disabled:cursor-not-allowed
            flex items-center justify-center gap-2">
          {importing
            ? <><Loader2 size={16} className="animate-spin" /> Processing...</>
            : <><Upload size={16} /> Select JSON File</>}
        </button>
        {!config.openrouter_api_key && (
          <p className="text-xs text-score-red mt-2 flex items-center gap-1">
            <AlertCircle size={12} /> Set your API key first
          </p>
        )}
        {importProgress && importing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 p-3 bg-white/40 rounded-lg">
            <p className="text-sm text-charcoal">{importProgress.message}</p>
            {importProgress.total > 0 && (
              <div className="mt-2 bg-cream-dark rounded-full h-2 overflow-hidden">
                <div className="h-full bg-terracotta rounded-full transition-all duration-300"
                  style={{ width: `${(importProgress.processed / importProgress.total) * 100}%` }} />
              </div>
            )}
          </motion.div>
        )}
        {importResult && (
          <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
            className={`mt-4 p-3 rounded-lg text-sm ${
              importResult.success ? 'bg-score-green/10 text-score-green' : 'bg-score-red/10 text-score-red'}`}>
            {importResult.success
              ? importResult.message || `Successfully imported ${importResult.momentsCount} moments!`
              : `Error: ${importResult.error}`}
          </motion.div>
        )}
      </section>

      {/* Data Management */}
      <section className="glass-card p-6">
        <h3 className="font-display text-lg mb-4">Data Management</h3>
        <div className="space-y-3">
          <button onClick={handleExport}
            className="w-full flex items-center gap-3 px-4 py-3 bg-white/40 rounded-lg
              text-sm text-charcoal-light hover:bg-white/60 transition-colors">
            <Download size={16} /> Export all data as JSON
          </button>
          <button onClick={handleDeleteData}
            className="w-full flex items-center gap-3 px-4 py-3 bg-score-red/5 rounded-lg
              text-sm text-score-red hover:bg-score-red/10 transition-colors">
            <Trash2 size={16} /> Delete all processed data
          </button>
        </div>
      </section>

      {/* Full Reset */}
      <section className="glass-card p-6 border border-score-red/20">
        <h3 className="font-display text-lg mb-2 text-score-red">Full Reset</h3>
        <p className="text-sm text-warm-gray mb-4">
          Wipe everything — data, connectors, API key — and go back to the welcome screen.
          Like a fresh install.
        </p>
        <button onClick={handleReset}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-score-red/10
            rounded-lg text-sm font-medium text-score-red hover:bg-score-red/20 transition-colors">
          <RotateCcw size={16} /> Reset Jurni
        </button>
      </section>

      {/* Live Logs */}
      <section className="glass-card p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Terminal size={18} className="text-terracotta" />
            <h3 className="font-display text-lg">Crawler Logs</h3>
          </div>
          <button onClick={() => setShowLogs(v => !v)}
            className="text-xs px-3 py-1 rounded bg-terracotta/10 text-terracotta hover:bg-terracotta/20 transition-colors">
            {showLogs ? 'Hide' : 'Show'}
          </button>
        </div>
        <p className="text-sm text-warm-gray mb-3">
          Real-time log of what the crawler is doing. Share this when reporting issues.
        </p>
        {logPath && (
          <p className="text-xs text-warm-gray/60 mb-2 font-mono">
            Log file: {logPath}
          </p>
        )}
        {showLogs && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
            <div className="flex gap-2 mb-2">
              <button onClick={handleCopyLogs}
                className="text-xs px-3 py-1 rounded bg-white/50 hover:bg-white/70 transition-colors flex items-center gap-1">
                <Copy size={12} /> {copied ? 'Copied!' : 'Copy all'}
              </button>
              <button onClick={() => { api.getLogs().then(text => setLogLines(text.split('\n').filter(Boolean))); }}
                className="text-xs px-3 py-1 rounded bg-white/50 hover:bg-white/70 transition-colors">
                Refresh
              </button>
            </div>
            <div className="bg-charcoal text-green-400 font-mono text-[11px] leading-relaxed
              rounded-lg p-3 max-h-80 overflow-y-auto scroll-smooth">
              {logLines.length === 0 ? (
                <span className="text-warm-gray">No log entries yet. Open a connector to see activity.</span>
              ) : (
                logLines.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all hover:bg-white/5">
                    {line}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </motion.div>
        )}
      </section>

      {/* Privacy Note */}
      <section className="text-xs text-warm-gray/60 leading-relaxed">
        <p>
          Jurni runs entirely on your device. Your conversations, photos, calendar data,
          and all analysis results are stored locally in ~/.jurni/ and never uploaded to any server.
          The only external calls are to your chosen AI model provider (via OpenRouter) for analysis.
          You can delete all data at any time by removing the ~/.jurni/ folder.
        </p>
      </section>
      </div>
    </div>
  );
}

function ModelPicker({ kind, icon, title, description, options, current, defaultLabel, saved, onChange }) {
  const hasOptions = options && options.length > 0;
  const selected = current || (hasOptions ? options[0].id : '');

  return (
    <div>
      <div className="flex items-center gap-2 mb-1 text-charcoal">
        {icon}
        <span className="text-sm font-medium">{title}</span>
        {saved && (
          <motion.span
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-xs text-score-green flex items-center gap-1 ml-1"
          >
            <Check size={11} /> Saved
          </motion.span>
        )}
      </div>
      <p className="text-xs text-warm-gray mb-3 ml-6">{description}</p>
      <div className="ml-6 space-y-1.5">
        {hasOptions ? options.map(opt => {
          const active = selected === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => onChange(opt.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                active
                  ? 'bg-terracotta/10 border-terracotta/40'
                  : 'bg-white/40 border-transparent hover:bg-white/60 hover:border-cream-dark'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${active ? 'text-terracotta' : 'text-charcoal'}`}>
                    {opt.label}
                  </div>
                  <div className="text-xs text-warm-gray mt-0.5">{opt.note}</div>
                </div>
                {active && <Check size={14} className="text-terracotta flex-shrink-0" />}
              </div>
            </button>
          );
        }) : (
          <div className="text-xs text-warm-gray italic">
            Using default: {defaultLabel}
          </div>
        )}
      </div>
    </div>
  );
}
