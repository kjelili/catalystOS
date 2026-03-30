// ─── Domain Models ───
// Each model adds domain-specific queries on top of BaseModel CRUD.

import BaseModel from "./BaseModel.js";
import bcrypt from "bcryptjs";
import config from "../config/index.js";

// ═══ USER ═══
export class UserModel extends BaseModel {
  constructor() { super("users"); }

  async findByEmail(email) {
    return await this.findOne("email = ?", [email]);
  }

  async createUser({ name, email, password }) {
    const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
    return await this.create({ name, email, password: hash });
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

  async findByUser(userId) {
    return await this.findOne("user_id = ?", [userId]);
  }

  async upsert(userId, data) {
    const existing = await this.findByUser(userId);
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
    if (existing) return await this.update(existing.id, row);
    return await this.create(row);
  }
}

// ═══ CAMPAIGN ═══
export class CampaignModel extends BaseModel {
  constructor() { super("campaigns"); }

  async findByUserWithEngagement(userId) {
    return await this.db.all(`
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
    `, [userId]);
  }

  async pauseAllScheduled(userId) {
    return await this.db.run(
      `UPDATE campaigns SET status = 'paused', updated_at = ? WHERE user_id = ? AND status = 'scheduled'`,
      [new Date().toISOString(), userId]
    );
  }

  async resumeAllPaused(userId) {
    return await this.db.run(
      `UPDATE campaigns SET status = 'scheduled', updated_at = ? WHERE user_id = ? AND status = 'paused'`,
      [new Date().toISOString(), userId]
    );
  }

  async getStats(userId) {
    return await this.db.get(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'live' THEN 1 ELSE 0 END) as live,
        SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts
      FROM campaigns WHERE user_id = ?
    `, [userId]);
  }
}

// ═══ VARIANT ═══
export class VariantModel extends BaseModel {
  constructor() { super("variants"); }

  async findByCampaign(campaignId) {
    return await this.findAll("campaign_id = ?", [campaignId]);
  }

  async approveAll(campaignId) {
    return await this.db.run(
      `UPDATE variants SET approved = 1, status = 'approved', created_at = created_at WHERE campaign_id = ?`
    , [campaignId]);
  }
}

// ═══ ENGAGEMENT ═══
export class EngagementModel extends BaseModel {
  constructor() { super("engagement"); }

  async recordMetrics(data) {
    return await this.create(data);
  }

  async getForCampaign(campaignId) {
    return await this.db.all(`
      SELECT platform, SUM(views) as views, SUM(likes) as likes,
        SUM(comments) as comments, SUM(shares) as shares, SUM(saves) as saves
      FROM engagement WHERE campaign_id = ?
      GROUP BY platform
    `, [campaignId]);
  }

  async getDashboardStats(userId) {
    return await this.db.get(`
      SELECT
        COALESCE(SUM(e.views), 0) as total_views,
        COALESCE(SUM(e.likes), 0) as total_likes,
        COALESCE(SUM(e.comments), 0) as total_comments,
        COALESCE(SUM(e.shares), 0) as total_shares,
        COALESCE(SUM(e.saves), 0) as total_saves
      FROM engagement e
      JOIN campaigns c ON c.id = e.campaign_id
      WHERE c.user_id = ?
    `, [userId]);
  }
}

// ═══ SIGNAL ═══
export class SignalModel extends BaseModel {
  constructor() { super("signals"); }

  async getActive(userId) {
    return await this.findAll("user_id = ? AND dismissed = 0", [userId], "created_at DESC");
  }

  async getActionable(userId) {
    return await this.findAll("user_id = ? AND dismissed = 0 AND actionable = 1", [userId], "count DESC");
  }
}

// ═══ BRIEF ═══
export class BriefModel extends BaseModel {
  constructor() { super("briefs"); }

  async getPending(userId) {
    return await this.findAll("user_id = ? AND status = 'pending'", [userId], "priority DESC, created_at DESC");
  }

  async getApproved(userId) {
    return await this.findAll("user_id = ? AND status = 'approved'", [userId], "created_at DESC");
  }

  async getRecordingQueue(userId) {
    return await this.findAll("user_id = ? AND status IN ('pending','approved')", [userId], "priority DESC, created_at DESC");
  }
}

// ═══ PATTERN (Cortex) ═══
export class PatternModel extends BaseModel {
  constructor() { super("patterns"); }

  async getHighConfidence(userId, threshold = 0.7) {
    return await this.findAll("user_id = ? AND confidence >= ?", [userId, threshold], "confidence DESC");
  }

  async getByCategory(userId, category) {
    return await this.findAll("user_id = ? AND category = ?", [userId, category], "confidence DESC");
  }
}

// ═══ API HEALTH ═══
export class ApiHealthModel extends BaseModel {
  constructor() { super("api_health"); }

  async getForUser(userId) {
    return await this.findAll("user_id = ?", [userId], "platform ASC");
  }

  async upsert(userId, platform, data) {
    const existing = await this.findOne("user_id = ? AND platform = ?", [userId, platform]);
    const row = { user_id: userId, platform, ...data };
    if (existing) return await this.update(existing.id, row);
    return await this.create(row);
  }

  async incrementCalls(userId, platform, count = 1) {
    await this.db.run(
      `UPDATE api_health SET calls_used = calls_used + ?, last_sync = ? WHERE user_id = ? AND platform = ?`,
      [count, new Date().toISOString(), userId, platform]
    );
  }

  async resetDailyCounts() {
    await this.db.run(`UPDATE api_health SET calls_used = 0`);
  }
}

// ═══ SETTINGS ═══
export class SettingsModel extends BaseModel {
  constructor() { super("settings"); }

  async getForUser(userId) {
    return await this.findOne("user_id = ?", [userId]);
  }

  async upsert(userId, data) {
    const existing = await this.getForUser(userId);
    const row = { user_id: userId, ...data };
    if (existing) return await this.update(existing.id, row);
    return await this.create(row);
  }
}

// ═══ AUDIT LOG ═══
export class AuditModel extends BaseModel {
  constructor() { super("audit_log"); }

  async log(userId, action, resource, resourceId = null, details = {}, ip = null) {
    return await this.create({
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
