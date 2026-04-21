/**
 * Auto-update module — thin wrapper around electron-updater.
 *
 * Behavior:
 *   · On startup (when main window is ready), check once after 8s.
 *   · Re-check every 4 hours while the app runs.
 *   · On new version found: download silently in background, show a toast
 *     in the renderer ("update-available" → "update-downloaded"), user
 *     clicks "Restart to install" and we quitAndInstall.
 *   · Skipped in dev (`app.isPackaged === false`) — there's nothing to update.
 *
 * No hard dependency on the renderer. IPC events are best-effort; if the
 * main window isn't open yet, electron-updater's native dialog still fires.
 */
const { autoUpdater } = require('electron-updater');
const { app, ipcMain } = require('electron');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

function initAutoUpdater({ log, sendToMain }) {
  if (!app.isPackaged) {
    log('updater', 'skipped (dev mode — app is not packaged)');
    return;
  }

  // electron-updater picks up publish config from package.json automatically.
  // We want non-silent install (user controls when), but auto-download so the
  // update is ready to apply the moment they click.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.logger = {
    info: (m) => log('updater', String(m)),
    warn: (m) => log('updater', `WARN: ${String(m)}`),
    error: (m) => log('updater', `ERROR: ${String(m)}`),
    debug: () => {},
  };

  autoUpdater.on('checking-for-update', () => {
    sendToMain('update-status', { state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    log('updater', `update-available v${info.version}`);
    sendToMain('update-status', { state: 'downloading', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    sendToMain('update-status', { state: 'current' });
  });

  autoUpdater.on('download-progress', (p) => {
    sendToMain('update-status', {
      state: 'downloading',
      percent: Math.round(p.percent || 0),
      bytesPerSecond: p.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log('updater', `update-downloaded v${info.version} — ready to install`);
    sendToMain('update-status', { state: 'ready', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    log('updater', `error: ${err?.message || err}`);
    sendToMain('update-status', { state: 'error', message: String(err?.message || err) });
  });

  // Renderer requests to restart + install now.
  ipcMain.handle('update-install', () => {
    log('updater', 'quitAndInstall requested by renderer');
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });

  // Renderer asks for a manual check (Settings button).
  ipcMain.handle('update-check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { ok: true, version: result?.updateInfo?.version || null };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Kick off first check 8s after startup so we don't compete with UI render.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => log('updater', `first check failed: ${err.message}`));
  }, 8000);

  // Periodic re-check.
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => log('updater', `periodic check failed: ${err.message}`));
  }, CHECK_INTERVAL_MS);

  log('updater', 'initialised (will check in 8s, then every 4h)');
}

module.exports = { initAutoUpdater };
