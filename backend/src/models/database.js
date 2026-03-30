// ─── Database Layer ───
// SQLite via better-sqlite3 for zero-dependency local deployment.
// In production, swap to PostgreSQL by changing this single file.
// All queries use prepared statements to prevent SQL injection.

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import config from "../config/index.js";
import logger from "../utils/logger.js";

let db;

export function getDb() {
  if (db) return db;
  const dbPath = config.db.path;
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  db = new Database(dbPath, { verbose: config.isDev ? (msg) => logger.debug(msg) : undefined });

  // Performance pragmas
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  return db;
}

export function migrate() {
  const db = getDb();

  db.exec(`
    -- ═══ USERS ═══
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL UNIQUE,
      password    TEXT NOT NULL,
      plan        TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','pro','team','enterprise')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ═══ VOICE DNA ═══
    CREATE TABLE IF NOT EXISTS voice_dna (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      tone            TEXT NOT NULL DEFAULT 'Professional',
      emoji_usage     TEXT NOT NULL DEFAULT 'minimal',
      hashtag_style   TEXT NOT NULL DEFAULT 'niche',
      include_words   TEXT NOT NULL DEFAULT '',
      exclude_words   TEXT NOT NULL DEFAULT '',
      samples         TEXT NOT NULL DEFAULT '[]',
      trained         INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ═══ CAMPAIGNS ═══
    CREATE TABLE IF NOT EXISTS campaigns (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','live','paused','completed','failed')),
      platforms       TEXT NOT NULL DEFAULT '[]',
      master_title    TEXT NOT NULL DEFAULT '',
      master_summary  TEXT NOT NULL DEFAULT '',
      content_type    TEXT NOT NULL DEFAULT '',
      file_key        TEXT,
      scheduled_for   TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id);
    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

    -- ═══ VARIANTS ═══
    CREATE TABLE IF NOT EXISTS variants (
      id              TEXT PRIMARY KEY,
      campaign_id     TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform        TEXT NOT NULL,
      caption         TEXT NOT NULL DEFAULT '',
      edits           TEXT NOT NULL DEFAULT '[]',
      hook_style      TEXT NOT NULL DEFAULT 'A',
      aspect_ratio    TEXT NOT NULL DEFAULT '16:9',
      pacing          TEXT NOT NULL DEFAULT 'medium',
      estimated_reach INTEGER NOT NULL DEFAULT 0,
      approved        INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','approved','published','failed')),
      published_at    TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_variants_campaign ON variants(campaign_id);

    -- ═══ ENGAGEMENT ═══
    CREATE TABLE IF NOT EXISTS engagement (
      id              TEXT PRIMARY KEY,
      campaign_id     TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      variant_id      TEXT REFERENCES variants(id) ON DELETE SET NULL,
      platform        TEXT NOT NULL,
      views           INTEGER NOT NULL DEFAULT 0,
      likes           INTEGER NOT NULL DEFAULT 0,
      comments        INTEGER NOT NULL DEFAULT 0,
      shares          INTEGER NOT NULL DEFAULT 0,
      saves           INTEGER NOT NULL DEFAULT 0,
      recorded_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_engagement_campaign ON engagement(campaign_id);

    -- ═══ SIGNALS ═══
    CREATE TABLE IF NOT EXISTS signals (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      campaign_id     TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
      type            TEXT NOT NULL CHECK(type IN ('question','objection','praise','feature_request','complaint')),
      topic           TEXT NOT NULL,
      count           INTEGER NOT NULL DEFAULT 1,
      platforms       TEXT NOT NULL DEFAULT '[]',
      sentiment       REAL NOT NULL DEFAULT 0.5,
      actionable      INTEGER NOT NULL DEFAULT 1,
      dismissed       INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_signals_user ON signals(user_id);

    -- ═══ CONTENT BRIEFS ═══
    CREATE TABLE IF NOT EXISTS briefs (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      signal_id       TEXT REFERENCES signals(id) ON DELETE SET NULL,
      title           TEXT NOT NULL,
      script          TEXT NOT NULL,
      format          TEXT NOT NULL DEFAULT '',
      platform        TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','recorded','archived')),
      priority        TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_briefs_user ON briefs(user_id);

    -- ═══ CORTEX PATTERNS ═══
    CREATE TABLE IF NOT EXISTS patterns (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      insight         TEXT NOT NULL,
      confidence      REAL NOT NULL DEFAULT 0.5,
      category        TEXT NOT NULL CHECK(category IN ('format','timing','content','cadence','audience')),
      platform        TEXT NOT NULL DEFAULT 'all',
      data_points     INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_patterns_user ON patterns(user_id);

    -- ═══ API HEALTH ═══
    CREATE TABLE IF NOT EXISTS api_health (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform        TEXT NOT NULL,
      connected       INTEGER NOT NULL DEFAULT 0,
      calls_used      INTEGER NOT NULL DEFAULT 0,
      calls_max       INTEGER NOT NULL DEFAULT 100,
      status          TEXT NOT NULL DEFAULT 'disconnected',
      last_sync       TEXT,
      UNIQUE(user_id, platform)
    );

    -- ═══ SETTINGS ═══
    CREATE TABLE IF NOT EXISTS settings (
      id                    TEXT PRIMARY KEY,
      user_id               TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      sentiment_threshold   REAL NOT NULL DEFAULT 0.3,
      crisis_alert_enabled  INTEGER NOT NULL DEFAULT 1,
      alert_phone           TEXT DEFAULT '',
      timezone              TEXT NOT NULL DEFAULT 'UTC',
      updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ═══ AUDIT LOG ═══
    CREATE TABLE IF NOT EXISTS audit_log (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action      TEXT NOT NULL,
      resource    TEXT NOT NULL,
      resource_id TEXT,
      details     TEXT DEFAULT '{}',
      ip_address  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
  `);

  logger.info("Database migration complete");
}

export function close() {
  if (db) {
    db.close();
    db = null;
  }
}

export default { getDb, migrate, close };
