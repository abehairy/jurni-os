/**
 * Preload script for the Claude/ChatGPT BrowserWindow.
 *
 * Strategy:
 * 1. SNIFF — Intercept fetch() responses to learn the real API endpoints and headers.
 * 2. CRAWL — Use the discovered endpoints to fetch all conversation history.
 * 3. SIDEBAR FALLBACK — If API crawl fails, navigate the sidebar DOM conversation by conversation.
 * 4. LIVE — Continue intercepting new outgoing messages in real-time.
 */
const { ipcRenderer } = require('electron');

let provider = null;
let capturedHashes = new Set();
let capturedCount = 0;
let crawlRunning = false;
let crawlComplete = false;
// When the social flow is about to full-navigate to the user's profile page
// (to capture self-posts on the next preload run), we suppress the usual
// crawl_complete broadcast so the main process doesn't think we're done.
let navigatingAway = false;

// Sniffed API info from the site's own requests
let sniffedHeaders = {};
let sniffedEndpoints = { conversationList: null, conversationDetail: null, orgId: null };

function detectProvider() {
  const host = window.location.hostname;
  if (host.includes('claude')) return 'claude';
  if (host.includes('chatgpt') || host.includes('openai')) return 'chatgpt';
  if (host === 'x.com' || host.endsWith('.x.com') || host.includes('twitter.com')) return 'x';
  if (host.includes('linkedin.com')) return 'linkedin';
  if (host.includes('instagram.com')) return 'instagram';
  if (host.includes('facebook.com')) return 'facebook';
  return null;
}

// ---- Message capture ----

function captureMessage(text, timestamp, conversationTitle, source, role, opts) {
  if (!text || text.trim().length < 5) return false;
  const clean = text.trim();
  const hash = simpleHash(clean);
  if (capturedHashes.has(hash)) return false;
  capturedHashes.add(hash);
  capturedCount++;
  ipcRenderer.send('conversation-message', {
    text: clean,
    timestamp: timestamp || new Date().toISOString(),
    provider,
    conversationTitle: conversationTitle || document.title || 'Untitled',
    url: window.location.href,
    source,
    role: role || 'user',
    // Optional enrichment for social posts. Defaults preserve today's
    // behavior: claude/chatgpt turns stay author='self'.
    author: opts?.author || 'self',
    authorHandle: opts?.authorHandle || null,
    authorName: opts?.authorName || null,
  });
  updateStatusBar();
  return true;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < Math.min(str.length, 500); i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// ===========================================================
//  SNIFF — Hook fetch to learn the site's API patterns
// ===========================================================

function installSniffer() {
  clog('Installing network sniffer');
  const origFetch = window.fetch;

  window.fetch = async function (...args) {
    const [input, options] = args;
    const url = typeof input === 'string' ? input : (input?.url || input?.toString?.() || '');

    if (options?.headers) {
      const h = options.headers;
      if (h instanceof Headers) {
        h.forEach((v, k) => { sniffedHeaders[k] = v; });
      } else if (typeof h === 'object') {
        Object.assign(sniffedHeaders, h);
      }
    }

    if (provider === 'claude') {
      const orgMatch = url.match(/\/api\/organizations\/([^/]+)/);
      if (orgMatch) {
        if (!sniffedEndpoints.orgId) clog(`Sniffer: found org ID: ${orgMatch[1]}`);
        sniffedEndpoints.orgId = orgMatch[1];
      }

      if (url.includes('/chat_conversations') && !url.includes('/chat_conversations/')) {
        sniffedEndpoints.conversationList = url.split('?')[0];
        clog(`Sniffer: convList = ${sniffedEndpoints.conversationList}`);
      }
      if (/\/chat_conversations\/[a-f0-9-]+/.test(url)) {
        sniffedEndpoints.conversationDetail = url.replace(/\/[a-f0-9-]+(\?.*)?$/, '/{id}');
      }
    }

    if (provider === 'chatgpt') {
      if (url.includes('/backend-api/conversations')) {
        sniffedEndpoints.conversationList = url.split('?')[0];
        clog(`Sniffer: ChatGPT convList = ${sniffedEndpoints.conversationList}`);
      }
      if (/\/backend-api\/conversation\/[a-f0-9-]+/.test(url)) {
        sniffedEndpoints.conversationDetail = '/backend-api/conversation/{id}';
      }
    }

    const response = origFetch.apply(this, args);

    if (options?.method?.toUpperCase() === 'POST' && options.body) {
      try {
        const bodyStr = typeof options.body === 'string' ? options.body : null;
        if (bodyStr) {
          const parsed = JSON.parse(bodyStr);
          const text = extractTextFromPayload(parsed);
          if (text && (url.includes('/message') || url.includes('/chat') || url.includes('/completion') || url.includes('/conversation'))) {
            clog('Sniffer: live POST message captured', { len: text.length });
            captureMessage(text, new Date().toISOString(), document.title, 'live', 'human');
          }
        }
      } catch {}
    }

    return response;
  };
  clog('Network sniffer installed');
}

function extractTextFromPayload(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.prompt === 'string') return obj.prompt;
  if (typeof obj.content === 'string') return obj.content;
  if (Array.isArray(obj.messages)) {
    const last = obj.messages[obj.messages.length - 1];
    if (typeof last?.content === 'string') return last.content;
    if (last?.content?.parts) return last.content.parts.filter(p => typeof p === 'string').join('\n');
  }
  if (obj.message?.content?.parts) return obj.message.content.parts.filter(p => typeof p === 'string').join('\n');
  if (Array.isArray(obj.content)) {
    const texts = obj.content.filter(c => c.type === 'text' && c.text).map(c => c.text);
    if (texts.length) return texts.join('\n');
  }
  return null;
}

// ===========================================================
//  CRAWL — Use sniffed endpoints to fetch all conversations
// ===========================================================

async function startCrawl() {
  if (crawlRunning || crawlComplete) return;
  crawlRunning = true;
  const isSocial = ['x', 'linkedin', 'instagram', 'facebook'].includes(provider);
  sendStatus(
    'crawling',
    isSocial ? 'Preparing to read your feed...' : 'Preparing to fetch your conversation history...'
  );
  setStatusText(isSocial ? 'is preparing to read your feed...' : 'is preparing to fetch conversations...');

  await sleep(2000);

  clog('Sniffed state after wait', {
    orgId: sniffedEndpoints.orgId,
    convListEndpoint: sniffedEndpoints.conversationList,
    convDetailEndpoint: sniffedEndpoints.conversationDetail,
    headerKeys: Object.keys(sniffedHeaders),
  });

  try {
    let success = false;

    if (provider === 'claude') {
      clog('Starting Claude API crawl');
      success = await crawlClaudeAPI();
      clog(`Claude API crawl result: success=${success}, captured=${capturedCount}`);
    } else if (provider === 'chatgpt') {
      clog('Starting ChatGPT API crawl');
      success = await crawlChatGPTAPI();
      clog(`ChatGPT API crawl result: success=${success}, captured=${capturedCount}`);
    } else if (['x', 'linkedin', 'instagram', 'facebook'].includes(provider)) {
      success = await runSocialCrawl(provider);
    }

    if ((!success || capturedCount === 0) && (provider === 'claude' || provider === 'chatgpt')) {
      clog('API crawl got nothing, falling back to sidebar navigation');
      sendStatus('crawling', 'Trying sidebar navigation...');
      setStatusText('is reading conversations from the sidebar...');
      await crawlViaSidebar();
      clog(`Sidebar crawl done, captured=${capturedCount}`);
    }
  } catch (err) {
    clog('Crawl error', { error: err.message, stack: err.stack });
    try { await crawlViaSidebar(); } catch (e) { clog('Sidebar crawl also failed', { error: e.message }); }
  }

  crawlRunning = false;
  crawlComplete = true;
  if (navigatingAway) {
    clog('Suppressing crawl_complete: navigating to profile page for self-post capture');
    return;
  }
  const noun = isSocial ? 'posts' : 'messages';
  const source = isSocial ? 'your feed' : 'your history';
  sendStatus('crawl_complete', `Done! Captured ${capturedCount} ${noun} from ${source}.`);
  setStatusText(`done — ${capturedCount} ${noun} captured. Watching for new ones.`);
}

// ---- Claude API Crawl ----

async function crawlClaudeAPI() {
  if (!sniffedEndpoints.orgId) {
    clog('Org ID not sniffed, trying to discover...');
    sniffedEndpoints.orgId = await discoverClaudeOrgId();
  }
  if (!sniffedEndpoints.orgId) {
    clog('FAILED: Could not find Claude org ID by any method');
    return false;
  }

  const orgId = sniffedEndpoints.orgId;
  clog(`Found Claude org ID: ${orgId}`);

  // Try v2 endpoint first (sniffer often catches this), fall back to v1
  const endpoints = [
    sniffedEndpoints.conversationList,
    `/api/organizations/${orgId}/chat_conversations_v2`,
    `/api/organizations/${orgId}/chat_conversations`,
  ].filter(Boolean);
  // Deduplicate
  const uniqueEndpoints = [...new Set(endpoints)];
  clog(`Will try endpoints: ${JSON.stringify(uniqueEndpoints)}`);

  let allConvos = [];
  const seenIds = new Set();
  let workingEndpoint = null;

  for (const baseUrl of uniqueEndpoints) {
    clog(`Trying endpoint: ${baseUrl}`);
    allConvos = [];
    seenIds.clear();

    for (let page = 0; page < 500; page++) {
      let url;
      if (page === 0) {
        url = `${baseUrl}?limit=50`;
      } else {
        const lastItem = allConvos[allConvos.length - 1];
        const lastUuid = lastItem?.uuid || lastItem?.id;
        // Try multiple pagination strategies
        url = `${baseUrl}?limit=50&cursor=${lastUuid}&after_id=${lastUuid}`;
      }

      clog(`Fetching page ${page + 1}: ${url}`);
      sendStatus('crawling', `Loading conversations (page ${page + 1})...`);
      const resp = await safeFetch(url);
      if (!resp) { clog('Fetch returned null'); break; }

      const data = await resp.json().catch((e) => { clog('JSON parse failed', { error: e.message }); return null; });
      if (!data) break;

      let items, responseCursor, hasMore;
      if (Array.isArray(data)) {
        items = data;
      } else {
        clog('Response shape', { keys: Object.keys(data), has_more: data.has_more, cursor: data.cursor, next_cursor: data.next_cursor });
        items = data.data || data.conversations || data.results || data.items || data.chat_conversations || [];
        responseCursor = data.cursor || data.next_cursor || data.next;
        hasMore = data.has_more;
      }

      const newItems = items.filter(c => {
        const id = c.uuid || c.id;
        if (seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      });

      if (page === 0 && items.length > 0) {
        clog('First item', { keys: Object.keys(items[0]), uuid: items[0]?.uuid, created_at: items[0]?.created_at, updated_at: items[0]?.updated_at });
        clog('Last item', { uuid: items[items.length - 1]?.uuid, created_at: items[items.length - 1]?.created_at, updated_at: items[items.length - 1]?.updated_at });
      }
      clog(`Page ${page + 1}: ${items.length} returned, ${newItems.length} new (${seenIds.size} total unique)`);

      if (newItems.length === 0) {
        if (hasMore) {
          clog('Got duplicates but has_more=true, trying alternative pagination...');
          // If duplicates but has_more, our cursor approach is wrong. Try offset-based.
          // Override URL for next iteration
          break; // Will be handled by offset fallback below
        }
        clog(`Pagination stopped: 0 new items from ${items.length} returned`);
        break;
      }

      allConvos.push(...newItems);
      sendStatus('crawling', `Found ${allConvos.length} conversations...`);

      if (items.length < 50 && !hasMore) { clog('Last page (fewer than 50 and no has_more)'); break; }
      await sleep(500);
    }

    // If cursor-based pagination stalled but we got some, try offset fallback
    if (allConvos.length > 0 && allConvos.length < 200) {
      clog(`Cursor pagination got ${allConvos.length}, trying offset-based fallback...`);
      for (let offset = allConvos.length; offset < 10000; offset += 50) {
        const url = `${baseUrl}?limit=50&offset=${offset}`;
        clog(`Offset fallback: ${url}`);
        sendStatus('crawling', `Loading conversations (offset ${offset})...`);
        const resp = await safeFetch(url);
        if (!resp) break;
        const data = await resp.json().catch(() => null);
        if (!data) break;

        const items = Array.isArray(data) ? data : (data.data || data.conversations || data.results || data.items || []);
        const hasMore = data?.has_more;

        const newItems = items.filter(c => {
          const id = c.uuid || c.id;
          if (seenIds.has(id)) return false;
          seenIds.add(id);
          return true;
        });

        clog(`Offset ${offset}: ${items.length} returned, ${newItems.length} new (${seenIds.size} total)`);
        if (newItems.length === 0) { clog('Offset pagination exhausted'); break; }

        allConvos.push(...newItems);
        sendStatus('crawling', `Found ${allConvos.length} conversations...`);
        if (items.length < 50 && !hasMore) break;
        await sleep(500);
      }
    }

    if (allConvos.length > 0) {
      workingEndpoint = baseUrl;
      clog(`Endpoint ${baseUrl} yielded ${allConvos.length} total conversations`);
      break;
    }
    clog(`Endpoint ${baseUrl} returned 0 conversations, trying next...`);
  }

  if (allConvos.length === 0) return false;

  // Smart sync: ask main what we already have so we can skip threads whose
  // Claude-side updated_at is older than our latest stored message for them.
  // One IPC call per crawl, tiny payload (~N uuids). Falls back to full fetch
  // if the IPC isn't available (older main process, web dev mode).
  let syncState = {};
  try {
    syncState = await ipcRenderer.invoke('get-conversation-sync-state', 'claude') || {};
    clog(`Smart sync: have ${Object.keys(syncState).length} conversations already in DB`);
  } catch (e) {
    clog('Smart sync state unavailable, will fetch all conversations', { err: e.message });
  }

  sendStatus('crawling', `Checking ${allConvos.length} conversations...`, {
    total: allConvos.length, processed: 0, fetched: 0, threadsSkipped: 0,
  });

  let fetched = 0, threadsSkipped = 0;
  for (let i = 0; i < allConvos.length; i++) {
    const convo = allConvos[i];
    const id = convo.uuid || convo.id;
    const name = convo.name || convo.title || 'Untitled';

    // Skip if we have it AND it hasn't been updated since we last synced.
    // ISO timestamp compare is a string compare — works correctly because
    // both sides use the same format from Claude's own clock.
    const known = syncState[id];
    if (known && convo.updated_at && known.maxTs >= convo.updated_at) {
      threadsSkipped++;
      if ((i + 1) % 10 === 0 || i === allConvos.length - 1) {
        sendStatus('crawling', `Checked ${i + 1}/${allConvos.length} — skipped ${threadsSkipped} up-to-date`, {
          total: allConvos.length, processed: i + 1, fetched, threadsSkipped,
        });
      }
      continue;
    }

    const detailUrl = `/api/organizations/${orgId}/chat_conversations/${id}`;
    const resp = await safeFetch(detailUrl);
    if (!resp) { clog(`Failed to fetch conversation ${id}`); continue; }
    const detail = await resp.json().catch(() => null);
    if (!detail) { clog(`Failed to parse conversation ${id}`); continue; }

    const messages = detail.chat_messages || detail.messages || [];
    for (const msg of messages) {
      const role = msg.sender || msg.role || 'unknown';
      const text = extractClaudeText(msg);
      if (!text || text.trim().length < 2) continue;
      const ts = msg.created_at || msg.timestamp || convo.created_at;
      captureMessage(text, ts, name, 'crawl', role);
    }
    fetched++;

    if ((i + 1) % 3 === 0 || i === allConvos.length - 1) {
      sendStatus('crawling',
        `Processed ${i + 1}/${allConvos.length} — fetched ${fetched}, skipped ${threadsSkipped} up-to-date`,
        { total: allConvos.length, processed: i + 1, fetched, threadsSkipped }
      );
      setStatusText(`fetching... ${i + 1}/${allConvos.length}`);
    }
    await sleep(300);
  }

  clog(`Smart sync summary: fetched ${fetched}, skipped ${threadsSkipped} already-current`);
  return capturedCount > 0 || fetched > 0;
}

function extractClaudeText(msg) {
  if (typeof msg.text === 'string') return msg.text;
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter(c => typeof c === 'string' || (c?.type === 'text' && c?.text))
      .map(c => typeof c === 'string' ? c : c.text)
      .join('\n');
  }
  return '';
}

async function discoverClaudeOrgId() {
  // Method 1: Cookie
  clog('Org discovery: checking cookies...');
  const cookieMatch = document.cookie.match(/lastActiveOrg=([^;]+)/);
  if (cookieMatch) { clog(`Found org in cookie: ${cookieMatch[1]}`); return cookieMatch[1]; }

  // Method 2: API endpoints
  for (const endpoint of ['/api/organizations', '/api/auth/session']) {
    try {
      clog(`Org discovery: trying ${endpoint}`);
      const resp = await safeFetch(endpoint);
      if (!resp) continue;
      const data = await resp.json();
      clog(`Response from ${endpoint}`, { keys: Object.keys(data), isArray: Array.isArray(data) });
      if (Array.isArray(data) && data[0]?.uuid) { clog(`Found org: ${data[0].uuid}`); return data[0].uuid; }
      if (Array.isArray(data) && data[0]?.id) { clog(`Found org (id): ${data[0].id}`); return data[0].id; }
      if (data?.account?.memberships?.[0]?.organization?.uuid) {
        const id = data.account.memberships[0].organization.uuid;
        clog(`Found org via session: ${id}`);
        return id;
      }
      if (data?.uuid) { clog(`Found org (direct): ${data.uuid}`); return data.uuid; }
    } catch (e) { clog(`Org discovery ${endpoint} error`, { error: e.message }); }
  }

  // Method 3: Links in page
  clog('Org discovery: checking page links...');
  const links = document.querySelectorAll('a[href*="/organizations/"]');
  for (const link of links) {
    const m = link.href.match(/\/organizations\/([a-f0-9-]+)/);
    if (m) { clog(`Found org in link: ${m[1]}`); return m[1]; }
  }

  // Method 4: Script tags
  clog('Org discovery: checking script tags...');
  try {
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const text = s.textContent || '';
      if (text.includes('organization') && text.length < 50000) {
        const match = text.match(/"(?:uuid|orgId|organizationId)"\s*:\s*"([a-f0-9-]{36})"/);
        if (match) { clog(`Found org in script: ${match[1]}`); return match[1]; }
      }
    }
  } catch (e) { clog('Script tag scan error', { error: e.message }); }

  // Method 5: URL pattern
  clog('Org discovery: checking current URL...');
  const urlMatch = window.location.href.match(/\/organizations\/([a-f0-9-]+)/);
  if (urlMatch) { clog(`Found org in URL: ${urlMatch[1]}`); return urlMatch[1]; }

  clog('Org discovery: EXHAUSTED all methods, no org ID found');
  return null;
}

// ---- ChatGPT API Crawl ----

async function crawlChatGPTAPI() {
  const baseUrl = sniffedEndpoints.conversationList || '/backend-api/conversations';
  let allConvos = [];
  let offset = 0;

  for (let page = 0; page < 100; page++) {
    sendStatus('crawling', `Loading conversation list (page ${page + 1})...`);
    const resp = await safeFetch(`${baseUrl}?offset=${offset}&limit=50&order=updated`);
    if (!resp) break;
    const data = await resp.json().catch(() => null);
    if (!data) break;

    const items = data.items || data.conversations || [];
    if (items.length === 0) break;

    allConvos.push(...items);
    offset += items.length;
    sendStatus('crawling', `Found ${allConvos.length} conversations...`);
    if (items.length < 50 || offset >= (data.total || Infinity)) break;
    await sleep(500);
  }

  if (allConvos.length === 0) return false;

  sendStatus('crawling', `Fetching messages from ${allConvos.length} conversations...`);

  for (let i = 0; i < allConvos.length; i++) {
    const convo = allConvos[i];
    const id = convo.id;
    const name = convo.title || 'Untitled';

    const resp = await safeFetch(`/backend-api/conversation/${id}`);
    if (!resp) continue;
    const detail = await resp.json().catch(() => null);
    if (!detail?.mapping) continue;

    for (const [, node] of Object.entries(detail.mapping)) {
      const msg = node.message;
      if (!msg) continue;
      const role = msg.author?.role || 'unknown';
      if (role === 'system' || role === 'tool') continue;
      const parts = msg.content?.parts || [];
      const text = parts.filter(p => typeof p === 'string').join('\n');
      const ts = msg.create_time ? new Date(msg.create_time * 1000).toISOString() : null;
      captureMessage(text, ts, name, 'crawl', role);
    }

    if ((i + 1) % 3 === 0 || i === allConvos.length - 1) {
      sendStatus('crawling', `Processed ${i + 1}/${allConvos.length} conversations — ${capturedCount} messages`);
      setStatusText(`fetching... ${i + 1}/${allConvos.length} conversations`);
    }
    await sleep(300);
  }

  return capturedCount > 0;
}

// Feed selectors per provider. Virtualized feeds reuse a handful of
// `<article>` nodes — we rely on dedupe (captureMessage's hash) to avoid
// double-counting as we scroll.
const SOCIAL_FEED_CONFIG = {
  x: {
    title: 'X Posts',
    articleSelector: 'article',
    extract: (el) => {
      const textNodes = el.querySelectorAll('[data-testid="tweetText"]');
      const text = Array.from(textNodes).map((n) => n.textContent || '').join('\n').trim();
      const timeEl = el.querySelector('time');
      return { text, timestamp: timeEl?.getAttribute('datetime') || null };
    },
    extractAuthor: (el) => {
      // User-Name block holds both display name and the @handle.
      const nameEl = el.querySelector('[data-testid="User-Name"]');
      const name = nameEl?.querySelector('span')?.textContent?.trim() || null;
      const handleLink = el.querySelector('a[href^="/"][role="link"] span');
      let handle = null;
      const links = el.querySelectorAll('a[role="link"][href^="/"]');
      for (const a of links) {
        const h = a.getAttribute('href');
        if (h && /^\/[A-Za-z0-9_]{1,15}$/.test(h)) { handle = h.slice(1); break; }
      }
      return { handle, name };
    },
    // Pull the signed-in user's own handle from the left-nav profile tab.
    detectHandle: () => {
      const a = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
      const href = a?.getAttribute('href');
      if (!href) return null;
      const m = href.match(/^\/([A-Za-z0-9_]{1,15})/);
      return m ? m[1] : null;
    },
    isSelfProfilePage: (handle) =>
      !!handle && new RegExp(`^/${handle}(/with_replies)?/?$`, 'i').test(location.pathname),
    profileUrl: (handle) => `https://x.com/${handle}/with_replies`,
  },
  linkedin: {
    title: 'LinkedIn Posts',
    // LinkedIn changes class names often. Match every known variant; dedupe
    // runs at capture time so overlap is cheap.
    articleSelector: [
      '[data-id^="urn:li:activity:"]',
      '[data-urn^="urn:li:activity:"]',
      '[data-urn*="urn:li:activity"]',
      'div.feed-shared-update-v2',
      '.scaffold-finite-scroll__content > div',
      'main [role="region"] [data-view-name]',
    ].join(', '),
    extract: (el) => ({ text: extractSocialText(el), timestamp: null }),
    extractAuthor: (el) => {
      const nameEl = el.querySelector('.update-components-actor__name, .update-components-actor__title');
      const name = nameEl?.textContent?.trim().split('\n')[0] || null;
      const linkEl = el.querySelector('a.update-components-actor__meta-link, a.app-aware-link[href*="/in/"]');
      const href = linkEl?.getAttribute('href') || '';
      const m = href.match(/\/in\/([^\/?#]+)/);
      return { handle: m ? m[1] : null, name };
    },
    // On LinkedIn, /in/me/ redirects to the user's real /in/<slug>/ URL.
    // Detect from any profile link already on the page as a fallback.
    detectHandle: () => {
      const candidates = document.querySelectorAll('a[href*="/in/"]');
      for (const a of candidates) {
        const m = a.getAttribute('href').match(/\/in\/([^\/?#]+)/);
        if (m && m[1] !== 'me') return m[1];
      }
      return null;
    },
    isSelfProfilePage: (handle) =>
      !!handle && new RegExp(`^/in/${handle}(/recent-activity|/)?`, 'i').test(location.pathname),
    profileUrl: (handle) => `https://www.linkedin.com/in/${handle}/recent-activity/all/`,
  },
  instagram: {
    title: 'Instagram Posts',
    articleSelector: 'article, [role="article"]',
    extract: (el) => ({ text: extractSocialText(el), timestamp: null }),
  },
  facebook: {
    title: 'Facebook Posts',
    articleSelector: '[role="article"], [data-pagelet^="FeedUnit"]',
    extract: (el) => ({ text: extractSocialText(el), timestamp: null }),
  },
};

async function crawlSocialFeed(activeProvider) {
  const cfg = SOCIAL_FEED_CONFIG[activeProvider];
  if (!cfg) return false;

  sendStatus('crawling', 'Looking for posts in your feed...');
  setStatusText('is looking for posts...');

  // 1. Wait up to 30s for the feed to render its first posts. LinkedIn and
  //    Facebook are especially slow. If nothing shows up after ~8s, nudge the
  //    page by scrolling — some feeds defer rendering until interaction.
  const nudge = setInterval(() => window.scrollBy({ top: 300, behavior: 'instant' }), 4000);
  const appeared = await waitFor(
    () => document.querySelectorAll(cfg.articleSelector).length > 0,
    30000,
    500,
  );
  clearInterval(nudge);
  if (!appeared) {
    clog(`${activeProvider}: no posts rendered within 30s`);
    setStatusText('could not find posts on this page.');
    return false;
  }

  // 2. Scroll-and-collect. Stop when no new posts show up after 3 consecutive
  //    scrolls, or when we hit a hard cap.
  const MAX_POSTS = 150;
  const MAX_IDLE_SCROLLS = 3;
  let idleScrolls = 0;
  const nowIso = new Date().toISOString();
  const startedAt = capturedCount;

  while (capturedCount - startedAt < MAX_POSTS && idleScrolls < MAX_IDLE_SCROLLS) {
    const beforeScroll = capturedCount;
    for (const el of document.querySelectorAll(cfg.articleSelector)) {
      const { text, timestamp } = cfg.extract(el);
      if (!text) continue;
      const a = cfg.extractAuthor ? cfg.extractAuthor(el) : { handle: null, name: null };
      captureMessage(text, timestamp || nowIso, cfg.title, 'social-feed', 'human', {
        author: 'other',
        authorHandle: a.handle,
        authorName: a.name,
      });
    }

    sendStatus('crawling', `Captured ${capturedCount - startedAt} posts so far...`, {
      captured: capturedCount - startedAt,
    });
    setStatusText(`captured ${capturedCount - startedAt} posts...`);

    if (capturedCount === beforeScroll) idleScrolls++;
    else idleScrolls = 0;

    window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'instant' });
    await sleep(1500);
  }

  const captured = capturedCount - startedAt;
  sendStatus('crawling', `Captured ${captured} posts from your feed`, { captured });
  return captured > 0;
}

// Scrape the signed-in user's own post page. Same mechanics as the feed
// crawl, but every capture is tagged author='self' so the processor can
// distinguish voice from ambient content.
async function crawlSelfPosts(activeProvider) {
  const cfg = SOCIAL_FEED_CONFIG[activeProvider];
  if (!cfg) return false;

  sendStatus('crawling', 'Reading your own posts...');
  setStatusText('is reading your own posts...');

  const nudge = setInterval(() => window.scrollBy({ top: 300, behavior: 'instant' }), 4000);
  const appeared = await waitFor(
    () => document.querySelectorAll(cfg.articleSelector).length > 0,
    30000,
    500,
  );
  clearInterval(nudge);
  if (!appeared) {
    clog(`${activeProvider}: no self-posts rendered within 30s`);
    setStatusText('could not find any of your posts.');
    return false;
  }

  const MAX_POSTS = 200;
  const MAX_IDLE_SCROLLS = 3;
  let idleScrolls = 0;
  const nowIso = new Date().toISOString();
  const startedAt = capturedCount;
  const title = `${cfg.title.replace(' Posts', '')} — My Posts`;

  while (capturedCount - startedAt < MAX_POSTS && idleScrolls < MAX_IDLE_SCROLLS) {
    const before = capturedCount;
    for (const el of document.querySelectorAll(cfg.articleSelector)) {
      const { text, timestamp } = cfg.extract(el);
      if (!text) continue;
      captureMessage(text, timestamp || nowIso, title, 'social-self', 'user', {
        author: 'self',
      });
    }
    sendStatus('crawling', `Captured ${capturedCount - startedAt} of your posts...`, {
      captured: capturedCount - startedAt,
    });
    setStatusText(`captured ${capturedCount - startedAt} of your posts...`);

    if (capturedCount === before) idleScrolls++;
    else idleScrolls = 0;

    window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'instant' });
    await sleep(1500);
  }

  const captured = capturedCount - startedAt;
  sendStatus('crawling', `Captured ${captured} of your own posts`, { captured });
  return captured > 0;
}

// Orchestrate the right crawl for the page we're on: feed first, then chain
// to the user's own profile for self-post capture. Handle is detected once
// and cached in app config so we don't re-detect on every sync.
async function runSocialCrawl(activeProvider) {
  const cfg = SOCIAL_FEED_CONFIG[activeProvider];
  if (!cfg) return false;

  const cached = await getCachedHandle(activeProvider);

  // Case 1: we arrived on the user's own profile page. Scrape self-posts.
  if (cfg.isSelfProfilePage && cached && cfg.isSelfProfilePage(cached)) {
    clog(`${activeProvider}: on self-profile page (handle=${cached}), crawling own posts`);
    return await crawlSelfPosts(activeProvider);
  }

  // Case 2: we're on the feed (or anywhere that isn't the self-profile).
  // Run the feed crawl as ambient content, then chain to /profile if we can.
  clog(`${activeProvider}: running feed crawl`);
  const feedOk = await crawlSocialFeed(activeProvider);

  if (!cfg.detectHandle || !cfg.profileUrl) return feedOk;

  let handle = cached;
  if (!handle) {
    handle = cfg.detectHandle();
    if (handle) {
      clog(`${activeProvider}: detected handle=${handle}, caching`);
      await setCachedHandle(activeProvider, handle);
    }
  }

  if (handle && !cfg.isSelfProfilePage(handle)) {
    const url = cfg.profileUrl(handle);
    clog(`${activeProvider}: navigating to self-profile ${url}`);
    setStatusText('switching to your profile...');
    sendStatus('crawling', 'Switching to your profile page...');
    navigatingAway = true;
    await sleep(1500);
    window.location.href = url;
    return true;
  }
  return feedOk;
}

async function getCachedHandle(activeProvider) {
  try {
    const cfg = await ipcRenderer.invoke('get-config');
    return cfg?.[`handle_${activeProvider}`] || null;
  } catch (_) { return null; }
}

async function setCachedHandle(activeProvider, handle) {
  try { await ipcRenderer.invoke('set-config', `handle_${activeProvider}`, handle); } catch (_) {}
}

// Poll `cond` every `intervalMs` up to `timeoutMs`. Returns true if it ever
// returned truthy, false if we hit the timeout.
async function waitFor(cond, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (cond()) return true; } catch (_) {}
    await sleep(intervalMs);
  }
  return false;
}

function extractSocialText(rootEl) {
  const selectors = [
    '[data-testid="tweetText"]',
    '.update-components-text',
    '.feed-shared-update-v2__description',
    'h1, h2, h3, h4, p, span',
  ];
  for (const sel of selectors) {
    const nodes = rootEl.querySelectorAll(sel);
    if (!nodes.length) continue;
    const text = Array.from(nodes)
      .map(n => (n.textContent || '').trim())
      .filter(Boolean)
      .join('\n')
      .trim();
    if (text.length >= 20) return text;
  }
  return '';
}

// ===========================================================
//  SIDEBAR FALLBACK — Navigate the DOM if API crawl failed
// ===========================================================

async function crawlViaSidebar() {
  clog('Starting sidebar DOM crawl');
  sendStatus('crawling', 'Reading conversations from sidebar...');

  const links = findSidebarLinks();
  clog(`Sidebar links found: ${links.length}`);
  if (links.length === 0) {
    clog('No sidebar links found with any selector');
    sendStatus('crawl_error', 'No conversations found in sidebar. Try scrolling through your conversation list first.');
    return;
  }

  sendStatus('crawling', `Found ${links.length} conversations in sidebar. Fetching each...`);

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const name = link.textContent?.trim() || 'Untitled';

    // Navigate to the conversation
    try {
      link.click();
      await sleep(2000); // Wait for conversation to load

      // Scrape user messages from the loaded conversation
      scrapeVisibleMessages(name);

      sendStatus('crawling', `Read ${i + 1}/${links.length} conversations — ${capturedCount} messages`);
      setStatusText(`reading... ${i + 1}/${links.length} conversations`);
    } catch (e) {
      console.error(`[Jurni] Error reading conversation ${i}:`, e);
    }

    await sleep(500);
  }
}

function findSidebarLinks() {
  // Try various selectors that sidebar conversation links might match
  const selectors = [
    'nav a[href*="/chat/"]',
    'nav a[href*="/c/"]',
    'a[href*="/chat/"][class*="conversation"]',
    'a[href*="/c/"][class*="conversation"]',
    '[data-testid*="conversation"] a',
    '[class*="sidebar"] a[href*="/chat"]',
    '[class*="sidebar"] a[href*="/c/"]',
    'nav ol a', 'nav ul a',
    'aside a[href*="/chat"]',
    'aside a[href*="/c/"]',
  ];

  for (const sel of selectors) {
    const links = document.querySelectorAll(sel);
    if (links.length > 0) {
      clog(`Found ${links.length} sidebar links with selector: ${sel}`);
      return Array.from(links);
    }
  }

  const allLinks = document.querySelectorAll('a[href]');
  const convoLinks = Array.from(allLinks).filter(a => {
    const href = a.getAttribute('href') || '';
    return (href.match(/\/chat\/[a-f0-9-]+/) || href.match(/\/c\/[a-f0-9-]+/));
  });

  clog(`Broad href scan found ${convoLinks.length} conversation links (total <a> on page: ${allLinks.length})`);
  return convoLinks;
}

function scrapeVisibleMessages(conversationTitle) {
  const roleSelectors = [
    { sel: '[data-testid*="user"], [data-message-author-role="user"], [class*="human-turn"], [class*="human_turn"], [class*="user-message"], [class*="UserMessage"]', role: 'human' },
    { sel: '[data-testid*="assistant"], [data-message-author-role="assistant"], [class*="assistant-turn"], [class*="ai-turn"], [class*="AssistantMessage"]', role: 'assistant' },
  ];

  for (const { sel, role } of roleSelectors) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('button, svg, [role="toolbar"], [class*="copy"], [class*="action"]')
        .forEach(n => n.remove());
      const text = (clone.textContent || '').trim();
      if (text.length >= 5) {
        captureMessage(text, null, conversationTitle, 'dom-scrape', role);
      }
    }
  }

  const turnContainers = document.querySelectorAll('[class*="turn"], [class*="Turn"], [class*="message-row"], [class*="MessageRow"]');
  for (const container of turnContainers) {
    const isHuman = container.className?.includes('human') ||
      container.className?.includes('user') ||
      container.getAttribute('data-role') === 'user' ||
      container.querySelector('[class*="human"], [class*="user-icon"], [class*="UserIcon"]');
    const role = isHuman ? 'human' : 'assistant';
    const text = container.textContent?.trim();
    if (text && text.length >= 5) {
      captureMessage(text, null, conversationTitle, 'dom-scrape', role);
    }
  }
}

// ===========================================================
//  Helper: fetch with sniffed headers + error handling
// ===========================================================

async function safeFetch(url) {
  try {
    const headers = { ...sniffedHeaders };
    delete headers['content-type'];
    delete headers['Content-Type'];

    const resp = await fetch(url, { headers, credentials: 'include' });
    if (!resp.ok) {
      clog(`safeFetch FAIL: ${url} → HTTP ${resp.status} ${resp.statusText}`);
      return null;
    }
    clog(`safeFetch OK: ${url} → ${resp.status}`);
    return resp;
  } catch (err) {
    clog(`safeFetch ERROR: ${url}`, { error: err.message });
    return null;
  }
}

// ===========================================================
//  Status Bar UI
// ===========================================================

function injectStatusBar() {
  if (document.getElementById('jurni-status-bar')) return;
  const names = {
    claude: 'Claude', chatgpt: 'ChatGPT',
    x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook',
  };
  const name = names[provider] || provider || 'source';
  const bar = document.createElement('div');
  bar.id = 'jurni-status-bar';
  bar.innerHTML = `
    <div id="jurni-bar-inner" style="
      position:fixed;top:0;left:0;right:0;z-index:2147483647;
      background:linear-gradient(135deg,#C4745A 0%,#D4917D 100%);
      color:white;font-family:-apple-system,BlinkMacSystemFont,'DM Sans',sans-serif;
      font-size:12px;padding:6px 16px;display:flex;align-items:center;
      justify-content:space-between;box-shadow:0 2px 8px rgba(0,0,0,0.15);
      pointer-events:auto;
    ">
      <div style="display:flex;align-items:center;gap:8px;">
        <span id="jurni-dot" style="display:inline-block;width:8px;height:8px;background:#4ade80;
          border-radius:50%;animation:jurni-pulse 2s infinite;"></span>
        <strong>Jurni</strong>
        <span id="jurni-status-text">connecting to ${name}...</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        <span id="jurni-capture-count" style="opacity:0.8;">0 messages</span>
        <button id="jurni-minimize-bar" style="
          background:rgba(255,255,255,0.2);border:none;color:white;
          border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;
        ">minimize</button>
      </div>
    </div>
    <style>
      @keyframes jurni-pulse { 0%,100%{opacity:1;} 50%{opacity:0.4;} }
      body { padding-top: 34px !important; }
    </style>`;
  // Mount on <html> rather than <body>: React hydration often wipes the body
  // subtree on sites like LinkedIn, which would take the bar with it.
  document.documentElement.appendChild(bar);
  document.getElementById('jurni-minimize-bar')?.addEventListener('click', () => {
    const inner = document.getElementById('jurni-bar-inner');
    if (!inner) return;
    const hidden = inner.style.display === 'none';
    inner.style.display = hidden ? 'flex' : 'none';
    if (document.body) document.body.style.paddingTop = hidden ? '34px' : '0';
  });
  // If the site removes our bar (aggressive re-renders, ad blockers, CSP),
  // re-append it. Observe <html> children so we catch body-level deletions.
  if (!window.__jurniBarObserver) {
    window.__jurniBarObserver = new MutationObserver(() => {
      if (!document.getElementById('jurni-status-bar')) injectStatusBar();
    });
    window.__jurniBarObserver.observe(document.documentElement, { childList: true, subtree: false });
  }
}

function updateStatusBar() {
  const el = document.getElementById('jurni-capture-count');
  if (el) el.textContent = `${capturedCount} message${capturedCount !== 1 ? 's' : ''}`;
}

function setStatusText(text) {
  const el = document.getElementById('jurni-status-text');
  if (el) el.textContent = text;
}

// ===========================================================
//  Helpers
// ===========================================================

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function clog(message, data) {
  console.log(`[Jurni] ${message}`, data || '');
  ipcRenderer.send('crawler-log', { message, data });
}

function sendStatus(status, message, data) {
  clog(`Status: ${status} — ${message}`, data);
  ipcRenderer.send('browser-status', {
    provider, status, message, capturedCount,
    url: window.location.href,
    data: data || null,
  });
}

// ===========================================================
//  Init
// ===========================================================

let initialized = false;

async function init() {
  if (initialized) return;
  initialized = true;

  provider = detectProvider();
  clog(`Init: provider=${provider}, url=${window.location.href}`);
  if (!provider) { clog('Init: unknown provider, aborting'); return; }

  installSniffer();
  injectStatusBar();

  sendStatus('connecting', 'Waiting for login...');
  clog('Waiting 5s for page to make API calls...');
  await sleep(5000);

  clog('Checking login status...');
  const loggedIn = await detectLogin();
  clog(`Login check result: ${loggedIn}`);

  const isSocial = ['x', 'linkedin', 'instagram', 'facebook'].includes(provider);
  const startText = isSocial
    ? 'is reading your feed...'
    : 'is fetching your conversation history...';
  const startSendMsg = isSocial
    ? 'Reading your feed...'
    : 'Starting conversation fetch...';

  if (loggedIn) {
    setStatusText(startText);
    sendStatus('crawling', startSendMsg);
    await startCrawl();
  } else {
    setStatusText('waiting for you to sign in...');
    sendStatus('login_required', 'Please sign in');

    // Poll until login detected
    const interval = setInterval(async () => {
      const ok = await detectLogin();
      if (ok) {
        clearInterval(interval);
        // Wait for page to settle after login
        await sleep(3000);
        setStatusText(startText);
        sendStatus('crawling', isSocial ? 'Login detected! Reading feed...' : 'Login detected! Fetching...');
        await startCrawl();
      }
    }, 5000);
  }
}

async function detectLogin() {
  // Check if we can hit any authenticated endpoint
  if (provider === 'claude') {
    // Use org endpoint or check for sidebar content
    const hasOrgId = sniffedEndpoints.orgId || await discoverClaudeOrgId();
    if (hasOrgId) return true;
    // Fallback: check if there's a chat input on the page
    return !!document.querySelector('[contenteditable="true"], textarea, [class*="input"]');
  } else if (provider === 'chatgpt') {
    const resp = await safeFetch('/backend-api/conversations?limit=1');
    return !!resp;
  }
  // Social providers: if we're on a feed-like page and not on obvious login paths,
  // treat it as signed in. This keeps the flow fast while staying simple.
  const href = window.location.href;
  if (/login|signin|challenge|checkpoint/i.test(href)) return false;
  return true;
}

// Start after page loads
if (document.readyState === 'complete') {
  setTimeout(init, 2000);
} else {
  window.addEventListener('load', () => setTimeout(init, 2000));
}
