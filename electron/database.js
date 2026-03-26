const BetterSqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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
    const stmt = this.db.prepare(`
      INSERT INTO moments (timestamp, source, raw_content, metadata)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(
      moment.timestamp,
      moment.source,
      moment.raw_content,
      JSON.stringify(moment.metadata || {})
    );
    return result.lastInsertRowid;
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

  markMomentProcessed(id) {
    this.db.prepare('UPDATE moments SET processed = 1 WHERE id = ?').run(id);
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
    return this.db.prepare(query).all(...params).map(r => ({
      ...r,
      sentiment_trajectory: JSON.parse(r.sentiment_trajectory || '[]'),
      metadata: JSON.parse(r.metadata || '{}'),
    }));
  }

  upsertEntity(entity) {
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
