// ─── Cortex Service ───
// Intelligence layer: learns audience patterns over time, monitors content
// mix health, generates weekly performance digests and recommendations.

import { v4 as uuidv4 } from "uuid";
import { Patterns, Campaigns, Engagement, Signals, Briefs } from "../models/index.js";
import bus, { Events } from "./eventBus.js";
import logger from "../utils/logger.js";

class CortexService {
  // Get all intelligence data for dashboard
  async getIntelligence(userId) {
    const patterns = Patterns.getHighConfidence(userId, 0.5);
    const calendarHealth = this.analyzeContentMix(userId);
    const weeklyDigest = await this.generateWeeklyDigest(userId);

    return { patterns, calendarHealth, weeklyDigest };
  }

  // Analyze content mix balance
  analyzeContentMix(userId) {
    const campaigns = Campaigns.findByUser(userId, { limit: 20, orderBy: "created_at DESC" });
    const now = new Date();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const thisWeek = campaigns.filter((c) => c.created_at >= weekAgo);
    const categories = { promotional: 0, educational: 0, storytelling: 0 };

    for (const c of thisWeek) {
      const name = (c.name || "").toLowerCase();
      if (name.includes("launch") || name.includes("product") || name.includes("promo") || name.includes("sale")) {
        categories.promotional++;
      } else if (name.includes("how") || name.includes("tutorial") || name.includes("guide") || name.includes("tip")) {
        categories.educational++;
      } else {
        categories.storytelling++;
      }
    }

    return {
      ...categories,
      ideal: { promotional: 2, educational: 2, storytelling: 1 },
      isHealthy:
        categories.promotional <= 3 &&
        categories.educational >= 1 &&
        (categories.promotional + categories.educational + categories.storytelling) <= 7,
    };
  }

  getCalendarBalancePlan(userId) {
    const mix = this.analyzeContentMix(userId);
    const suggestions = [];

    if (mix.promotional > mix.ideal.promotional) {
      suggestions.push(
        `Promotional posts are high (${mix.promotional}). Shift one to next week and replace with educational content.`
      );
    }
    if (mix.educational < mix.ideal.educational) {
      suggestions.push(
        `Educational content is low (${mix.educational}). Add at least ${mix.ideal.educational - mix.educational} how-to or tutorial post(s).`
      );
    }
    if (mix.storytelling < mix.ideal.storytelling) {
      suggestions.push("Add one storytelling/customer narrative post to avoid audience fatigue.");
    }
    if (suggestions.length === 0) {
      suggestions.push("Calendar mix is healthy. Keep current cadence and review again in 7 days.");
    }

    return {
      current: {
        promotional: mix.promotional,
        educational: mix.educational,
        storytelling: mix.storytelling,
      },
      ideal: mix.ideal,
      isBalanced: mix.isHealthy,
      actions: suggestions,
    };
  }

  // Generate weekly performance digest
  async generateWeeklyDigest(userId) {
    const campaigns = Campaigns.findByUserWithEngagement(userId);
    const stats = Engagement.getDashboardStats(userId) || {};
    const signals = Signals.getActionable(userId);
    const pendingBriefs = Briefs.getPending(userId);

    // Find top performer
    const live = campaigns.filter((c) => c.status === "live" && c.total_views > 0);
    const topPerformer = live.sort((a, b) => b.total_views - a.total_views)[0]?.name || null;

    const totalReach = stats.total_views || 0;
    const totalEng = (stats.total_likes || 0) + (stats.total_comments || 0) + (stats.total_shares || 0);
    const avgEngagement = totalReach > 0 ? ((totalEng / totalReach) * 100).toFixed(1) : 0;

    // Generate recommendations
    const actions = [];

    // Signal-based recommendations
    const topSignal = signals.sort((a, b) => b.count - a.count)[0];
    if (topSignal) {
      actions.push(`Record a video answering "${topSignal.topic}" — ${topSignal.count} people asked`);
    }

    // Content mix recommendations
    const mix = this.analyzeContentMix(userId);
    if (mix.promotional > mix.ideal.promotional) {
      actions.push(`Schedule an educational post to balance ${mix.promotional} promotional posts this week`);
    }
    if (mix.educational < mix.ideal.educational) {
      actions.push("Your audience engages more with educational content — plan a how-to or tutorial");
    }

    // Pending briefs
    if (pendingBriefs.length > 0) {
      actions.push(`Review ${pendingBriefs.length} content briefs waiting in your queue`);
    }

    // Fill with default if empty
    if (actions.length === 0) {
      actions.push("You're on track — keep the current publishing cadence");
    }

    return {
      topPerformer,
      totalReach,
      avgEngagement: parseFloat(avgEngagement),
      totalCampaigns: campaigns.length,
      recommendedActions: actions.slice(0, 5),
    };
  }

  getPatternMemory(userId, windowDays = 30) {
    const patterns = Patterns.getHighConfidence(userId, 0.6);
    const campaigns = Campaigns.findByUserWithEngagement(userId);
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const recentCampaigns = campaigns.filter((c) => c.created_at >= cutoff);
    const totalViews = recentCampaigns.reduce((sum, c) => sum + (c.total_views || 0), 0);
    const totalEngagement = recentCampaigns.reduce(
      (sum, c) => sum + (c.total_likes || 0) + (c.total_comments || 0) + (c.total_shares || 0),
      0
    );

    const engagementRate = totalViews > 0 ? Number(((totalEngagement / totalViews) * 100).toFixed(2)) : 0;
    const topPatterns = patterns.slice(0, 3).map((p) => p.insight);

    return {
      windowDays,
      campaignCount: recentCampaigns.length,
      reach: totalViews,
      engagementRate,
      knownPatterns: patterns.length,
      topPatterns,
      memoryStrength: recentCampaigns.length >= 8 ? "strong" : recentCampaigns.length >= 4 ? "growing" : "early",
    };
  }

  // Learn a new pattern from data
  learnPattern(userId, insight, confidence, category, platform = "all", dataPoints = 1) {
    const existing = Patterns.findOne("user_id = ? AND insight = ?", [userId, insight]);
    if (existing) {
      const newConfidence = Math.min(1, (existing.confidence + confidence) / 2 + 0.05);
      const updated = Patterns.update(existing.id, {
        confidence: newConfidence,
        data_points: existing.data_points + dataPoints,
      });
      bus.publish(Events.PATTERN_LEARNED, { patternId: existing.id, confidence: newConfidence });
      return updated;
    }

    const pattern = Patterns.create({
      id: uuidv4(),
      user_id: userId,
      insight,
      confidence,
      category,
      platform,
      data_points: dataPoints,
    });

    bus.publish(Events.PATTERN_LEARNED, { patternId: pattern.id, confidence });
    logger.info(`Cortex: new pattern learned — "${insight}" (${(confidence * 100).toFixed(0)}%)`);
    return pattern;
  }

  // Run the full analysis pipeline (called by cron job)
  async runAnalysis(userId) {
    logger.info(`Cortex: running full analysis for user ${userId}`);

    const campaigns = Campaigns.findByUserWithEngagement(userId);
    if (campaigns.length < 5) {
      logger.info("Cortex: not enough data for pattern analysis (need 5+ campaigns)");
      return;
    }

    // Timing analysis
    const byDay = {};
    for (const c of campaigns) {
      const day = new Date(c.created_at).getDay();
      if (!byDay[day]) byDay[day] = { total: 0, views: 0 };
      byDay[day].total++;
      byDay[day].views += c.total_views || 0;
    }

    let bestDay = null;
    let bestAvg = 0;
    for (const [day, data] of Object.entries(byDay)) {
      const avg = data.views / data.total;
      if (avg > bestAvg) {
        bestAvg = avg;
        bestDay = day;
      }
    }

    if (bestDay !== null && Object.keys(byDay).length >= 3) {
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      this.learnPattern(
        userId,
        `Posts on ${dayNames[bestDay]} perform ${((bestAvg / (campaigns.reduce((s, c) => s + (c.total_views || 0), 0) / campaigns.length)) * 100 - 100).toFixed(0)}% above average`,
        0.75,
        "timing",
        "all",
        campaigns.length
      );
    }

    const digest = await this.generateWeeklyDigest(userId);
    bus.publish(Events.DIGEST_GENERATED, { userId, digest });
    return digest;
  }
}

export default new CortexService();
