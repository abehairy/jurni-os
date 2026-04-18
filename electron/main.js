const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('./database');
const { processConversationImport } = require('../channels/conversation');
const { processBatch } = require('../processing/processor');
const { computeScores } = require('../scoring/engine');

const JURNI_DIR = path.join(require('os').homedir(), '.jurni');
const LOG_PATH = path.join(JURNI_DIR, 'crawler.log');
const isDev = !app.isPackaged;

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
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#FAF7F2',
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
  const icon = nativeImage.createFromNamedImage('NSStatusAvailable', [-1, 0, 1]);
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
  const urls = {
    claude: 'https://claude.ai',
    chatgpt: 'https://chatgpt.com',
  };

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
    title: `Jurni — Sign in to ${provider === 'claude' ? 'Claude' : 'ChatGPT'}`,
    webPreferences: {
      preload: path.join(__dirname, '..', 'channels', 'browser-preload.js'),
      contextIsolation: false,
      partition,
    },
  });

  log('connector', `Loading URL: ${urls[provider]} (partition: ${partition})`);
  win.loadURL(urls[provider]);
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

  const moment = {
    timestamp: message.timestamp,
    source: 'conversation',
    raw_content: message.text,
    metadata: {
      provider: message.provider,
      conversation_name: message.conversationTitle || 'Untitled',
      url: message.url,
      capture_mode: message.source || 'live',
      role: message.role || 'user',
    },
  };

  const id = db.insertMoment(moment);
  if (message.provider) connectorCounts[message.provider] = (connectorCounts[message.provider] || 0) + 1;

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

function scheduleAutoProcess() {
  if (autoProcessTimer) return;
  autoProcessTimer = setTimeout(() => {
    autoProcessTimer = null;
    autoProcessBatch();
  }, 10000); // Wait 10s between batch attempts to avoid spam
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

  try {
    const analysis = await processBatch(batch, existingEntities, recentPatterns, apiKey);
    log('main', 'LLM analysis complete', {
      entities: analysis.entities?.length || 0,
      patterns: analysis.patterns?.length || 0,
      emotions: analysis.emotions?.length || 0,
      decisions: analysis.decisions?.length || 0,
    });
    if (analysis.entities) analysis.entities.forEach(e => db.upsertEntity(e));
    if (analysis.patterns) analysis.patterns.forEach(p => db.insertPattern(p));
    if (analysis.emotions) analysis.emotions.forEach(e => db.insertEmotion(e));
    if (analysis.decisions) analysis.decisions.forEach(d => db.insertDecision(d));
    batch.forEach(m => db.markMomentProcessed(m.id));

    const scores = computeScores(db);
    db.saveScores(scores);
    log('main', 'Scores updated', { overall: scores.overall });
    sendToMain('scores-updated', scores);
  } catch (err) {
    log('main', 'Auto-process ERROR', { error: err.message, stack: err.stack?.split('\n').slice(0, 3) });
  }
  autoProcessRunning = false;

  // If more unprocessed moments remain, schedule another batch
  const remaining = db.getUnprocessedMoments();
  if (remaining.length >= 5) {
    log('main', `${remaining.length} moments still unprocessed, scheduling next batch`);
    scheduleAutoProcess();
  }
}

// ---- App Lifecycle ----

app.whenReady().then(() => {
  ensureJurniDir();
  initLogger();
  log('main', 'Jurni starting up');

  db = new Database(JURNI_DIR);
  db.initialize();
  log('main', 'Database initialized');

  createWindow();
  createTray();

  // Kick-start processing if there are unprocessed moments from a previous session
  const unprocessed = db.getUnprocessedMoments();
  if (unprocessed.length > 0) {
    log('main', `Found ${unprocessed.length} unprocessed moments from previous session, starting processing`);
    scheduleAutoProcess();
  }

  // Listen for messages from browser preload scripts
  ipcMain.on('conversation-message', (event, msg) => {
    log('capture', `Message from ${msg.provider} (${msg.source})`, { len: msg.text?.length, title: msg.conversationTitle });
    handleCapturedMessage(event, msg);
  });
  ipcMain.on('browser-status', (event, status) => {
    log('browser', `${status.provider}: ${status.status}`, { message: status.message, count: status.capturedCount });
    sendToMain('connector-status', status);
  });
  ipcMain.on('crawler-log', (event, entry) => {
    log('crawler', entry.message, entry.data);
  });

  // ---- IPC Handlers ----

  ipcMain.handle('get-config', () => db.getConfig());
  ipcMain.handle('set-config', (_, key, value) => { db.setConfig(key, value); return true; });

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
      for (const moment of moments) db.insertMoment(moment);

      sendProgress({ stage: 'analyzing', message: 'Running AI analysis...', total: moments.length });

      const unprocessedMoments = db.getUnprocessedMoments();
      const batchSize = 20;
      let processed = 0;

      for (let i = 0; i < unprocessedMoments.length; i += batchSize) {
        const batch = unprocessedMoments.slice(i, i + batchSize);
        const existingEntities = db.getEntities();
        const recentPatterns = db.getPatterns();

        try {
          const analysis = await processBatch(batch, existingEntities, recentPatterns, apiKey);
          if (analysis.entities) analysis.entities.forEach(e => db.upsertEntity(e));
          if (analysis.patterns) analysis.patterns.forEach(p => db.insertPattern(p));
          if (analysis.emotions) analysis.emotions.forEach(e => db.insertEmotion(e));
          if (analysis.decisions) analysis.decisions.forEach(d => db.insertDecision(d));
          batch.forEach(m => db.markMomentProcessed(m.id));
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
