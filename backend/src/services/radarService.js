// ─── Radar Service ───
// Active listening engine: sentiment analysis, signal aggregation,
// content brief generation, and crisis interception.

import { v4 as uuidv4 } from "uuid";
import { Signals, Briefs, Campaigns, Settings } from "../models/index.js";
import bus, { Events } from "./eventBus.js";
import logger from "../utils/logger.js";

class RadarService {
  normalizeTopic(topic) {
    return (topic || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\b(the|a|an|this|that|with|for|and|or|to|is|are|does|can)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Aggregate conversation themes without cross-platform identity tracking.
  getConversationThreads(userId) {
    const signals = Signals.getActionable(userId);
    const threadMap = new Map();

    for (const signal of signals) {
      const normalized = this.normalizeTopic(signal.topic);
      if (!normalized) continue;

      // Use first few words as a stable, privacy-preserving topic key.
      const topicKey = normalized.split(" ").slice(0, 6).join(" ");
      const platforms = JSON.parse(signal.platforms || "[]");

      if (!threadMap.has(topicKey)) {
        threadMap.set(topicKey, {
          topic: signal.topic,
          totalMentions: 0,
          platformSet: new Set(),
          signalTypes: new Set(),
          avgSentiment: 0,
          items: 0,
        });
      }

      const thread = threadMap.get(topicKey);
      thread.totalMentions += signal.count;
      thread.items += 1;
      thread.avgSentiment += signal.sentiment;
      thread.signalTypes.add(signal.type);
      platforms.forEach((p) => thread.platformSet.add(p));
    }

    return Array.from(threadMap.values())
      .map((thread) => ({
        topic: thread.topic,
        mentions: thread.totalMentions,
        platformCount: thread.platformSet.size,
        platforms: Array.from(thread.platformSet),
        signalTypes: Array.from(thread.signalTypes),
        sentiment: Number((thread.avgSentiment / thread.items).toFixed(2)),
      }))
      .sort((a, b) => b.mentions - a.mentions);
  }

  // Process incoming engagement data and detect signals
  async processEngagement(userId, campaignId, comments) {
    logger.info(`Radar: processing ${comments.length} comments for campaign ${campaignId}`);

    const signalMap = new Map();

    for (const comment of comments) {
      const analysis = this.analyzeComment(comment);
      if (!analysis.actionable) continue;

      const key = `${analysis.type}:${analysis.topic}`;
      if (signalMap.has(key)) {
        const s = signalMap.get(key);
        s.count++;
        s.sentiment = (s.sentiment + analysis.sentiment) / 2;
        if (!s.platforms.includes(comment.platform)) s.platforms.push(comment.platform);
      } else {
        signalMap.set(key, {
          type: analysis.type,
          topic: analysis.topic,
          count: 1,
          platforms: [comment.platform],
          sentiment: analysis.sentiment,
          actionable: true,
        });
      }
    }

    // Persist signals
    const signals = [];
    for (const [, data] of signalMap) {
      const signal = Signals.create({
        id: uuidv4(),
        user_id: userId,
        campaign_id: campaignId,
        type: data.type,
        topic: data.topic,
        count: data.count,
        platforms: JSON.stringify(data.platforms),
        sentiment: data.sentiment,
        actionable: 1,
        dismissed: 0,
      });
      signals.push(signal);
      bus.publish(Events.SIGNAL_DETECTED, { signalId: signal.id, type: data.type });
    }

    // Check crisis threshold
    await this.checkCrisisThreshold(userId, campaignId, signals);

    // Auto-generate briefs for high-count actionable signals
    const briefWorthy = signals.filter((s) => s.count >= 5 && s.type !== "praise");
    for (const signal of briefWorthy) {
      await this.generateBrief(userId, signal);
    }

    return signals;
  }

  // Analyze a single comment (in production, calls LLM)
  analyzeComment(comment) {
    const text = (comment.text || "").toLowerCase();

    // Simple rule-based classification (replace with LLM in production)
    let type = "praise";
    let actionable = false;

    if (text.includes("expensive") || text.includes("price") || text.includes("cost") || text.includes("but")) {
      type = "objection";
      actionable = true;
    } else if (text.includes("?") || text.includes("how") || text.includes("does") || text.includes("can")) {
      type = "question";
      actionable = true;
    } else if (text.includes("need") || text.includes("wish") || text.includes("should add") || text.includes("feature")) {
      type = "feature_request";
      actionable = true;
    } else if (text.includes("terrible") || text.includes("worst") || text.includes("hate") || text.includes("scam")) {
      type = "complaint";
      actionable = true;
    }

    // Simple sentiment score
    const positive = ["love", "great", "amazing", "awesome", "perfect", "excellent", "helpful"];
    const negative = ["hate", "terrible", "worst", "bad", "expensive", "scam", "disappointed"];
    const posCount = positive.filter((w) => text.includes(w)).length;
    const negCount = negative.filter((w) => text.includes(w)).length;
    const sentiment = Math.max(0, Math.min(1, 0.5 + posCount * 0.15 - negCount * 0.2));

    return { type, actionable, sentiment, topic: comment.text?.slice(0, 200) || "" };
  }

  // Check if sentiment has dropped below crisis threshold
  async checkCrisisThreshold(userId, campaignId, signals) {
    const settings = Settings.getForUser(userId);
    const threshold = settings?.sentiment_threshold || 0.3;

    const negativeSignals = signals.filter((s) => s.sentiment < threshold);
    const totalCount = negativeSignals.reduce((sum, s) => sum + s.count, 0);

    if (totalCount >= 10) {
      logger.warn(`Radar: Crisis threshold reached for user ${userId} — ${totalCount} negative mentions`);
      await this.triggerCrisis(userId, campaignId, negativeSignals);
    }
  }

  // Trigger crisis mode
  async triggerCrisis(userId, campaignId, triggers) {
    Campaigns.pauseAllScheduled(userId);
    bus.publish(Events.CRISIS_TRIGGERED, { userId, campaignId, triggerCount: triggers.length });
    logger.warn(`CRISIS MODE: All scheduled posts paused for user ${userId}`);
    // In production: send SMS via Twilio
  }

  // Resolve crisis
  async resolveCrisis(userId) {
    Campaigns.resumeAllPaused(userId);
    bus.publish(Events.CRISIS_RESOLVED, { userId });
    logger.info(`Crisis resolved for user ${userId}`);
  }

  // Auto-generate a content brief from a signal
  async generateBrief(userId, signal) {
    const topic = signal.topic || "";
    const platform = JSON.parse(signal.platforms || "[]")[0] || "linkedin";

    // In production, this calls the LLM with Voice DNA context
    const script = `A lot of you have been asking: "${topic}". Let me break this down clearly so there's no confusion...`;
    const format = signal.count > 15 ? "60s Talking Head" : "45s Screen Share";

    const brief = Briefs.create({
      id: uuidv4(),
      user_id: userId,
      signal_id: signal.id,
      title: topic.length > 80 ? topic.slice(0, 77) + "..." : topic,
      script,
      format,
      platform,
      status: "pending",
      priority: signal.count >= 20 ? "high" : signal.count >= 10 ? "medium" : "low",
    });

    bus.publish(Events.BRIEF_CREATED, { briefId: brief.id, signalId: signal.id });
    logger.info(`Radar: auto-generated brief "${brief.title}"`);
    return brief;
  }

  // Dismiss a signal
  dismissSignal(signalId, userId) {
    const signal = Signals.findById(signalId);
    if (!signal || signal.user_id !== userId) return null;
    bus.publish(Events.SIGNAL_DISMISSED, { signalId });
    return Signals.update(signalId, { dismissed: 1 });
  }

  // Approve a brief (moves to Studio queue)
  approveBrief(briefId, userId) {
    const brief = Briefs.findById(briefId);
    if (!brief || brief.user_id !== userId) return null;
    bus.publish(Events.BRIEF_APPROVED, { briefId });
    return Briefs.update(briefId, { status: "approved" });
  }
}

export default new RadarService();
