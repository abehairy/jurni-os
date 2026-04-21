const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jurni', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),
  validateOpenRouterKey: (apiKey) => ipcRenderer.invoke('validate-openrouter-key', apiKey),

  // Data
  getScores: () => ipcRenderer.invoke('get-scores'),
  getMoments: (filters) => ipcRenderer.invoke('get-moments', filters),
  getEntities: (type) => ipcRenderer.invoke('get-entities', type),
  getPatterns: () => ipcRenderer.invoke('get-patterns'),
  getStats: () => ipcRenderer.invoke('get-stats'),
  getDashboardData: () => ipcRenderer.invoke('get-dashboard-data'),
  getEntityDetail: (id) => ipcRenderer.invoke('get-entity-detail', id),

  // Landscape
  getLandscape: (opts) => ipcRenderer.invoke('get-landscape', opts),
  getTileDetail: (opts) => ipcRenderer.invoke('get-tile-detail', opts),
  getTileBriefing: (opts) => ipcRenderer.invoke('get-tile-briefing', opts),
  chatWithTile: (opts) => ipcRenderer.invoke('chat-with-tile', opts),
  recategorizeMoments: () => ipcRenderer.invoke('recategorize-moments'),
  rereadAllThreads: () => ipcRenderer.invoke('reread-all-threads'),
  getAvailableModels: () => ipcRenderer.invoke('get-available-models'),
  getUserIdentity: () => ipcRenderer.invoke('get-user-identity'),
  setUserIdentity: (identity) => ipcRenderer.invoke('set-user-identity', identity),
  getSystemUserName: () => ipcRenderer.invoke('get-system-user-name'),

  // Connectors
  openConnector: (provider) => ipcRenderer.invoke('open-connector', provider),
  closeConnector: (provider) => ipcRenderer.invoke('close-connector', provider),
  getConnectorStatus: (provider) => ipcRenderer.invoke('get-connector-status', provider),
  syncProvider: (provider) => ipcRenderer.invoke('sync-provider', provider),
  selectPhotosFolder: () => ipcRenderer.invoke('select-photos-folder'),

  // Pins
  getPins: () => ipcRenderer.invoke('get-pins'),
  addPin: (payload) => ipcRenderer.invoke('add-pin', payload),
  removePin: (payload) => ipcRenderer.invoke('remove-pin', payload),

  // Import (secondary — historical data)
  importConversations: (filePath) => ipcRenderer.invoke('import-conversations', filePath),
  selectFile: () => ipcRenderer.invoke('select-file'),

  // Scores
  recalculateScores: () => ipcRenderer.invoke('recalculate-scores'),

  // Data management
  deleteAllData: () => ipcRenderer.invoke('delete-all-data'),
  exportData: () => ipcRenderer.invoke('export-data'),

  // Logs
  getLogs: () => ipcRenderer.invoke('get-logs'),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),

  // Auto-update
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdateStatus: (callback) => {
    const handler = (_, status) => callback(status);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },

  // Events from main process
  onImportProgress: (callback) => {
    const handler = (_, progress) => callback(progress);
    ipcRenderer.on('import-progress', handler);
    return () => ipcRenderer.removeListener('import-progress', handler);
  },
  onConnectorStatus: (callback) => {
    const handler = (_, status) => callback(status);
    ipcRenderer.on('connector-status', handler);
    return () => ipcRenderer.removeListener('connector-status', handler);
  },
  onNewMoment: (callback) => {
    const handler = (_, moment) => callback(moment);
    ipcRenderer.on('new-moment', handler);
    return () => ipcRenderer.removeListener('new-moment', handler);
  },
  onScoresUpdated: (callback) => {
    const handler = (_, scores) => callback(scores);
    ipcRenderer.on('scores-updated', handler);
    return () => ipcRenderer.removeListener('scores-updated', handler);
  },
  onLogEntry: (callback) => {
    const handler = (_, entry) => callback(entry);
    ipcRenderer.on('log-entry', handler);
    return () => ipcRenderer.removeListener('log-entry', handler);
  },
  onLandscapeUpdated: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('landscape-updated', handler);
    return () => ipcRenderer.removeListener('landscape-updated', handler);
  },
  onRecatProgress: (callback) => {
    const handler = (_, p) => callback(p);
    ipcRenderer.on('recat-progress', handler);
    return () => ipcRenderer.removeListener('recat-progress', handler);
  },
  onSyncProgress: (callback) => {
    const handler = (_, p) => callback(p);
    ipcRenderer.on('sync-progress', handler);
    return () => ipcRenderer.removeListener('sync-progress', handler);
  },
  onPinsChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('pins-changed', handler);
    return () => ipcRenderer.removeListener('pins-changed', handler);
  },
});
