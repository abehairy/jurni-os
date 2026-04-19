const BetterSqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/**
 * Deterministic short hash of a message body. Used as part of the dedup
 * key `(source, timestamp, content_hash)` so re-crawls and re-imports are
 * idempotent. SHA-1 truncated to 16 hex chars — collision probability is
 * negligible at any realistic personal-data scale.
 */
function hashContent(str) {
  return crypto.createHash('sha1').update(String(str || '')).digest('hex').slice(0, 16);
}

class Database {
  constructor(jurniDir) {
    this.jurniDir = jurniDir;
    this.dbPath = path.join(jurniDir, 'jurni.db');
    this.configPath = path.join(jurniDir, 'config.json');
    this.db = null;
  }

  initialize() {
    this.db = new BetterSqlite3(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.createTables();
    return this;
  }

  createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS moments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('conversation', 'photo', 'calendar')),
        raw_content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        processed INTEGER DEFAULT 0,
        topic TEXT,
        category TEXT,
        tone TEXT,
        summary TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('person', 'project', 'place', 'topic')),
        first_seen TEXT,
        last_seen TEXT,
        mention_count INTEGER DEFAULT 1,
        sentiment_trajectory TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}',
        UNIQUE(name, type)
      );

      CREATE TABLE IF NOT EXISTS patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        evidence TEXT DEFAULT '[]',
        first_detected TEXT DEFAULT (datetime('now')),
        last_updated TEXT DEFAULT (datetime('now')),
        active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS emotions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        moment_id INTEGER,
        type TEXT NOT NULL,
        intensity REAL DEFAULT 0.5,
        valence TEXT CHECK(valence IN ('positive', 'negative', 'neutral')),
        trigger TEXT,
        timestamp TEXT,
        FOREIGN KEY (moment_id) REFERENCES moments(id)
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'made', 'revisited', 'abandoned')),
        first_seen TEXT DEFAULT (datetime('now')),
        last_seen TEXT DEFAULT (datetime('now')),
        revisit_count INTEGER DEFAULT 0,
        moment_ids TEXT DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        overall INTEGER NOT NULL,
        emotional INTEGER NOT NULL,
        mental INTEGER NOT NULL,
        relational INTEGER NOT NULL,
        routine INTEGER NOT NULL,
        professional INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_moments_source ON moments(source);
      CREATE INDEX IF NOT EXISTS idx_moments_timestamp ON moments(timestamp);
      CREATE INDEX IF NOT EXISTS idx_moments_processed ON moments(processed);
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_emotions_moment ON emotions(moment_id);
      CREATE INDEX IF NOT EXISTS idx_emotions_type ON emotions(type);
      CREATE INDEX IF NOT EXISTS idx_emotions_timestamp ON emotions(timestamp);
      CREATE INDEX IF NOT EXISTS idx_scores_date ON scores(date);
    `);

    // Migrations: add landscape columns if they don't exist (for older DBs)
    const cols = this.db.prepare("PRAGMA table_info(moments)").all().map(c => c.name);
    if (!cols.includes('topic')) this.db.exec('ALTER TABLE moments ADD COLUMN topic TEXT');
    if (!cols.includes('category')) this.db.exec('ALTER TABLE moments ADD COLUMN category TEXT');
    if (!cols.includes('tone')) this.db.exec('ALTER TABLE moments ADD COLUMN tone TEXT');
    if (!cols.includes('summary')) this.db.exec('ALTER TABLE moments ADD COLUMN summary TEXT');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_moments_topic ON moments(topic)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_moments_category ON moments(category)');

    // --- Dedup migration (one-time per DB) ------------------------------
    // The connector window used to insert every captured message on every
    // re-crawl because there was no uniqueness constraint. Here we:
    //   1. add a content_hash column
    //   2. backfill hashes
    //   3. delete duplicates (and their orphaned emotions)
    //   4. create a UNIQUE index that makes insertMoment idempotent forever
    if (!cols.includes('content_hash')) {
      const runMigration = this.db.transaction(() => {
        this.db.exec('ALTER TABLE moments ADD COLUMN content_hash TEXT');

        const rows = this.db.prepare('SELECT id, raw_content FROM moments').all();
        const upd = this.db.prepare('UPDATE moments SET content_hash = ? WHERE id = ?');
        for (const r of rows) upd.run(hashContent(r.raw_content), r.id);

        const before = this.db.prepare('SELECT COUNT(*) AS c FROM moments').get().c;
        const dupIds = this.db.prepare(`
          SELECT id FROM moments
          WHERE id NOT IN (
            SELECT MIN(id) FROM moments
            GROUP BY source, timestamp, content_hash
          )
        `).all().map(r => r.id);

        if (dupIds.length > 0) {
          const delEmotion = this.db.prepare('DELETE FROM emotions WHERE moment_id = ?');
          const delMoment = this.db.prepare('DELETE FROM moments WHERE id = ?');
          for (const id of dupIds) { delEmotion.run(id); delMoment.run(id); }
        }

        this.db.exec(
          'CREATE UNIQUE INDEX IF NOT EXISTS idx_moments_dedup ' +
          'ON moments(source, timestamp, content_hash)'
        );

        console.log(
          `[db] dedup migration: ${before} → ${before - dupIds.length} moments ` +
          `(${dupIds.length} duplicates removed)`
        );
      });
      runMigration();
    } else {
      // Always make sure the unique index exists on already-migrated DBs
      this.db.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_moments_dedup ' +
        'ON moments(source, timestamp, content_hash)'
      );
    }
  }

  // --- Config ---

  getConfig() {
    const rows = this.db.prepare('SELECT key, value FROM config').all();
    const config = {};
    for (const row of rows) {
      try { config[row.key] = JSON.parse(row.value); } catch { config[row.key] = row.value; }
    }
    return config;
  }

  getConfigValue(key) {
    const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }

  setConfig(key, value) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    this.db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, serialized);
    this.syncConfigFile();
  }

  syncConfigFile() {
    const config = this.getConfig();
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  // --- Moments ---

  insertMoment(moment) {
    // INSERT OR IGNORE + UNIQUE(source, timestamp, content_hash) gives us
    // idempotent ingestion: re-running the Claude crawler (or re-importing
    // the same JSON) will not duplicate existing rows.
    // Returns { id, inserted } — id is null when the row was a duplicate.
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO moments
        (timestamp, source, raw_content, metadata, content_hash)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      moment.timestamp,
      moment.source,
      moment.raw_content,
      JSON.stringify(moment.metadata || {}),
      hashContent(moment.raw_content)
    );
    if (result.changes === 0) return { id: null, inserted: false };
    return { id: result.lastInsertRowid, inserted: true };
  }

  getMoments(filters = {}) {
    let query = 'SELECT * FROM moments WHERE 1=1';
    const params = [];

    if (filters.source) {
      query += ' AND source = ?';
      params.push(filters.source);
    }
    if (filters.startDate) {
      query += ' AND timestamp >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      query += ' AND timestamp <= ?';
      params.push(filters.endDate);
    }

    query += ' ORDER BY timestamp DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const rows = this.db.prepare(query).all(...params);
    return rows.map(r => ({ ...r, metadata: JSON.parse(r.metadata || '{}') }));
  }

  getUnprocessedMoments() {
    return this.db.prepare('SELECT * FROM moments WHERE processed = 0 ORDER BY timestamp ASC').all()
      .map(r => ({ ...r, metadata: JSON.parse(r.metadata || '{}') }));
  }

  /**
   * For smart sync: returns { [conversationUuid]: { maxTs, count } } for a
   * given provider. The crawler uses this to skip re-fetching conversations
   * whose `updated_at` from the Claude API is older than our latest stored
   * message — turning a full re-sync into a metadata-only walk.
   *
   * UUID is parsed from metadata.url (format: .../chat/<uuid>) — no schema
   * change needed.
   */
  getConversationSyncState(provider) {
    const rows = this.db.prepare(`
      SELECT metadata, timestamp
      FROM moments
      WHERE source = 'conversation'
        AND json_extract(metadata, '$.provider') = ?
    `).all(provider);

    const state = {};
    const uuidRe = /\/chat\/([0-9a-f-]{36})/i;
    for (const r of rows) {
      let md;
      try { md = JSON.parse(r.metadata || '{}'); } catch { continue; }
      let uuid = md.conversation_uuid;
      if (!uuid && md.url) {
        const m = md.url.match(uuidRe);
        if (m) uuid = m[1];
      }
      if (!uuid) continue;
      const existing = state[uuid];
      if (!existing) {
        state[uuid] = { maxTs: r.timestamp, count: 1 };
      } else {
        existing.count += 1;
        if (r.timestamp > existing.maxTs) existing.maxTs = r.timestamp;
      }
    }
    return state;
  }

  markMomentProcessed(id, landscape) {
    if (landscape) {
      this.db.prepare(`
        UPDATE moments
        SET processed = 1, topic = ?, category = ?, tone = ?, summary = ?
        WHERE id = ?
      `).run(
        landscape.topic || null,
        landscape.category || null,
        landscape.tone || null,
        landscape.summary || null,
        id
      );
    } else {
      this.db.prepare('UPDATE moments SET processed = 1 WHERE id = ?').run(id);
    }
  }

  // Set topic/category/tone/summary without flipping processed (for re-categorization passes)
  updateMomentLandscape(id, landscape) {
    this.db.prepare(`
      UPDATE moments SET topic = ?, category = ?, tone = ?, summary = ? WHERE id = ?
    `).run(
      landscape.topic || null,
      landscape.category || null,
      landscape.tone || null,
      landscape.summary || null,
      id
    );
  }

  // Moments that have been processed but have no category tag yet (need recategorization)
  getUncategorizedMoments(limit = 50) {
    return this.db.prepare(`
      SELECT * FROM moments
      WHERE processed = 1 AND (category IS NULL OR category = '')
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit).map(r => ({ ...r, metadata: JSON.parse(r.metadata || '{}') }));
  }

  // ---------- Thread-level operations (for Life Landscape categorization) ----------

  /**
   * Return conversation threads that still have at least one uncategorized
   * moment. Ordered by most-recently-active first. Each thread includes
   * all of its moments in chronological order.
   *
   * @param {number} limit  max number of threads to return
   */
  getUncategorizedThreads(limit = 10) {
    const threadRows = this.db.prepare(`
      SELECT json_extract(metadata, '$.conversation_name') as title,
             COUNT(*) as total_messages,
             MAX(timestamp) as last_active,
             MIN(timestamp) as first_active
      FROM moments
      WHERE source = 'conversation'
        AND json_extract(metadata, '$.conversation_name') IS NOT NULL
        AND id IN (
          SELECT id FROM moments
          WHERE source = 'conversation' AND (category IS NULL OR category = '')
        )
      GROUP BY title
      ORDER BY last_active DESC
      LIMIT ?
    `).all(limit);

    return threadRows.map(row => {
      const messages = this.db.prepare(`
        SELECT id, timestamp, raw_content, metadata
        FROM moments
        WHERE source = 'conversation'
          AND json_extract(metadata, '$.conversation_name') = ?
        ORDER BY timestamp ASC
      `).all(row.title).map(m => ({
        ...m,
        metadata: JSON.parse(m.metadata || '{}'),
      }));

      return {
        title: row.title,
        messageCount: row.total_messages,
        lastActive: row.last_active,
        firstActive: row.first_active,
        messages,
      };
    });
  }

  /**
   * Apply a categorization to every moment in a thread.
   * Only touches moments that haven't been manually set (or that were null).
   */
  applyThreadCategorization(conversationName, { topic, category, tone, summary }) {
    const result = this.db.prepare(`
      UPDATE moments
      SET topic = ?, category = ?, tone = ?, summary = ?
      WHERE source = 'conversation'
        AND json_extract(metadata, '$.conversation_name') = ?
    `).run(
      topic || null,
      category || null,
      tone || null,
      summary || null,
      conversationName,
    );
    return result.changes;
  }

  /**
   * Undo the damage from a prior failed run. Any thread where every moment
   * has category='other', no topic, no summary, no tone is almost certainly
   * the result of an error fallback (not a legitimate 'other' classification
   * — the LLM would have produced at least a summary). Reset them to null
   * so they get another shot.
   */
  resetLikelyFailedCategorizations() {
    const result = this.db.prepare(`
      UPDATE moments
      SET topic = NULL, category = NULL, tone = NULL, summary = NULL
      WHERE source = 'conversation'
        AND category = 'other'
        AND (topic IS NULL OR topic = '')
        AND (summary IS NULL OR summary = '')
        AND (tone IS NULL OR tone = '')
    `).run();
    return result.changes;
  }

  /**
   * Wipe all thread categorizations so they get re-read with the current
   * prompt. Use this when the prompt changes significantly and you want
   * existing data regenerated rather than waiting for new ingestion.
   */
  resetAllThreadCategorizations() {
    const result = this.db.prepare(`
      UPDATE moments
      SET topic = NULL, category = NULL, tone = NULL, summary = NULL
      WHERE source = 'conversation'
    `).run();
    return result.changes;
  }

  /**
   * Count of threads that still need categorization (for progress UI).
   */
  getUncategorizedThreadStats() {
    const pending = this.db.prepare(`
      SELECT COUNT(DISTINCT json_extract(metadata, '$.conversation_name')) as c
      FROM moments
      WHERE source = 'conversation'
        AND json_extract(metadata, '$.conversation_name') IS NOT NULL
        AND (category IS NULL OR category = '')
    `).get().c;
    const total = this.db.prepare(`
      SELECT COUNT(DISTINCT json_extract(metadata, '$.conversation_name')) as c
      FROM moments
      WHERE source = 'conversation'
        AND json_extract(metadata, '$.conversation_name') IS NOT NULL
    `).get().c;
    return { pending, total, done: total - pending };
  }

  // --- Entities ---

  getEntities(type) {
    let query = 'SELECT * FROM entities';
    const params = [];
    if (type) {
      query += ' WHERE type = ?';
      params.push(type);
    }
    query += ' ORDER BY mention_count DESC';
    const { normalized } = this.getUserIdentity();
    return this.db.prepare(query).all(...params)
      .filter(r => !(r.type === 'person' && normalized.has(this._normalizeName(r.name))))
      .map(r => ({
      ...r,
      sentiment_trajectory: JSON.parse(r.sentiment_trajectory || '[]'),
      metadata: JSON.parse(r.metadata || '{}'),
    }));
  }

  /**
   * Normalize a name for matching: lowercase, strip accents, collapse
   * whitespace, drop surrounding punctuation. So "Ahmed  Behairy.",
   * "AHMED BEHAIRY", and "Áhmed Behairy" all normalize to "ahmed behairy".
   */
  _normalizeName(s) {
    if (s == null) return '';
    return String(s)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')        // strip accents
      .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')   // strip punctuation (keep apostrophe, hyphen)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * The user's own identity — name + aliases. The source of truth for
   * "who is the narrator of these conversations?". Without this, the user's
   * own name leaks into entities, topics, and the People landscape.
   *
   * Returns both the raw aliases and a pre-normalized set for fast matching.
   */
  getUserIdentity() {
    const name = (this.getConfigValue('user_name') || '').trim();
    const aliasesRaw = (this.getConfigValue('user_aliases') || '').trim();
    if (!name) return { name: null, aliases: [], normalized: new Set() };
    const aliases = new Set([name]);
    aliasesRaw.split(',').map(s => s.trim()).filter(Boolean).forEach(a => aliases.add(a));
    // Also add name tokens as aliases so "Ahmed Behairy" matches "Ahmed" alone
    name.split(/\s+/).filter(t => t.length >= 3).forEach(t => aliases.add(t));
    const normalized = new Set(
      Array.from(aliases).map(a => this._normalizeName(a)).filter(Boolean)
    );
    return { name, aliases: Array.from(aliases), normalized };
  }

  isUserAlias(candidate) {
    if (!candidate) return false;
    const { normalized } = this.getUserIdentity();
    if (normalized.size === 0) return false;
    return normalized.has(this._normalizeName(candidate));
  }

  /**
   * Purge the user's own name from places it shouldn't be. Called after
   * the user sets or changes their identity in Settings.
   *
   * Removes entity rows matching any user alias, and nulls out
   * topic/category/tone/summary on any thread whose topic was the user
   * (so it gets re-read properly as personal/introspective content).
   */
  /**
   * Delete any person entities whose "name" is an email address or handle.
   * These are identifiers, not names — they shouldn't appear in People tiles.
   * Called once on startup to clean up historical data; `upsertEntity` blocks
   * new ones from being inserted.
   */
  purgeEmailPersonEntities() {
    const result = this.db.prepare(
      `DELETE FROM entities WHERE type = 'person' AND name LIKE '%@%'`
    ).run();
    return result.changes;
  }

  purgeUserAsEntity() {
    const { normalized } = this.getUserIdentity();
    if (normalized.size === 0) return { removedEntities: 0, resetThreads: 0 };

    // JS-side normalized matching — tolerant of casing, whitespace, accents,
    // punctuation. SQL LOWER() alone misses "Ahmed Behairy." vs "Ahmed Behairy".
    const personRows = this.db.prepare(`SELECT id, name FROM entities WHERE type = 'person'`).all();
    const idsToDelete = personRows
      .filter(r => normalized.has(this._normalizeName(r.name)))
      .map(r => r.id);

    let removedEntities = 0;
    if (idsToDelete.length > 0) {
      const stmt = this.db.prepare(`DELETE FROM entities WHERE id = ?`);
      const tx = this.db.transaction(ids => ids.forEach(id => stmt.run(id)));
      tx(idsToDelete);
      removedEntities = idsToDelete.length;
    }

    // Any thread whose topic was the user's name gets its landscape fields
    // wiped, so the next categorization pass re-classifies it correctly
    // (almost certainly as 'mind' — self-reflection).
    const topicRows = this.db.prepare(`
      SELECT DISTINCT topic FROM moments
      WHERE source = 'conversation' AND topic IS NOT NULL AND topic != ''
    `).all();
    const topicsToReset = topicRows
      .map(r => r.topic)
      .filter(t => normalized.has(this._normalizeName(t)));

    let resetThreads = 0;
    if (topicsToReset.length > 0) {
      const stmt = this.db.prepare(`
        UPDATE moments SET topic = NULL, category = NULL, tone = NULL, summary = NULL
        WHERE source = 'conversation' AND topic = ?
      `);
      const tx = this.db.transaction(topics => {
        for (const t of topics) resetThreads += stmt.run(t).changes;
      });
      tx(topicsToReset);
    }

    return { removedEntities, resetThreads };
  }

  upsertEntity(entity) {
    // Never store the user as a person entity
    if (entity.type === 'person' && this.isUserAlias(entity.name)) {
      return null;
    }
    // Emails and handles are identifiers, not person names. They belong on a
    // person (as strong keys for identity resolution, when we get there) —
    // never as standalone person entities that pollute the People view.
    if (entity.type === 'person' && /@/.test(entity.name || '')) {
      return null;
    }
    const existing = this.db.prepare('SELECT * FROM entities WHERE name = ? AND type = ?')
      .get(entity.name, entity.type);

    if (existing) {
      const trajectory = JSON.parse(existing.sentiment_trajectory || '[]');
      if (entity.sentiment !== undefined) {
        trajectory.push({ date: new Date().toISOString(), sentiment: entity.sentiment });
      }
      this.db.prepare(`
        UPDATE entities SET
          mention_count = mention_count + ?,
          last_seen = ?,
          sentiment_trajectory = ?
        WHERE id = ?
      `).run(
        entity.mention_count || 1,
        entity.last_seen || new Date().toISOString(),
        JSON.stringify(trajectory),
        existing.id
      );
      return existing.id;
    } else {
      const trajectory = entity.sentiment !== undefined
        ? [{ date: new Date().toISOString(), sentiment: entity.sentiment }]
        : [];
      const result = this.db.prepare(`
        INSERT INTO entities (name, type, first_seen, last_seen, mention_count, sentiment_trajectory)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        entity.name,
        entity.type,
        entity.first_seen || new Date().toISOString(),
        entity.last_seen || new Date().toISOString(),
        entity.mention_count || 1,
        JSON.stringify(trajectory)
      );
      return result.lastInsertRowid;
    }
  }

  getEntityDetail(entityId) {
    const entity = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(entityId);
    if (!entity) return null;

    entity.sentiment_trajectory = JSON.parse(entity.sentiment_trajectory || '[]');
    entity.metadata = JSON.parse(entity.metadata || '{}');

    const relatedMoments = this.db.prepare(`
      SELECT * FROM moments
      WHERE raw_content LIKE ?
      ORDER BY timestamp DESC LIMIT 50
    `).all(`%${entity.name}%`).map(r => ({ ...r, metadata: JSON.parse(r.metadata || '{}') }));

    const relatedEmotions = this.db.prepare(`
      SELECT e.* FROM emotions e
      JOIN moments m ON e.moment_id = m.id
      WHERE m.raw_content LIKE ?
      ORDER BY e.timestamp DESC
    `).all(`%${entity.name}%`);

    return { ...entity, moments: relatedMoments, emotions: relatedEmotions };
  }

  // --- Patterns ---

  getPatterns() {
    return this.db.prepare('SELECT * FROM patterns WHERE active = 1 ORDER BY confidence DESC').all()
      .map(r => ({ ...r, evidence: JSON.parse(r.evidence || '[]') }));
  }

  insertPattern(pattern) {
    const existing = this.db.prepare('SELECT * FROM patterns WHERE description = ?')
      .get(pattern.description);

    if (existing) {
      const evidence = JSON.parse(existing.evidence || '[]');
      if (pattern.evidence) evidence.push(...pattern.evidence);
      this.db.prepare(`
        UPDATE patterns SET confidence = ?, evidence = ?, last_updated = datetime('now')
        WHERE id = ?
      `).run(
        Math.max(existing.confidence, pattern.confidence || 0.5),
        JSON.stringify(evidence),
        existing.id
      );
      return existing.id;
    }

    const result = this.db.prepare(`
      INSERT INTO patterns (type, description, confidence, evidence)
      VALUES (?, ?, ?, ?)
    `).run(
      pattern.type,
      pattern.description,
      pattern.confidence || 0.5,
      JSON.stringify(pattern.evidence || [])
    );
    return result.lastInsertRowid;
  }

  // --- Emotions ---

  insertEmotion(emotion) {
    const result = this.db.prepare(`
      INSERT INTO emotions (moment_id, type, intensity, valence, trigger, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      emotion.moment_id || null,
      emotion.type,
      emotion.intensity || 0.5,
      emotion.valence || 'neutral',
      emotion.trigger || null,
      emotion.timestamp || new Date().toISOString()
    );
    return result.lastInsertRowid;
  }

  getEmotions(days = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return this.db.prepare(`
      SELECT * FROM emotions WHERE timestamp >= ? ORDER BY timestamp DESC
    `).all(since.toISOString());
  }

  // --- Decisions ---

  insertDecision(decision) {
    const existing = this.db.prepare('SELECT * FROM decisions WHERE topic = ?')
      .get(decision.topic);

    if (existing) {
      const momentIds = JSON.parse(existing.moment_ids || '[]');
      if (decision.moment_ids) momentIds.push(...decision.moment_ids);
      this.db.prepare(`
        UPDATE decisions SET
          status = ?,
          revisit_count = revisit_count + 1,
          last_seen = datetime('now'),
          moment_ids = ?
        WHERE id = ?
      `).run(decision.status || existing.status, JSON.stringify(momentIds), existing.id);
      return existing.id;
    }

    const result = this.db.prepare(`
      INSERT INTO decisions (topic, status, moment_ids)
      VALUES (?, ?, ?)
    `).run(
      decision.topic,
      decision.status || 'pending',
      JSON.stringify(decision.moment_ids || [])
    );
    return result.lastInsertRowid;
  }

  getOpenDecisions() {
    return this.db.prepare(`
      SELECT * FROM decisions WHERE status IN ('pending', 'revisited')
      ORDER BY revisit_count DESC
    `).all().map(r => ({ ...r, moment_ids: JSON.parse(r.moment_ids || '[]') }));
  }

  // --- Scores ---

  getLatestScores() {
    return this.db.prepare('SELECT * FROM scores ORDER BY date DESC LIMIT 1').get() || null;
  }

  getScoreHistory(days = 30) {
    return this.db.prepare(`
      SELECT * FROM scores ORDER BY date DESC LIMIT ?
    `).all(days);
  }

  saveScores(scores) {
    const today = new Date().toISOString().split('T')[0];
    this.db.prepare(`
      INSERT OR REPLACE INTO scores (date, overall, emotional, mental, relational, routine, professional)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      today,
      scores.overall,
      scores.emotional,
      scores.mental,
      scores.relational,
      scores.routine,
      scores.professional
    );
  }

  // --- Landscape ---

  /**
   * Build the Life Landscape for a time window.
   * Returns tiles (topics) with counts, change %, category, tone, and a sparkline.
   *
   * @param {Object} opts
   * @param {string} opts.start ISO timestamp (inclusive)
   * @param {string} opts.end ISO timestamp (exclusive)
   * @param {string} [opts.group='topic']  'topic' | 'category' | 'people'
   * @returns {{ period: {start,end}, tiles: Array }}
   */
  getLandscape({ start, end, group = 'topic' }) {
    const rangeMs = new Date(end).getTime() - new Date(start).getTime();
    const prevStart = new Date(new Date(start).getTime() - rangeMs).toISOString();

    // Helper: split range into 12 equal buckets for sparkline
    const bucketCount = 12;
    const bucketMs = rangeMs / bucketCount;

    if (group === 'category') {
      const rows = this.db.prepare(`
        SELECT COALESCE(category, 'other') as key, 'category' as kind,
               COUNT(*) as count
        FROM moments
        WHERE source = 'conversation' AND timestamp >= ? AND timestamp < ?
          AND category IS NOT NULL
        GROUP BY key
        ORDER BY count DESC
      `).all(start, end);

      const total = rows.reduce((s, r) => s + r.count, 0) || 1;
      return {
        period: { start, end, group },
        total,
        tiles: rows.map(r => this._enrichTile(r, { start, end, prevStart, bucketMs, total, group })),
      };
    }

    if (group === 'people') {
      const { normalized } = this.getUserIdentity();
      const rows = this.db.prepare(`
        SELECT name as key, type, mention_count as count, metadata
        FROM entities
        WHERE type = 'person'
        ORDER BY mention_count DESC
        LIMIT 40
      `).all()
        .filter(r => !normalized.has(this._normalizeName(r.key)))
        .slice(0, 20);
      const total = rows.reduce((s, r) => s + r.count, 0) || 1;
      return {
        period: { start, end, group },
        total,
        tiles: rows.map(r => ({
          key: r.key,
          label: r.key,
          category: 'peers',
          count: r.count,
          pctOfTotal: r.count / total,
          changePct: 0,
          tone: null,
          summary: null,
          spark: [],
        })),
      };
    }

    // Default: group by topic. Same topic across batches may end up with
    // slightly different categories/tones — collapse to the most common.
    const rows = this.db.prepare(`
      WITH topic_totals AS (
        SELECT topic, COUNT(*) as count
        FROM moments
        WHERE source = 'conversation' AND timestamp >= ? AND timestamp < ?
          AND topic IS NOT NULL AND topic != '' AND LOWER(topic) NOT IN ('unclear', 'other', 'unknown')
        GROUP BY topic
      ),
      topic_category AS (
        SELECT topic,
               category,
               ROW_NUMBER() OVER (PARTITION BY topic ORDER BY COUNT(*) DESC) as rn
        FROM moments
        WHERE source = 'conversation' AND timestamp >= ? AND timestamp < ?
          AND topic IS NOT NULL AND category IS NOT NULL
        GROUP BY topic, category
      ),
      topic_latest AS (
        SELECT topic, MAX(tone) as tone, MAX(summary) as summary
        FROM moments
        WHERE source = 'conversation' AND timestamp >= ? AND timestamp < ?
          AND topic IS NOT NULL
        GROUP BY topic
      )
      SELECT t.topic as key,
             COALESCE(c.category, 'other') as category,
             t.count,
             l.tone,
             l.summary
      FROM topic_totals t
      LEFT JOIN topic_category c ON c.topic = t.topic AND c.rn = 1
      LEFT JOIN topic_latest l ON l.topic = t.topic
      ORDER BY t.count DESC
      LIMIT 20
    `).all(start, end, start, end, start, end);

    const total = rows.reduce((s, r) => s + r.count, 0) || 1;
    return {
      period: { start, end, group },
      total,
      tiles: rows.map(r => this._enrichTile(r, { start, end, prevStart, bucketMs, total, group })),
    };
  }

  _enrichTile(row, { start, end, prevStart, bucketMs, total, group }) {
    const key = row.key;
    const isCategory = group === 'category';

    // Previous period count (same length, immediately prior)
    let prevCount = 0;
    if (isCategory) {
      prevCount = this.db.prepare(`
        SELECT COUNT(*) as c FROM moments
        WHERE source = 'conversation' AND timestamp >= ? AND timestamp < ?
          AND COALESCE(category, 'other') = ?
      `).get(prevStart, start, key).c;
    } else {
      prevCount = this.db.prepare(`
        SELECT COUNT(*) as c FROM moments
        WHERE source = 'conversation' AND timestamp >= ? AND timestamp < ?
          AND topic = ?
      `).get(prevStart, start, key).c;
    }

    // Cap change at ±300% so a tile with 1 moment last period and 80 this
    // period doesn't render as "▲ 7900%" which carries no useful info and
    // distracts from the real pattern. If prev was zero, treat as "new".
    const rawChange = prevCount === 0
      ? (row.count > 0 ? 1 : 0)
      : (row.count - prevCount) / prevCount;
    const changePct = Math.max(-3, Math.min(3, rawChange));
    const isNew = prevCount === 0 && row.count > 0;

    // Sparkline: count per bucket across the range
    const spark = new Array(12).fill(0);
    const startMs = new Date(start).getTime();
    const rows = isCategory
      ? this.db.prepare(`
          SELECT timestamp FROM moments
          WHERE source = 'conversation' AND timestamp >= ? AND timestamp < ?
            AND COALESCE(category, 'other') = ?
        `).all(start, end, key)
      : this.db.prepare(`
          SELECT timestamp FROM moments
          WHERE source = 'conversation' AND timestamp >= ? AND timestamp < ?
            AND topic = ?
        `).all(start, end, key);

    for (const r of rows) {
      const idx = Math.min(11, Math.floor((new Date(r.timestamp).getTime() - startMs) / bucketMs));
      if (idx >= 0 && idx < 12) spark[idx]++;
    }

    // For a category tile, the useful signal is "what specifically in this
    // domain?" — so we attach the top topics inside it and the dominant
    // tone across them. This is the content of the tile; the category name
    // alone is just a header.
    let subTopics = null;
    let tone = row.tone || null;
    let summary = row.summary || null;
    if (isCategory) {
      subTopics = this.db.prepare(`
        SELECT topic, COUNT(*) as count
        FROM moments
        WHERE source = 'conversation' AND timestamp >= ? AND timestamp < ?
          AND COALESCE(category, 'other') = ?
          AND topic IS NOT NULL AND topic != ''
        GROUP BY topic
        ORDER BY count DESC
        LIMIT 6
      `).all(start, end, key).map(t => ({
        topic: t.topic,
        weight: t.count / row.count,
      }));

      // Dominant tone across this domain (mode)
      const toneRow = this.db.prepare(`
        SELECT tone, COUNT(*) as c FROM moments
        WHERE source = 'conversation' AND timestamp >= ? AND timestamp < ?
          AND COALESCE(category, 'other') = ?
          AND tone IS NOT NULL AND tone != ''
        GROUP BY tone
        ORDER BY c DESC
        LIMIT 1
      `).get(start, end, key);
      tone = toneRow?.tone || null;
      summary = null; // Category tiles show subTopics, not a summary line
    }

    return {
      key,
      label: key,
      category: isCategory ? key : row.category,
      count: row.count,
      pctOfTotal: row.count / total,
      changePct,
      tone,
      summary,
      subTopics,
      isNew,
      spark,
    };
  }

  /**
   * Get the stories (conversation threads) behind a tile.
   *
   * Returns one row per unique conversation_name within the window, with
   * the thread's summary, tone, message count, and last-active timestamp.
   *
   * This is the fix for the "repetition" problem: a 50-message thread
   * showing up as 50 separate stories. A thread IS a story.
   */
  getTileDetail({ key, group = 'topic', start, end }) {
    const isCategory = group === 'category';
    const whereClause = isCategory
      ? "COALESCE(category, 'other') = ?"
      : 'topic = ?';

    const stories = this.db.prepare(`
      SELECT json_extract(metadata, '$.conversation_name') as conversation_name,
             MAX(timestamp) as last_active,
             MIN(timestamp) as first_active,
             COUNT(*) as message_count,
             MAX(summary) as summary,
             MAX(tone) as tone
      FROM moments
      WHERE source = 'conversation' AND timestamp >= ? AND timestamp < ?
        AND ${whereClause}
        AND json_extract(metadata, '$.conversation_name') IS NOT NULL
      GROUP BY conversation_name
      ORDER BY last_active DESC
      LIMIT 8
    `).all(start, end, key);

    const { normalized: userNormalized } = this.getUserIdentity();
    const people = this.db.prepare(`
      SELECT e.name, COUNT(*) as mentions
      FROM entities e
      WHERE e.type = 'person'
      ORDER BY mentions DESC
      LIMIT 20
    `).all()
      .filter(r => !userNormalized.has(this._normalizeName(r.name)))
      .slice(0, 8);

    const total = this.db.prepare(`
      SELECT COUNT(*) as c FROM moments
      WHERE source = 'conversation' AND timestamp >= ? AND timestamp < ?
        AND ${whereClause}
    `).get(start, end, key).c;

    const threadCount = this.db.prepare(`
      SELECT COUNT(DISTINCT json_extract(metadata, '$.conversation_name')) as c
      FROM moments
      WHERE source = 'conversation' AND timestamp >= ? AND timestamp < ?
        AND ${whereClause}
    `).get(start, end, key).c;

    return {
      stories: stories.map(s => ({
        when: s.last_active,
        what: s.conversation_name || 'Thread',
        excerpt: s.summary || `${s.message_count} messages`,
        tone: s.tone,
        messageCount: s.message_count,
      })),
      people,
      totalMentions: total,
      threadCount,
    };
  }

  /**
   * Returns the top topics seen so far, counted by distinct THREADS (not
   * messages) so long threads don't dominate. Used to give the LLM context
   * so it reuses exact topic names across threads.
   */
  getKnownTopics(limit = 40) {
    return this.db.prepare(`
      SELECT topic,
             category,
             COUNT(DISTINCT json_extract(metadata, '$.conversation_name')) as count
      FROM moments
      WHERE topic IS NOT NULL AND topic != ''
      GROUP BY topic, category
      ORDER BY count DESC
      LIMIT ?
    `).all(limit);
  }

  getRecategorizationStats() {
    const total = this.db.prepare(
      "SELECT COUNT(*) as c FROM moments WHERE source = 'conversation'"
    ).get().c;
    const uncategorized = this.db.prepare(
      "SELECT COUNT(*) as c FROM moments WHERE source = 'conversation' AND (category IS NULL OR category = '')"
    ).get().c;
    return { total, uncategorized, categorized: total - uncategorized };
  }

  // --- Stats ---

  getStats() {
    const momentCount = this.db.prepare('SELECT COUNT(*) as count FROM moments').get().count;
    const entityCount = this.db.prepare('SELECT COUNT(*) as count FROM entities').get().count;
    const patternCount = this.db.prepare('SELECT COUNT(*) as count FROM patterns WHERE active = 1').get().count;
    const emotionCount = this.db.prepare('SELECT COUNT(*) as count FROM emotions').get().count;
    const messageCount = this.db.prepare("SELECT COUNT(*) as count FROM moments WHERE source = 'conversation'").get().count;
    const threadCount = this.db.prepare(`
      SELECT COUNT(DISTINCT json_extract(metadata, '$.conversation_name')) as count
      FROM moments WHERE source = 'conversation'
    `).get().count;
    const photoCount = this.db.prepare("SELECT COUNT(*) as count FROM moments WHERE source = 'photo'").get().count;
    const calendarCount = this.db.prepare("SELECT COUNT(*) as count FROM moments WHERE source = 'calendar'").get().count;

    return { momentCount, entityCount, patternCount, emotionCount, messageCount, threadCount, photoCount, calendarCount };
  }

  // --- Insights ---

  getTopInsights() {
    const insights = [];

    const topDecisions = this.db.prepare(`
      SELECT * FROM decisions WHERE status IN ('pending', 'revisited')
      ORDER BY revisit_count DESC LIMIT 3
    `).all();

    for (const d of topDecisions) {
      if (d.revisit_count >= 2) {
        insights.push({
          type: 'decision_loop',
          text: `You've revisited "${d.topic}" ${d.revisit_count} times — this might need a decisive action.`,
          severity: d.revisit_count >= 4 ? 'high' : 'medium',
        });
      }
    }

    const recentEmotions = this.getEmotions(7);
    const negCount = recentEmotions.filter(e => e.valence === 'negative').length;
    const posCount = recentEmotions.filter(e => e.valence === 'positive').length;
    const total = negCount + posCount;

    if (total > 0 && negCount / total > 0.6) {
      insights.push({
        type: 'emotional_trend',
        text: `${Math.round(negCount / total * 100)}% of your recent emotions have been negative — consider what's weighing on you.`,
        severity: 'high',
      });
    } else if (total > 0 && posCount / total > 0.7) {
      insights.push({
        type: 'emotional_trend',
        text: `${Math.round(posCount / total * 100)}% of your recent emotions have been positive — you're in a good flow.`,
        severity: 'low',
      });
    }

    const patterns = this.getPatterns();
    for (const p of patterns.slice(0, 2)) {
      insights.push({
        type: 'pattern',
        text: p.description,
        severity: p.confidence > 0.7 ? 'high' : 'medium',
      });
    }

    return insights.slice(0, 5);
  }

  // --- Data Management ---

  deleteAllData() {
    this.db.exec('DELETE FROM emotions');
    this.db.exec('DELETE FROM decisions');
    this.db.exec('DELETE FROM patterns');
    this.db.exec('DELETE FROM entities');
    this.db.exec('DELETE FROM scores');
    this.db.exec('DELETE FROM moments');
  }

  exportAll() {
    return {
      moments: this.db.prepare('SELECT * FROM moments').all(),
      entities: this.db.prepare('SELECT * FROM entities').all(),
      patterns: this.db.prepare('SELECT * FROM patterns').all(),
      emotions: this.db.prepare('SELECT * FROM emotions').all(),
      decisions: this.db.prepare('SELECT * FROM decisions').all(),
      scores: this.db.prepare('SELECT * FROM scores').all(),
      config: this.getConfig(),
      exportedAt: new Date().toISOString(),
    };
  }
}

module.exports = Database;
