// ─── Domain Models ───
// Each model adds domain-specific queries on top of BaseModel CRUD.

import BaseModel from "./BaseModel.js";
import bcrypt from "bcryptjs";
import config from "../config/index.js";

// ═══ USER ═══
export class UserModel extends BaseModel {
  constructor() { super("users"); }

  findByEmail(email) {
    return this.findOne("email = ?", [email]);
  }

  async createUser({ name, email, password }) {
    const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
    return this.create({ name, email, password: hash });
  }

  async verifyPassword(user, password) {
    return bcrypt.compare(password, user.password);
  }

  // Strip password from response
  safe(user) {
    if (!user) return null;
    const { password, ...safe } = user;
    return safe;
  }
}

// ═══ VOICE DNA ═══
export class VoiceDnaModel extends BaseModel {
  constructor() { super("voice_dna"); }

  findByUser(userId) {
    return this.findOne("user_id = ?", [userId]);
  }

  upsert(userId, data) {
    const existing = this.findByUser(userId);
    const row = {
      user_id: userId,
      tone: data.tone || "Professional",
      emoji_usage: data.emojiUsage || "minimal",
      hashtag_style: data.hashtagStyle || "niche",
      include_words: data.includeWords || "",
      exclude_words: data.excludeWords || "",
      samples: JSON.stringify(data.samples || []),
      trained: data.samples?.length > 0 ? 1 : 0,
    };
    if (existing) return this.update(existing.id, row);
    return this.create(row);
  }
}

// ═══ CAMPAIGN ═══
export class CampaignModel extends BaseModel {
  constructor() { super("campaigns"); }

  findByUserWithEngagement(userId) {
    return this.db.prepare(`
      SELECT c.*,
        COALESCE(SUM(e.views), 0) as total_views,
        COALESCE(SUM(e.likes), 0) as total_likes,
        COALESCE(SUM(e.comments), 0) as total_comments,
        COALESCE(SUM(e.shares), 0) as total_shares,
        COALESCE(SUM(e.saves), 0) as total_saves
      FROM campaigns c
      LEFT JOIN engagement e ON e.campaign_id = c.id
      WHERE c.user_id = ?
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `).all(userId);
  }

  pauseAllScheduled(userId) {
    return this.db.prepare(
      `UPDATE campaigns SET status = 'paused', updated_at = datetime('now') WHERE user_id = ? AND status = 'scheduled'`
    ).run(userId);
  }

  resumeAllPaused(userId) {
    return this.db.prepare(
      `UPDATE campaigns SET status = 'scheduled', updated_at = datetime('now') WHERE user_id = ? AND status = 'paused'`
    ).run(userId);
  }

  getStats(userId) {
    return this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'live' THEN 1 ELSE 0 END) as live,
        SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts
      FROM campaigns WHERE user_id = ?
    `).get(userId);
  }
}

// ═══ VARIANT ═══
export class VariantModel extends BaseModel {
  constructor() { super("variants"); }

  findByCampaign(campaignId) {
    return this.findAll("campaign_id = ?", [campaignId]);
  }

  approveAll(campaignId) {
    return this.db.prepare(
      `UPDATE variants SET approved = 1, status = 'approved', created_at = created_at WHERE campaign_id = ?`
    ).run(campaignId);
  }
}

// ═══ ENGAGEMENT ═══
export class EngagementModel extends BaseModel {
  constructor() { super("engagement"); }

  recordMetrics(data) {
    return this.create(data);
  }

  getForCampaign(campaignId) {
    return this.db.prepare(`
      SELECT platform, SUM(views) as views, SUM(likes) as likes,
        SUM(comments) as comments, SUM(shares) as shares, SUM(saves) as saves
      FROM engagement WHERE campaign_id = ?
      GROUP BY platform
    `).all(campaignId);
  }

  getDashboardStats(userId) {
    return this.db.prepare(`
      SELECT
        COALESCE(SUM(e.views), 0) as total_views,
        COALESCE(SUM(e.likes), 0) as total_likes,
        COALESCE(SUM(e.comments), 0) as total_comments,
        COALESCE(SUM(e.shares), 0) as total_shares,
        COALESCE(SUM(e.saves), 0) as total_saves
      FROM engagement e
      JOIN campaigns c ON c.id = e.campaign_id
      WHERE c.user_id = ?
    `).get(userId);
  }
}

// ═══ SIGNAL ═══
export class SignalModel extends BaseModel {
  constructor() { super("signals"); }

  getActive(userId) {
    return this.findAll("user_id = ? AND dismissed = 0", [userId], "created_at DESC");
  }

  getActionable(userId) {
    return this.findAll("user_id = ? AND dismissed = 0 AND actionable = 1", [userId], "count DESC");
  }
}

// ═══ BRIEF ═══
export class BriefModel extends BaseModel {
  constructor() { super("briefs"); }

  getPending(userId) {
    return this.findAll("user_id = ? AND status = 'pending'", [userId], "priority DESC, created_at DESC");
  }

  getApproved(userId) {
    return this.findAll("user_id = ? AND status = 'approved'", [userId], "created_at DESC");
  }

  getRecordingQueue(userId) {
    return this.findAll("user_id = ? AND status IN ('pending','approved')", [userId], "priority DESC, created_at DESC");
  }
}

// ═══ PATTERN (Cortex) ═══
export class PatternModel extends BaseModel {
  constructor() { super("patterns"); }

  getHighConfidence(userId, threshold = 0.7) {
    return this.findAll("user_id = ? AND confidence >= ?", [userId, threshold], "confidence DESC");
  }

  getByCategory(userId, category) {
    return this.findAll("user_id = ? AND category = ?", [userId, category], "confidence DESC");
  }
}

// ═══ API HEALTH ═══
export class ApiHealthModel extends BaseModel {
  constructor() { super("api_health"); }

  getForUser(userId) {
    return this.findAll("user_id = ?", [userId], "platform ASC");
  }

  upsert(userId, platform, data) {
    const existing = this.findOne("user_id = ? AND platform = ?", [userId, platform]);
    const row = { user_id: userId, platform, ...data };
    if (existing) return this.update(existing.id, row);
    return this.create(row);
  }

  incrementCalls(userId, platform, count = 1) {
    this.db.prepare(
      `UPDATE api_health SET calls_used = calls_used + ?, last_sync = datetime('now') WHERE user_id = ? AND platform = ?`
    ).run(count, userId, platform);
  }

  resetDailyCounts() {
    this.db.prepare(`UPDATE api_health SET calls_used = 0`).run();
  }
}

// ═══ SETTINGS ═══
export class SettingsModel extends BaseModel {
  constructor() { super("settings"); }

  getForUser(userId) {
    return this.findOne("user_id = ?", [userId]);
  }

  upsert(userId, data) {
    const existing = this.getForUser(userId);
    const row = { user_id: userId, ...data };
    if (existing) return this.update(existing.id, row);
    return this.create(row);
  }
}

// ═══ AUDIT LOG ═══
export class AuditModel extends BaseModel {
  constructor() { super("audit_log"); }

  log(userId, action, resource, resourceId = null, details = {}, ip = null) {
    return this.create({
      user_id: userId,
      action,
      resource,
      resource_id: resourceId,
      details: JSON.stringify(details),
      ip_address: ip,
    });
  }
}

// ─── Singleton instances ───
export const Users = new UserModel();
export const VoiceDna = new VoiceDnaModel();
export const Campaigns = new CampaignModel();
export const Variants = new VariantModel();
export const Engagement = new EngagementModel();
export const Signals = new SignalModel();
export const Briefs = new BriefModel();
export const Patterns = new PatternModel();
export const ApiHealth = new ApiHealthModel();
export const Settings = new SettingsModel();
export const Audit = new AuditModel();
