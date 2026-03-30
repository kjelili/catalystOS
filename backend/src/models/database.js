import Database from "better-sqlite3";
import { Pool } from "pg";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import config from "../config/index.js";
import logger from "../utils/logger.js";

let db;

function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

class SqliteAdapter {
  constructor(conn) {
    this.conn = conn;
    this.dialect = "sqlite";
  }
  async get(sql, params = []) { return this.conn.prepare(sql).get(...params) || null; }
  async all(sql, params = []) { return this.conn.prepare(sql).all(...params); }
  async run(sql, params = []) {
    const result = this.conn.prepare(sql).run(...params);
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  }
  async exec(sql) { this.conn.exec(sql); }
  async tableInfo(table) { return this.conn.prepare(`PRAGMA table_info(${table})`).all(); }
  async close() { this.conn.close(); }
}

class PostgresAdapter {
  constructor(pool) {
    this.pool = pool;
    this.dialect = "postgres";
  }
  async get(sql, params = []) {
    const r = await this.pool.query(toPgSql(sql), params);
    return r.rows[0] || null;
  }
  async all(sql, params = []) {
    const r = await this.pool.query(toPgSql(sql), params);
    return r.rows;
  }
  async run(sql, params = []) {
    const r = await this.pool.query(toPgSql(sql), params);
    return { changes: r.rowCount || 0 };
  }
  async exec(sql) {
    const chunks = sql.split(";").map((s) => s.trim()).filter(Boolean);
    for (const chunk of chunks) {
      await this.pool.query(chunk);
    }
  }
  async tableInfo(table) {
    const r = await this.pool.query(
      `SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
      [table]
    );
    return r.rows;
  }
  async close() { await this.pool.end(); }
}

export function getDb() {
  if (db) return db;

  if (config.db.url) {
    const pool = new Pool({
      connectionString: config.db.url,
      ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
    });
    db = new PostgresAdapter(pool);
    return db;
  }

  const dbPath = config.db.path;
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const conn = new Database(dbPath, { verbose: config.isDev ? (msg) => logger.debug(msg) : undefined });
  conn.pragma("journal_mode = WAL");
  conn.pragma("synchronous = NORMAL");
  conn.pragma("foreign_keys = ON");
  conn.pragma("busy_timeout = 5000");
  db = new SqliteAdapter(conn);
  return db;
}

function schemaSql(dialect) {
  const now = dialect === "postgres" ? "CURRENT_TIMESTAMP" : "datetime('now')";
  return `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      created_at TEXT NOT NULL DEFAULT (${now}),
      updated_at TEXT NOT NULL DEFAULT (${now})
    );
    CREATE TABLE IF NOT EXISTS voice_dna (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      tone TEXT NOT NULL DEFAULT 'Professional',
      emoji_usage TEXT NOT NULL DEFAULT 'minimal',
      hashtag_style TEXT NOT NULL DEFAULT 'niche',
      include_words TEXT NOT NULL DEFAULT '',
      exclude_words TEXT NOT NULL DEFAULT '',
      samples TEXT NOT NULL DEFAULT '[]',
      trained INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (${now}),
      updated_at TEXT NOT NULL DEFAULT (${now})
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      platforms TEXT NOT NULL DEFAULT '[]',
      master_title TEXT NOT NULL DEFAULT '',
      master_summary TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL DEFAULT '',
      file_key TEXT,
      scheduled_for TEXT,
      created_at TEXT NOT NULL DEFAULT (${now}),
      updated_at TEXT NOT NULL DEFAULT (${now})
    );
    CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id);
    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
    CREATE TABLE IF NOT EXISTS variants (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      edits TEXT NOT NULL DEFAULT '[]',
      hook_style TEXT NOT NULL DEFAULT 'A',
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      pacing TEXT NOT NULL DEFAULT 'medium',
      estimated_reach INTEGER NOT NULL DEFAULT 0,
      approved INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready',
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (${now})
    );
    CREATE INDEX IF NOT EXISTS idx_variants_campaign ON variants(campaign_id);
    CREATE TABLE IF NOT EXISTS engagement (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      variant_id TEXT REFERENCES variants(id) ON DELETE SET NULL,
      platform TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      saves INTEGER NOT NULL DEFAULT 0,
      recorded_at TEXT NOT NULL DEFAULT (${now})
    );
    CREATE INDEX IF NOT EXISTS idx_engagement_campaign ON engagement(campaign_id);
    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      topic TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      platforms TEXT NOT NULL DEFAULT '[]',
      sentiment REAL NOT NULL DEFAULT 0.5,
      actionable INTEGER NOT NULL DEFAULT 1,
      dismissed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (${now}),
      updated_at TEXT NOT NULL DEFAULT (${now})
    );
    CREATE INDEX IF NOT EXISTS idx_signals_user ON signals(user_id);
    CREATE TABLE IF NOT EXISTS briefs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      signal_id TEXT REFERENCES signals(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      script TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'medium',
      created_at TEXT NOT NULL DEFAULT (${now}),
      updated_at TEXT NOT NULL DEFAULT (${now})
    );
    CREATE INDEX IF NOT EXISTS idx_briefs_user ON briefs(user_id);
    CREATE TABLE IF NOT EXISTS patterns (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      insight TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      category TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'all',
      data_points INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (${now}),
      updated_at TEXT NOT NULL DEFAULT (${now})
    );
    CREATE INDEX IF NOT EXISTS idx_patterns_user ON patterns(user_id);
    CREATE TABLE IF NOT EXISTS api_health (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      connected INTEGER NOT NULL DEFAULT 0,
      calls_used INTEGER NOT NULL DEFAULT 0,
      calls_max INTEGER NOT NULL DEFAULT 100,
      status TEXT NOT NULL DEFAULT 'disconnected',
      last_sync TEXT,
      UNIQUE(user_id, platform)
    );
    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      sentiment_threshold REAL NOT NULL DEFAULT 0.3,
      crisis_alert_enabled INTEGER NOT NULL DEFAULT 1,
      alert_phone TEXT DEFAULT '',
      timezone TEXT NOT NULL DEFAULT 'UTC',
      updated_at TEXT NOT NULL DEFAULT (${now})
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      resource_id TEXT,
      details TEXT DEFAULT '{}',
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (${now})
    );
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
  `;
}

export async function migrate() {
  const conn = getDb();
  await conn.exec(schemaSql(conn.dialect));
  logger.info(`Database migration complete [${conn.dialect}]`);
}

export async function close() {
  if (db) {
    await db.close();
    db = null;
  }
}

export default { getDb, migrate, close };
