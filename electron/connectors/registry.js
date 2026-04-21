/**
 * Browser connector registry.
 *
 * `kind` declares what the captured data IS, which drives how the processing
 * pipeline treats it (see processing/kinds.js). 'dialogue' = back-and-forth
 * chat (goes through thread categorization). 'post' = standalone social post
 * (each stands alone; no thread categorization).
 */
const BROWSER_CONNECTORS = {
  claude: {
    id: 'claude',
    title: 'Claude',
    url: 'https://claude.ai',
    kind: 'dialogue',
    supportsSync: true,
    supportsHistoricalImport: true,
  },
  chatgpt: {
    id: 'chatgpt',
    title: 'ChatGPT',
    url: 'https://chatgpt.com',
    kind: 'dialogue',
    supportsSync: true,
    supportsHistoricalImport: true,
  },
  x: {
    id: 'x',
    title: 'X',
    url: 'https://x.com',
    kind: 'post',
    supportsSync: true,
    supportsHistoricalImport: false,
  },
  linkedin: {
    id: 'linkedin',
    title: 'LinkedIn',
    url: 'https://www.linkedin.com/feed/',
    kind: 'post',
    supportsSync: true,
    supportsHistoricalImport: false,
  },
  instagram: {
    id: 'instagram',
    title: 'Instagram',
    url: 'https://www.instagram.com',
    kind: 'post',
    supportsSync: true,
    supportsHistoricalImport: false,
  },
  facebook: {
    id: 'facebook',
    title: 'Facebook',
    url: 'https://www.facebook.com',
    kind: 'post',
    supportsSync: true,
    supportsHistoricalImport: false,
  },
};

function getBrowserConnector(provider) {
  return BROWSER_CONNECTORS[provider] || null;
}

function listBrowserConnectors() {
  return Object.values(BROWSER_CONNECTORS);
}

module.exports = {
  BROWSER_CONNECTORS,
  getBrowserConnector,
  listBrowserConnectors,
};
