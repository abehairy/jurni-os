const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('./database');
const { processConversationImport } = require('../channels/conversation');
const {
  processBatch,
  categorizeThread,
  generateBriefing,
  chatWithTile,
  validateOpenRouterKey,
  DEFAULT_ANALYSIS_MODEL,
  DEFAULT_LANDSCAPE_MODEL,
} = require('../processing/processor');
const { computeScores } = require('../scoring/engine');
const { getBrowserConnector } = require('./connectors/registry');
const { getKindProfile } = require('../processing/kinds');
const { initAutoUpdater } = require('./updater');

// Pretend to be a real Chrome build. Some sites (X, LinkedIn, Instagram,
// Facebook) return a blank page to anything whose UA contains "Electron".
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const JURNI_DIR = path.join(require('os').homedir(), '.jurni');
const LOG_PATH = path.join(JURNI_DIR, 'crawler.log');
const isDev = !app.isPackaged;

/**
 * Models exposed in the Settings picker. Costs are rough estimates per
 * thread categorization (prompt ~2k tokens, response ~300 tokens).
 *
 * Adding a new model? Just append here — the Settings UI reads this list.
 */
const AVAILABLE_MODELS = {
  landscape: [
    { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: 'Fast + accurate · ~$0.0003/thread · DEFAULT' },
    { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', note: 'Best quality · ~$0.003/thread' },
    { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', note: 'Strong quality · ~$0.003/thread' },
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', note: 'Fast + cheap · ~$0.0002/thread' },
    { id: 'openai/gpt-4o', label: 'GPT-4o', note: 'Very strong · ~$0.005/thread' },
    { id: 'mistralai/mistral-small-2603', label: 'Mistral Small', note: 'Cheapest · accuracy varies' },
  ],
  analysis: [
    { id: 'mistralai/mistral-small-2603', label: 'Mistral Small', note: 'Cheap · emotions/patterns · DEFAULT' },
    { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: 'Better signals · ~10x cost' },
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', note: 'Fast + accurate' },
  ],
};

let mainWindow = null;
let tray = null;
let db = null;
let logStream = null;

// Browser connector windows (Claude, ChatGPT)
const connectorWindows = {};
const connectorCounts = { claude: 0, chatgpt: 0 };

function ensureJurniDir() {
  if (!fs.existsSync(JURNI_DIR)) fs.mkdirSync(JURNI_DIR, { recursive: true });
  const cacheDir = path.join(JURNI_DIR, 'cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
}

function initLogger() {
  // Truncate on each app start so the log stays small
  fs.writeFileSync(LOG_PATH, `--- Jurni log started ${new Date().toISOString()} ---\n`);
  logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
}

function log(source, message, data) {
  const ts = new Date().toISOString().split('T')[1].split('.')[0];
  const line = `[${ts}] [${source}] ${message}${data ? ' | ' + JSON.stringify(data) : ''}`;
  console.log(line);
  if (logStream) logStream.write(line + '\n');
  sendToMain('log-entry', { ts, source, message, data });
}

function createWindow() {
  // Window icon. Used for the dock/taskbar in dev (in production, macOS reads
  // the icon from the .app bundle's Info.plist via electron-builder).
  const iconPath = path.join(__dirname, 'assets', process.platform === 'darwin' ? 'icon.icns' : 'icon-1024.png');
  const windowIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#FAF7F2',
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const distIndex = path.join(__dirname, '..', 'dist', 'index.html');
  if (isDev && fs.existsSync(distIndex)) {
    // Try Vite dev server first, fall back to built dist
    const http = require('http');
    const req = http.get('http://localhost:5173', () => {
      mainWindow.loadURL('http://localhost:5173');
      req.destroy();
    });
    req.on('error', () => {
      mainWindow.loadFile(distIndex);
    });
    req.setTimeout(1000, () => { req.destroy(); mainWindow.loadFile(distIndex); });
  } else if (fs.existsSync(distIndex)) {
    mainWindow.loadFile(distIndex);
  } else if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  // Template image: black-on-transparent so macOS tints it correctly for
  // light/dark menu bars. The @2x variant is auto-picked on retina.
  const trayIconPath = path.join(__dirname, 'assets', 'trayTemplate.png');
  const icon = nativeImage.createFromPath(trayIconPath);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Jurni');
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Jurni', click: () => { if (mainWindow) mainWindow.show(); else createWindow(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
}

// ---- Browser Connector Window ----

function openConnectorBrowser(provider) {
  const connector = getBrowserConnector(provider);
  if (!connector) {
    log('connector', `Unknown connector provider: ${provider}`);
    return;
  }

  log('connector', `Opening ${provider} browser window`);

  if (connectorWindows[provider] && !connectorWindows[provider].isDestroyed()) {
    connectorWindows[provider].focus();
    log('connector', `${provider} window already open, focusing`);
    return;
  }

  // Persistent session partition so the user stays logged in across restarts
  const partition = `persist:${provider}`;

  const win = new BrowserWindow({
    width: 1000,
    height: 750,
    title: `Jurni — Sign in to ${connector.title}`,
    webPreferences: {
      preload: path.join(__dirname, '..', 'channels', 'browser-preload.js'),
      contextIsolation: false,
      partition,
    },
  });

  // Real Chrome user agent. Social sites (X, LinkedIn, Instagram, Facebook)
  // serve a blank page to anything that identifies as "Electron".
  win.webContents.setUserAgent(CHROME_USER_AGENT);

  log('connector', `Loading URL: ${connector.url} (partition: ${partition})`);
  win.loadURL(connector.url);
  connectorWindows[provider] = win;

  win.on('closed', () => {
    log('connector', `${provider} browser window closed`);
    delete connectorWindows[provider];
    sendToMain('connector-status', { provider, status: 'disconnected' });
  });

  win.webContents.on('did-navigate', (e, url) => {
    log('connector', `${provider} navigated to: ${url}`);
    sendToMain('connector-status', { provider, status: 'navigating', url });
  });

  win.webContents.on('did-finish-load', () => {
    log('connector', `${provider} page loaded: ${win.webContents.getURL()}`);
    sendToMain('connector-status', { provider, status: 'loaded', url: win.webContents.getURL() });
  });

  win.webContents.on('did-fail-load', (e, errorCode, errorDescription, url) => {
    log('connector', `${provider} FAILED to load: ${url}`, { errorCode, errorDescription });
  });

  win.webContents.on('console-message', (e, level, message) => {
    if (message.startsWith('[Jurni]') || level >= 2) {
      log('browser-console', `${provider}: ${message}`);
    }
  });
}

function sendToMain(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function handleCapturedMessage(event, message) {
  if (!db) { log('main', 'handleCapturedMessage: db not ready'); return; }

  // Kind routes processing (see processing/kinds.js). Registry is the
  // single source of truth: no if/else here, just a lookup.
  const connector = message.provider ? getBrowserConnector(message.provider) : null;
  const kind = connector?.kind || 'dialogue';

  const moment = {
    timestamp: message.timestamp,
    source: 'conversation',
    kind,
    // 'self' (claude/chatgpt user turns, the user's own posts) vs 'other'
    // (feed posts by strangers). Defaulted at DB layer; set here when known.
    author: message.author === 'other' ? 'other' : 'self',
    raw_content: message.text,
    metadata: {
      provider: message.provider,
      conversation_name: message.conversationTitle || 'Untitled',
      url: message.url,
      capture_mode: message.source || 'live',
      role: message.role || 'user',
      // When the post is authored by someone else (feed scrape), keep who
      // wrote it so entity enrichment can pick it up later.
      author_handle: message.authorHandle || null,
      author_name: message.authorName || null,
    },
  };

  const { id, inserted } = db.insertMoment(moment);

  // Only count truly-new messages. Duplicates still flow through here on
  // re-crawls but must not inflate the connector counter or trigger downstream
  // processing (processor is idempotent on raw_content, but skipping spares cost).
  if (message.provider) {
    if (inserted) {
      connectorCounts[message.provider] = (connectorCounts[message.provider] || 0) + 1;
    }
    // Track sync session deltas for the manual "Sync now" button.
    const s = syncSessions.get(message.provider);
    if (s) {
      if (inserted) s.added += 1; else s.skipped += 1;
      sendToMain('sync-progress', {
        provider: message.provider,
        stage: 'capturing',
        added: s.added,
        skipped: s.skipped,
      });
    }
  }

  if (!inserted) return;

  sendToMain('new-moment', { id, ...moment });
  sendToMain('connector-status', {
    provider: message.provider,
    status: 'capturing',
    lastMessage: message.text.substring(0, 80),
    capturedCount: connectorCounts[message.provider] || 0,
  });

  scheduleAutoProcess();
}

let autoProcessTimer = null;
let autoProcessRunning = false;

/**
 * In-memory cache for per-tile briefings. Evaporates on app restart
 * (acceptable — regeneration is ~2s per tile). Cleared whenever the
 * landscape data changes so we never serve a stale briefing.
 */
const briefingCache = new Map();
const BRIEFING_TTL_MS = 60 * 60 * 1000; // 1 hour
function clearBriefingCache() { briefingCache.clear(); }

/**
 * Active sync sessions keyed by provider. A session exists for the duration
 * of a manual "Sync now" click and tracks how many truly new messages we
 * inserted vs. how many duplicates we skipped. This is what powers the toast
 * shown to the user when sync finishes.
 */
const syncSessions = new Map();
const SYNC_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes hard ceiling

function finishSync(provider, outcome) {
  const s = syncSessions.get(provider);
  if (!s) return;
  syncSessions.delete(provider);

  if (s.timeout) clearTimeout(s.timeout);
  if (s.revealTimer) clearTimeout(s.revealTimer);
  if (s.hiddenWin && !s.hiddenWin.isDestroyed()) {
    try { s.hiddenWin.close(); } catch {}
  }

  const result = {
    provider,
    ok: outcome.ok,
    added: s.added,
    skipped: s.skipped,
    error: outcome.error || null,
    durationMs: Date.now() - s.startedAt,
  };
  log('sync', `finished ${provider}`, result);
  sendToMain('sync-progress', { ...result, stage: outcome.ok ? 'complete' : 'error' });
  s.resolve(result);
}

function scheduleAutoProcess() {
  if (autoProcessTimer) return;
  autoProcessTimer = setTimeout(() => {
    autoProcessTimer = null;
    autoProcessBatch();
  }, 10000); // Wait 10s between batch attempts to avoid spam
}

/**
 * Split a batch of moments by (kind, author). Each sub-batch is homogeneous
 * so we can route it through processBatch with a single entity-mention weight
 * derived from KIND_PROFILES (see processing/kinds.js).
 */
function groupMomentsByProfile(moments) {
  const groups = new Map();
  for (const m of moments) {
    const kind = m.kind || 'dialogue';
    const author = m.author === 'other' ? 'other' : 'self';
    const key = `${kind}:${author}`;
    if (!groups.has(key)) groups.set(key, { kind, author, moments: [] });
    groups.get(key).moments.push(m);
  }
  return Array.from(groups.values());
}

async function autoProcessBatch() {
  if (autoProcessRunning) return;
  const apiKey = db.getConfigValue('openrouter_api_key');
  if (!apiKey) { log('main', 'autoProcess: no API key set, skipping'); return; }

  autoProcessRunning = true;
  const unprocessed = db.getUnprocessedMoments();
  if (unprocessed.length === 0) { autoProcessRunning = false; return; }

  const batch = unprocessed.slice(0, 20);
  log('main', `Processing batch of ${batch.length} moments (${unprocessed.length} total unprocessed)`);

  const existingEntities = db.getEntities();
  const recentPatterns = db.getPatterns();
  const analysisModel = db.getConfigValue('analysis_model') || DEFAULT_ANALYSIS_MODEL;
  const identity = db.getUserIdentity();

  // Route each (kind, author) sub-batch through processBatch independently.
  // Entity mention_counts from self-authored sub-batches get multiplied by
  // the kind's selfMentionWeight — this is how "people you talk about" rank
  // above "people who appear in your feed". No if/else on provider anywhere.
  const groups = groupMomentsByProfile(batch);

  try {
    for (const group of groups) {
      const profile = getKindProfile(group.kind);
      const weight = group.author === 'self' ? profile.selfMentionWeight : 1;

      const analysis = await processBatch(
        group.moments, existingEntities, recentPatterns, apiKey, analysisModel, identity
      );
      log('main', 'LLM analysis complete', {
        kind: group.kind,
        author: group.author,
        weight,
        count: group.moments.length,
        entities: analysis.entities?.length || 0,
        patterns: analysis.patterns?.length || 0,
        emotions: analysis.emotions?.length || 0,
        decisions: analysis.decisions?.length || 0,
      });

      if (analysis.entities) analysis.entities.forEach(e => {
        try {
          db.upsertEntity({ ...e, mention_count: (e.mention_count || 1) * weight });
        } catch (err) {
          log('main', 'upsertEntity skipped', { name: e.name, type: e.type, err: err.message });
        }
      });
      if (analysis.patterns) analysis.patterns.forEach(p => db.insertPattern(p));
      if (analysis.emotions) analysis.emotions.forEach(e => db.insertEmotion(e));
      if (analysis.decisions) analysis.decisions.forEach(d => db.insertDecision(d));
    }

    // Mark all moments in the batch as processed. Thread categorization runs
    // separately and only touches kind='dialogue' moments.
    for (const m of batch) db.markMomentProcessed(m.id);

    const scores = computeScores(db);
    db.saveScores(scores);
    log('main', 'Scores updated', { overall: scores.overall });
    sendToMain('scores-updated', scores);
  } catch (err) {
    log('main', 'Auto-process ERROR', { error: err.message, stack: err.stack?.split('\n').slice(0, 3) });
  }
  autoProcessRunning = false;

  // Kick off thread categorization for any newly-touched threads.
  // Runs independently of the per-message pass so failures don't block scoring.
  scheduleThreadCategorization();

  // If more unprocessed moments remain, schedule another batch
  const remaining = db.getUnprocessedMoments();
  if (remaining.length >= 5) {
    log('main', `${remaining.length} moments still unprocessed, scheduling next batch`);
    scheduleAutoProcess();
  }
}

// ---- Landscape helpers ----

/**
 * Resolve a range string + weekOffset into a concrete [start, end) window.
 * range: '1w' | '4w' | '12w' | '1y'  (weekOffset scrubs backwards in weeks)
 */
function resolveRange(range, weekOffset = 0) {
  const end = new Date();
  // Move "now" back by weekOffset weeks when scrubbing
  end.setDate(end.getDate() - (weekOffset * 7));
  const start = new Date(end);
  const map = { '1w': 7, '4w': 28, '12w': 84, '1y': 365 };
  const days = map[range] || 28;
  start.setDate(start.getDate() - days);
  return { start: start.toISOString(), end: end.toISOString() };
}

let categorizing = false;
let threadCategorizationTimer = null;

/**
 * Schedule a thread-categorization pass. Debounced so that a burst of
 * processed batches doesn't trigger multiple concurrent runs.
 */
function scheduleThreadCategorization() {
  if (categorizing || threadCategorizationTimer) return;
  threadCategorizationTimer = setTimeout(() => {
    threadCategorizationTimer = null;
    runThreadCategorization().catch(err => {
      log('categorize', `Thread categorization error: ${err.message}`);
    });
  }, 3000);
}

/**
 * Categorize conversation threads that have at least one uncategorized
 * moment. ONE LLM call per thread. Writes the result to every moment in
 * the thread.
 *
 * This is the function that makes the Life Landscape accurate.
 */
async function runThreadCategorization() {
  if (categorizing) return { ok: false, error: 'Already running' };
  const apiKey = db.getConfigValue('openrouter_api_key');
  if (!apiKey) return { ok: false, error: 'No API key' };

  categorizing = true;
  const landscapeModel = db.getConfigValue('landscape_model') || DEFAULT_LANDSCAPE_MODEL;
  let processedThreads = 0;

  const stats = db.getUncategorizedThreadStats();
  const totalThreads = stats.pending;
  log('categorize', `Starting thread categorization`, {
    model: landscapeModel,
    pending: totalThreads,
    total: stats.total,
  });
  sendToMain('recat-progress', { processed: 0, total: totalThreads, stage: 'start', unit: 'threads' });

  // In-memory fail tracking so a malformed thread doesn't loop forever
  // across a single run, without permanently marking it as categorized.
  const failedThisRun = new Map();
  const MAX_FAIL_PER_RUN = 2;

  try {
    while (true) {
      const threads = db.getUncategorizedThreads(10);
      // Skip threads we've already failed on twice in this run
      const todo = threads.filter(t => (failedThisRun.get(t.title) || 0) < MAX_FAIL_PER_RUN);
      if (todo.length === 0) break;

      const identity = db.getUserIdentity();
      for (const thread of todo) {
        try {
          const knownTopics = db.getKnownTopics();
          const result = await categorizeThread(thread, knownTopics, apiKey, landscapeModel, identity);

          db.applyThreadCategorization(thread.title, {
            topic: result.topic,
            category: result.category || 'other',
            tone: result.tone,
            summary: result.summary,
          });

          log('categorize', `✓ "${thread.title}" → ${result.topic || '(no topic)'} [${result.category}]`, {
            messages: thread.messageCount,
            tone: result.tone,
          });

          processedThreads++;
          sendToMain('recat-progress', {
            processed: processedThreads,
            total: totalThreads,
            stage: 'working',
            unit: 'threads',
          });
        } catch (err) {
          const msg = err.message || String(err);
          // Fatal: no credits. Stop the whole run. Don't touch DB state so
          // everything retries cleanly once the user adds credits.
          if (msg.includes('402') || msg.toLowerCase().includes('credits')) {
            log('categorize', `STOPPED: out of OpenRouter credits. Add credits and hit "Read threads" again.`);
            sendToMain('recat-progress', {
              processed: processedThreads,
              total: totalThreads,
              stage: 'error',
              unit: 'threads',
              error: 'Out of OpenRouter credits. Add credits at openrouter.ai/settings/credits then retry.',
            });
            return { ok: false, processed: processedThreads, error: 'out_of_credits' };
          }
          // Transient: bump the fail counter but DO NOT mark the thread.
          // It'll retry on the next scheduled run.
          const prev = failedThisRun.get(thread.title) || 0;
          failedThisRun.set(thread.title, prev + 1);
          log('categorize', `Skipped "${thread.title}" (attempt ${prev + 1}): ${msg.slice(0, 120)}`);
        }

        await new Promise(r => setTimeout(r, 250));
      }

      clearBriefingCache();
      sendToMain('landscape-updated');
    }

    sendToMain('recat-progress', { processed: processedThreads, total: totalThreads, stage: 'complete', unit: 'threads' });
    clearBriefingCache();
    sendToMain('landscape-updated');
    log('categorize', `Thread categorization complete`, { threads: processedThreads });
    return { ok: true, processed: processedThreads };
  } finally {
    categorizing = false;
  }
}

// ---- App Lifecycle ----

app.whenReady().then(() => {
  ensureJurniDir();
  initLogger();
  log('main', 'Jurni starting up');

  // Set the dock icon for macOS dev runs (in production the .app bundle
  // already carries the icon via electron-builder). Use PNG — .icns isn't
  // reliably loadable through nativeImage at runtime.
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = path.join(__dirname, 'assets', 'icon-1024.png');
    if (fs.existsSync(dockIconPath)) {
      try {
        const dockImg = nativeImage.createFromPath(dockIconPath);
        if (!dockImg.isEmpty()) app.dock.setIcon(dockImg);
      } catch (e) {
        log('main', 'dock icon failed', { err: String(e) });
      }
    }
  }

  db = new Database(JURNI_DIR);
  db.initialize();
  log('main', 'Database initialized');

  createWindow();
  createTray();

  // Auto-update (production only — skipped in dev).
  initAutoUpdater({ log, sendToMain });

  // Kick-start processing if there are unprocessed moments from a previous session
  const unprocessed = db.getUnprocessedMoments();
  if (unprocessed.length > 0) {
    log('main', `Found ${unprocessed.length} unprocessed moments from previous session, starting processing`);
    scheduleAutoProcess();
  }

  // Resurrect any threads that a previous session marked as 'other' on
  // error (API failure, credit exhaustion, parse error) so they get
  // re-read with a fresh attempt.
  const resurrected = db.resetLikelyFailedCategorizations();
  if (resurrected > 0) {
    log('main', `Recovered ${resurrected} moments from previous failed runs`);
  }

  // Clean up any historical rows where an email/handle was mistakenly stored
  // as a person entity. Upsert now blocks new ones from being inserted.
  const purgedEmails = db.purgeEmailPersonEntities();
  if (purgedEmails > 0) {
    log('main', `Removed ${purgedEmails} email-shaped person entities`);
  }

  // Kick-start thread categorization if there's a backlog
  const threadStats = db.getUncategorizedThreadStats();
  if (threadStats.pending > 0) {
    log('main', `Found ${threadStats.pending} uncategorized threads, scheduling categorization`);
    scheduleThreadCategorization();
  }

  // Listen for messages from browser preload scripts
  ipcMain.on('conversation-message', (event, msg) => {
    log('capture', `Message from ${msg.provider} (${msg.source})`, { len: msg.text?.length, title: msg.conversationTitle });
    handleCapturedMessage(event, msg);
  });
  ipcMain.on('browser-status', (event, status) => {
    log('browser', `${status.provider}: ${status.status}`, { message: status.message, count: status.capturedCount });
    sendToMain('connector-status', status);

    // Bridge crawler lifecycle into any active manual-sync session so the
    // renderer sees real progress instead of a silent "Syncing" spinner.
    const s = syncSessions.get(status.provider);
    if (!s) return;

    if (status.status === 'crawl_complete') {
      finishSync(status.provider, { ok: true });
    } else if (status.status === 'crawl_error') {
      finishSync(status.provider, { ok: false, error: status.message || 'Crawl failed' });
    } else if (status.status === 'crawling') {
      // Crawler is doing real work — we don't need to reveal the window.
      if (s.revealTimer) { clearTimeout(s.revealTimer); s.revealTimer = null; }
      sendToMain('sync-progress', {
        provider: status.provider,
        stage: 'crawling',
        message: status.message || null,
        processed: status.data?.processed ?? null,
        total: status.data?.total ?? null,
        fetched: status.data?.fetched ?? null,
        threadsSkipped: status.data?.threadsSkipped ?? null,
        added: s.added,
        skipped: s.skipped,
      });
    } else if (status.status === 'connecting') {
      sendToMain('sync-progress', {
        provider: status.provider,
        stage: 'connecting',
        message: status.message || 'Waiting for login…',
        added: s.added,
        skipped: s.skipped,
      });
    }
  });

  /**
   * IPC: Lets the browser preload fetch what we already have for a provider
   * so it can skip re-crawling conversations whose Claude-side updated_at
   * is older than our local max timestamp. Returns { [uuid]: { maxTs, count } }.
   */
  ipcMain.handle('get-conversation-sync-state', (_, provider) => {
    if (!db) return {};
    return db.getConversationSyncState(provider);
  });

  // --- Pins ------------------------------------------------------------
  ipcMain.handle('get-pins', () => {
    if (!db) return [];
    return db.getPins();
  });

  ipcMain.handle('add-pin', (_, payload) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    try {
      const result = db.addPin(payload);
      sendToMain('pins-changed');
      return { ok: true, ...result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('remove-pin', (_, payload) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    try {
      const result = db.removePin(payload);
      sendToMain('pins-changed');
      return { ok: true, ...result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.on('crawler-log', (event, entry) => {
    log('crawler', entry.message, entry.data);
  });

  // ---- IPC Handlers ----

  ipcMain.handle('get-config', () => db.getConfig());
  ipcMain.handle('set-config', (_, key, value) => { db.setConfig(key, value); return true; });

  // One-shot OpenRouter key check. Called from Onboarding so typos / revoked
  // keys surface before the user moves on and hits silent LLM failures.
  ipcMain.handle('validate-openrouter-key', async (_, apiKey) => {
    return await validateOpenRouterKey(apiKey);
  });

  ipcMain.handle('get-logs', () => {
    try { return fs.readFileSync(LOG_PATH, 'utf-8'); } catch { return ''; }
  });
  ipcMain.handle('get-log-path', () => LOG_PATH);
  ipcMain.handle('get-scores', () => db.getLatestScores());
  ipcMain.handle('get-moments', (_, filters) => db.getMoments(filters));
  ipcMain.handle('get-entities', (_, type) => db.getEntities(type));
  ipcMain.handle('get-patterns', () => db.getPatterns());
  ipcMain.handle('get-stats', () => db.getStats());
  ipcMain.handle('get-entity-detail', (_, entityId) => db.getEntityDetail(entityId));

  ipcMain.handle('get-dashboard-data', () => {
    return {
      scores: db.getLatestScores(),
      stats: db.getStats(),
      patterns: db.getPatterns(),
      topInsights: db.getTopInsights(),
    };
  });

  // ---- Landscape ----

  ipcMain.handle('get-landscape', (_, opts) => {
    const { range = '4w', group = 'topic', weekOffset = 0 } = opts || {};
    const { start, end } = resolveRange(range, weekOffset);
    const landscape = db.getLandscape({ start, end, group });
    return {
      ...landscape,
      range,
      weekOffset,
      threadStats: db.getUncategorizedThreadStats(),
      recatStats: db.getRecategorizationStats(),
    };
  });

  ipcMain.handle('get-tile-detail', (_, opts) => {
    const { key, group = 'topic', range = '4w', weekOffset = 0 } = opts || {};
    const { start, end } = resolveRange(range, weekOffset);
    return db.getTileDetail({ key, group, start, end });
  });

  // On-demand LLM-generated briefing for a drilled tile. Cached in-memory
  // so reopening a drawer is instant; cache is cleared when new data lands
  // (see clearBriefingCache() calls next to sendToMain('landscape-updated')).
  ipcMain.handle('get-tile-briefing', async (_, opts) => {
    const {
      key, group = 'topic', range = '4w', weekOffset = 0,
      category, tone, pctOfTotal, changePct, label,
    } = opts || {};
    if (!key) return null;
    const { start, end } = resolveRange(range, weekOffset);
    const cacheKey = `${group}::${key}::${start}::${end}`;
    const cached = briefingCache.get(cacheKey);
    if (cached && Date.now() - cached.at < BRIEFING_TTL_MS) return cached.data;

    const apiKey = db.getConfigValue('openrouter_api_key');
    if (!apiKey) { log('briefing', `no api key; skipping ${key}`); return null; }

    const detail = db.getTileDetail({ key, group, start, end });
    if (!detail?.stories || detail.stories.length === 0) {
      log('briefing', `no stories for ${key}; skipping`);
      return null;
    }

    const model = db.getConfigValue('landscape_model') || DEFAULT_LANDSCAPE_MODEL;
    const identity = db.getUserIdentity();

    log('briefing', `generating for "${key}" (${category}) · ${detail.stories.length} stories · model=${model}`);
    try {
      const briefing = await generateBriefing({
        tile: {
          label: label || key,
          category: category || 'other',
          tone, pctOfTotal, changePct,
        },
        stories: detail.stories,
        people: detail.people,
        apiKey,
        model,
        identity,
      });
      if (briefing) {
        briefingCache.set(cacheKey, { data: briefing, at: Date.now() });
        log('briefing', `✓ "${key}" done · ${briefing.briefing.length} chars · fields: ${Object.keys(briefing).join(', ')}`);
      } else {
        log('briefing', `✗ "${key}" returned null (LLM returned empty or too short)`);
      }
      return briefing;
    } catch (err) {
      log('briefing', `generate failed for ${key}`, { err: err.message });
      return null;
    }
  });

  // --- Tile chat -------------------------------------------------------
  // Conversational Q&A against a single tile's context. Reuses the briefing
  // cache to avoid regenerating the overview on every message — if a briefing
  // is cached for this tile, we include it as extra color.
  ipcMain.handle('chat-with-tile', async (_, opts) => {
    const {
      key, group = 'topic', range = '4w', weekOffset = 0,
      category, tone, pctOfTotal, changePct, label,
      messages = [],
    } = opts || {};
    if (!key) return { ok: false, error: 'Missing tile key' };
    if (!Array.isArray(messages) || messages.length === 0) {
      return { ok: false, error: 'No messages to send' };
    }

    const apiKey = db.getConfigValue('openrouter_api_key');
    if (!apiKey) return { ok: false, error: 'No OpenRouter API key set' };

    const { start, end } = resolveRange(range, weekOffset);
    const detail = db.getTileDetail({ key, group, start, end });
    if (!detail?.stories || detail.stories.length === 0) {
      return { ok: false, error: 'No stories in this tile to chat about yet' };
    }

    const cacheKey = `${group}::${key}::${start}::${end}`;
    const cached = briefingCache.get(cacheKey);
    const briefing = cached?.data || null;

    const model = db.getConfigValue('landscape_model') || DEFAULT_LANDSCAPE_MODEL;
    const identity = db.getUserIdentity();

    log('chat', `tile="${key}" · ${messages.length} turns · model=${model}`);
    try {
      const reply = await chatWithTile({
        tile: { label: label || key, category: category || 'other', tone, pctOfTotal, changePct },
        stories: detail.stories,
        people: detail.people,
        briefing,
        messages,
        apiKey,
        model,
        identity,
      });
      if (!reply) return { ok: false, error: 'Empty response from model' };
      log('chat', `✓ reply · ${reply.length} chars`);
      return { ok: true, reply };
    } catch (err) {
      log('chat', `failed for ${key}`, { err: err.message });
      return { ok: false, error: err.message };
    }
  });

  // Kick off thread-level categorization manually (used by the "Read threads" button)
  ipcMain.handle('recategorize-moments', async () => {
    runThreadCategorization().catch(err => log('categorize', `Error: ${err.message}`));
    return { ok: true, started: true };
  });

  // Wipe all topic/category/tone/summary and kick off a fresh thread pass.
  // Used after prompt changes to regenerate the landscape with the new voice.
  ipcMain.handle('reread-all-threads', async () => {
    const wiped = db.resetAllThreadCategorizations();
    log('categorize', `Reset ${wiped} moments — starting fresh thread pass`);
    runThreadCategorization().catch(err => log('categorize', `Error: ${err.message}`));
    return { ok: true, wiped };
  });

  // Expose available models for the Settings UI model picker
  ipcMain.handle('get-available-models', () => AVAILABLE_MODELS);

  // User identity — who's the narrator of these conversations
  ipcMain.handle('get-user-identity', () => db.getUserIdentity());

  // Best-effort OS-level "real name" lookup. Used to pre-fill the identity
  // step so the user doesn't have to retype what the OS already knows.
  // On macOS `id -F` returns the Full Name from DirectoryService. Anywhere
  // else (or if that fails) we fall back to the short username, capitalized.
  ipcMain.handle('get-system-user-name', () => {
    try {
      const os = require('os');
      const info = os.userInfo();
      const shortName = info.username || '';

      if (process.platform === 'darwin') {
        try {
          const { execSync } = require('child_process');
          const fullName = execSync('id -F', { timeout: 800 }).toString().trim();
          if (fullName && fullName !== shortName) {
            return { name: fullName, source: 'fullname' };
          }
        } catch (_) { /* fall through to username */ }
      }

      if (shortName) {
        const capitalized = shortName.charAt(0).toUpperCase() + shortName.slice(1);
        return { name: capitalized, source: 'username' };
      }
      return { name: '', source: null };
    } catch (e) {
      return { name: '', source: null };
    }
  });

  ipcMain.handle('set-user-identity', async (_, { name, aliases }) => {
    db.setConfig('user_name', (name || '').trim());
    db.setConfig('user_aliases', (aliases || '').trim());
    // Purge any existing pollution: entities matching the new identity,
    // threads where the user became the topic.
    const purged = db.purgeUserAsEntity();
    log('main', `Identity updated`, { name, ...purged });
    clearBriefingCache();
    sendToMain('landscape-updated');
    // Trigger re-categorization for the threads we just wiped
    if (purged.resetThreads > 0) {
      scheduleThreadCategorization();
    }
    return { ok: true, ...purged };
  });

  // ---- Connector Controls ----

  ipcMain.handle('open-connector', (_, provider) => {
    openConnectorBrowser(provider);
    db.setConfig(`connector_${provider}`, 'enabled');
    return true;
  });

  ipcMain.handle('close-connector', (_, provider) => {
    if (connectorWindows[provider] && !connectorWindows[provider].isDestroyed()) {
      connectorWindows[provider].close();
    }
    db.setConfig(`connector_${provider}`, 'disabled');
    return true;
  });

  ipcMain.handle('get-connector-status', (_, provider) => {
    const isOpen = connectorWindows[provider] && !connectorWindows[provider].isDestroyed();
    const enabled = db.getConfigValue(`connector_${provider}`);
    return { provider, isOpen, enabled: enabled === 'enabled' };
  });

  /**
   * Manual sync trigger. Opens a hidden connector window, lets the existing
   * crawler run in the persistent (already-logged-in) partition, and resolves
   * with how many messages were actually new vs. skipped as duplicates.
   *
   * Safe to call repeatedly — only one sync per provider runs at a time.
   * If a visible connector window is already open, we just tap into the
   * active session instead of spawning a second one.
   */
  ipcMain.handle('sync-provider', async (_, provider) => {
    const connector = getBrowserConnector(provider);
    if (!connector || !connector.supportsSync) {
      return { ok: false, error: 'Unknown provider' };
    }
    if (syncSessions.has(provider)) {
      log('sync', `${provider} sync already in progress — ignoring duplicate trigger`);
      return { ok: false, error: 'Sync already running' };
    }

    log('sync', `manual sync requested for ${provider}`);
    sendToMain('sync-progress', { provider, stage: 'starting', added: 0, skipped: 0 });

    return new Promise((resolve) => {
      const session = {
        provider,
        added: 0,
        skipped: 0,
        startedAt: Date.now(),
        resolve,
        hiddenWin: null,
        timeout: null,
      };
      session.timeout = setTimeout(() => {
        log('sync', `${provider} sync timed out after ${SYNC_TIMEOUT_MS}ms`);
        finishSync(provider, { ok: false, error: 'Sync timed out. Try opening the connector manually.' });
      }, SYNC_TIMEOUT_MS);
      syncSessions.set(provider, session);

      // If a visible connector window is already open, let it drive the sync —
      // we just piggyback on its message stream.
      if (connectorWindows[provider] && !connectorWindows[provider].isDestroyed()) {
        log('sync', `${provider} connector already open — attaching to live session`);
        return;
      }

      // Otherwise spawn a hidden window with the persistent login partition
      const win = new BrowserWindow({
        width: 1000,
        height: 750,
        show: false,
        title: `Jurni — Syncing ${connector.title}`,
        webPreferences: {
          preload: path.join(__dirname, '..', 'channels', 'browser-preload.js'),
          contextIsolation: false,
          partition: `persist:${provider}`,
        },
      });
      win.webContents.setUserAgent(CHROME_USER_AGENT);
      session.hiddenWin = win;
      connectorWindows[provider] = win;

      // If the crawler hasn't started actually crawling within 20s, the user
      // probably needs to log in. Reveal the window so they can — otherwise
      // we'd hang silently behind a black screen. Cleared as soon as a
      // `crawling` status arrives.
      session.revealTimer = setTimeout(() => {
        if (!syncSessions.has(provider)) return;
        if (win.isDestroyed() || win.isVisible()) return;
        log('sync', `${provider}: 20s idle, revealing window so user can sign in`);
        win.show();
        sendToMain('sync-progress', {
          provider, stage: 'connecting',
          message: 'Please sign in to the window that just opened.',
          added: session.added, skipped: session.skipped,
        });
      }, 20000);

      win.on('closed', () => {
        if (connectorWindows[provider] === win) delete connectorWindows[provider];
        // If the window dies before the crawler sends crawl_complete, we
        // treat that as an error so the Promise never hangs.
        if (syncSessions.has(provider)) {
          finishSync(provider, { ok: false, error: 'Sync window closed unexpectedly' });
        }
      });

      win.loadURL(connector.url);
    });
  });

  // ---- Import (secondary option for historical data) ----

  ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('import-conversations', async (event, filePath) => {
    try {
      const apiKey = db.getConfigValue('openrouter_api_key');
      if (!apiKey) {
        return { success: false, error: 'No API key configured.' };
      }

      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(fileContent);

      const sendProgress = (progress) => sendToMain('import-progress', progress);

      const moments = processConversationImport(data, sendProgress);
      sendProgress({ stage: 'saving', message: `Saving ${moments.length} moments...` });
      let importAdded = 0, importSkipped = 0;
      for (const moment of moments) {
        const res = db.insertMoment(moment);
        if (res.inserted) importAdded++; else importSkipped++;
      }
      log('main', `JSON import: +${importAdded} new, ${importSkipped} duplicates skipped`);

      sendProgress({ stage: 'analyzing', message: 'Running AI analysis...', total: moments.length });

      const unprocessedMoments = db.getUnprocessedMoments();
      const batchSize = 20;
      let processed = 0;

      const analysisModel = db.getConfigValue('analysis_model') || DEFAULT_ANALYSIS_MODEL;
      const identity = db.getUserIdentity();
      for (let i = 0; i < unprocessedMoments.length; i += batchSize) {
        const batch = unprocessedMoments.slice(i, i + batchSize);
        const existingEntities = db.getEntities();
        const recentPatterns = db.getPatterns();
        const groups = groupMomentsByProfile(batch);

        try {
          for (const group of groups) {
            const profile = getKindProfile(group.kind);
            const weight = group.author === 'self' ? profile.selfMentionWeight : 1;
            const analysis = await processBatch(
              group.moments, existingEntities, recentPatterns, apiKey, analysisModel, identity
            );
            if (analysis.entities) analysis.entities.forEach(e => {
              try {
                db.upsertEntity({ ...e, mention_count: (e.mention_count || 1) * weight });
              } catch {}
            });
            if (analysis.patterns) analysis.patterns.forEach(p => db.insertPattern(p));
            if (analysis.emotions) analysis.emotions.forEach(e => db.insertEmotion(e));
            if (analysis.decisions) analysis.decisions.forEach(d => db.insertDecision(d));
          }
          for (const m of batch) db.markMomentProcessed(m.id);
        } catch (err) {
          console.error('Batch processing error:', err.message);
        }

        processed += batch.length;
        sendProgress({
          stage: 'analyzing',
          message: `Analyzed ${processed} of ${unprocessedMoments.length} moments...`,
          processed,
          total: unprocessedMoments.length,
        });
      }

      sendProgress({ stage: 'scoring', message: 'Computing your Life Recovery Score...' });
      const scores = computeScores(db);
      db.saveScores(scores);
      sendProgress({ stage: 'complete', message: 'Analysis complete!' });

      return { success: true, momentsCount: moments.length, scores };
    } catch (err) {
      console.error('Import error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('select-photos-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      defaultPath: path.join(require('os').homedir(), 'Pictures'),
    });
    if (result.canceled) return null;
    db.setConfig('photos_folder', result.filePaths[0]);
    db.setConfig('connector_photos', 'enabled');
    return result.filePaths[0];
  });

  ipcMain.handle('recalculate-scores', () => {
    const scores = computeScores(db);
    db.saveScores(scores);
    return scores;
  });

  ipcMain.handle('delete-all-data', () => { db.deleteAllData(); return true; });

  ipcMain.handle('export-data', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'jurni-export.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled) return null;
    const exportData = db.exportAll();
    fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2));
    return result.filePath;
  });
});

app.on('window-all-closed', () => {});
app.on('activate', () => { if (mainWindow === null) createWindow(); });
