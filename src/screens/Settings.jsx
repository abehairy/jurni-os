import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Key, Upload, Trash2, Download, FileJson, Check, AlertCircle, Loader2, RotateCcw, Terminal, Copy, FolderOpen } from 'lucide-react';

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
    if (!confirm('Delete all analyzed data? Your connectors and API key will stay. This cannot be undone.')) return;
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
    <div className="max-w-xl mx-auto py-6 space-y-8">
      <h2 className="font-display text-2xl">Settings</h2>

      {/* API Key */}
      <section className="glass-card p-6">
        <div className="flex items-center gap-2 mb-3">
          <Key size={18} className="text-terracotta" />
          <h3 className="font-display text-lg">OpenRouter API Key</h3>
        </div>
        <p className="text-sm text-warm-gray mb-4">
          Jurni uses AI to analyze your conversations. Your data stays on your machine —
          only message text is sent for analysis.{' '}
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
            <Trash2 size={16} /> Delete all analyzed data
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
  );
}
