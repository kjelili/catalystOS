// ─── Database Seeder ───
// Run with: node scripts/seed.js
// Populates the database with realistic demo data for development.

import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { migrate, getDb } from "../src/models/database.js";
import logger from "../src/utils/logger.js";

async function seed() {
  migrate();
  const db = getDb();

  logger.info("Seeding database...");

  // Clear existing data
  const tables = ["audit_log", "api_health", "settings", "patterns", "briefs", "signals", "engagement", "variants", "campaigns", "voice_dna", "users"];
  for (const t of tables) {
    db.prepare(`DELETE FROM ${t}`).run();
  }

  // ─── User ───
  const userId = uuidv4();
  const password = await bcrypt.hash("catalyst2026", 12);
  db.prepare(`INSERT INTO users (id, name, email, password, plan) VALUES (?, ?, ?, ?, ?)`).run(
    userId, "Jordan Davis", "jordan@catalystos.io", password, "pro"
  );

  // ─── Voice DNA ───
  db.prepare(`INSERT INTO voice_dna (id, user_id, tone, emoji_usage, hashtag_style, include_words, exclude_words, samples, trained) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    uuidv4(), userId, "Professional", "minimal", "niche",
    "growth, pipeline, leverage, scale, ROI",
    "synergy, disrupt, game-changer, pivot",
    "[]", 0
  );

  // ─── Settings ───
  db.prepare(`INSERT INTO settings (id, user_id, sentiment_threshold, crisis_alert_enabled, timezone) VALUES (?, ?, ?, ?, ?)`).run(
    uuidv4(), userId, 0.3, 1, "Europe/London"
  );

  // ─── Campaigns ───
  const campaigns = [
    { id: uuidv4(), name: "Product Launch Video", status: "live", date: "2026-03-24" },
    { id: uuidv4(), name: "Customer Testimonial", status: "scheduled", date: "2026-03-25" },
    { id: uuidv4(), name: "How-To Tutorial Series", status: "draft", date: "2026-03-23" },
    { id: uuidv4(), name: "Weekly Industry Insights", status: "live", date: "2026-03-22" },
  ];

  const platformSets = [
    ["tiktok", "instagram", "linkedin"],
    ["linkedin", "x"],
    ["tiktok", "youtube", "instagram"],
    ["linkedin", "x"],
  ];

  for (let i = 0; i < campaigns.length; i++) {
    const c = campaigns[i];
    db.prepare(`INSERT INTO campaigns (id, user_id, name, status, platforms, master_title, master_summary, content_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      c.id, userId, c.name, c.status, JSON.stringify(platformSets[i]),
      c.name, "Key insights and takeaways", "Talking Head", c.date
    );
  }

  // ─── Engagement ───
  const engagementData = [
    { campaignId: campaigns[0].id, platform: "tiktok", views: 5200, likes: 380, comments: 28, shares: 14, saves: 67 },
    { campaignId: campaigns[0].id, platform: "instagram", views: 4100, likes: 312, comments: 22, shares: 11, saves: 54 },
    { campaignId: campaigns[0].id, platform: "linkedin", views: 3540, likes: 200, comments: 17, shares: 9, saves: 35 },
    { campaignId: campaigns[3].id, platform: "linkedin", views: 5400, likes: 340, comments: 56, shares: 42, saves: 128 },
    { campaignId: campaigns[3].id, platform: "x", views: 3020, likes: 194, comments: 33, shares: 25, saves: 73 },
  ];

  for (const e of engagementData) {
    db.prepare(`INSERT INTO engagement (id, campaign_id, platform, views, likes, comments, shares, saves) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      uuidv4(), e.campaignId, e.platform, e.views, e.likes, e.comments, e.shares, e.saves
    );
  }

  // ─── Signals ───
  const signals = [
    { id: uuidv4(), type: "question", count: 23, topic: "Does this integrate with Shopify?", platforms: ["linkedin", "x"], sentiment: 0.70, cId: campaigns[0].id },
    { id: uuidv4(), type: "objection", count: 12, topic: "Pricing seems high for small teams", platforms: ["x", "instagram"], sentiment: 0.25, cId: campaigns[0].id },
    { id: uuidv4(), type: "praise", count: 45, topic: "Love the UI walkthrough", platforms: ["tiktok", "instagram", "youtube"], sentiment: 0.92, cId: campaigns[0].id },
    { id: uuidv4(), type: "question", count: 8, topic: "Can I use this for B2B cold outreach?", platforms: ["linkedin"], sentiment: 0.65, cId: campaigns[3].id },
    { id: uuidv4(), type: "feature_request", count: 15, topic: "Need a mobile app version", platforms: ["x", "tiktok"], sentiment: 0.50, cId: campaigns[3].id },
    { id: uuidv4(), type: "question", count: 31, topic: "How does this compare to Buffer?", platforms: ["linkedin", "x", "instagram"], sentiment: 0.55, cId: campaigns[0].id },
  ];

  for (const s of signals) {
    db.prepare(`INSERT INTO signals (id, user_id, campaign_id, type, topic, count, platforms, sentiment, actionable, dismissed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      s.id, userId, s.cId, s.type, s.topic, s.count, JSON.stringify(s.platforms), s.sentiment, s.type !== "praise" ? 1 : 0, 0
    );
  }

  // ─── Briefs ───
  const briefs = [
    { sId: signals[0].id, title: "Shopify Integration Deep-Dive", script: "Hey — so a lot of you have been asking whether this works with Shopify. Short answer: yes. Here's exactly how to set it up in under 2 minutes...", format: "60s Talking Head", platform: "linkedin", priority: "high" },
    { sId: signals[1].id, title: "Pricing Breakdown for Small Teams", script: "I've seen some comments about pricing. Let me break down exactly what you get and why it's actually cheaper than running 3 separate tools...", format: "45s Screen Share", platform: "x", priority: "high" },
    { sId: signals[3].id, title: "B2B Cold Outreach Playbook", script: "One of the top questions from LinkedIn this week: can you use Catalyst for B2B outreach? Here's a workflow I built that books 3-5 meetings per week...", format: "90s Tutorial", platform: "linkedin", priority: "medium" },
    { sId: signals[5].id, title: "Catalyst vs Buffer: Honest Review", script: "You asked, I'll answer honestly. Here's where Catalyst beats Buffer, and where Buffer still wins. No fluff, just facts...", format: "60s Talking Head", platform: "x", priority: "high" },
  ];

  for (const b of briefs) {
    db.prepare(`INSERT INTO briefs (id, user_id, signal_id, title, script, format, platform, status, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      uuidv4(), userId, b.sId, b.title, b.script, b.format, b.platform, "pending", b.priority
    );
  }

  // ─── Cortex Patterns ───
  const patterns = [
    { insight: "LinkedIn posts with questions as openers get 3.2x more comments", confidence: 0.89, category: "format", platform: "linkedin", dp: 34 },
    { insight: "TikTok audience ignores talking-head; screen-share tutorials get 4x views", confidence: 0.84, category: "format", platform: "tiktok", dp: 28 },
    { insight: "Tuesday 7-9am posts on LinkedIn outperform other slots by 2.1x", confidence: 0.91, category: "timing", platform: "linkedin", dp: 45 },
    { insight: "Posts with pricing transparency get 67% fewer objections", confidence: 0.78, category: "content", platform: "all", dp: 22 },
    { insight: "Instagram carousel posts outperform single-image by 1.8x in saves", confidence: 0.82, category: "format", platform: "instagram", dp: 19 },
    { insight: "Engagement drops 40% after 3 consecutive promotional posts", confidence: 0.93, category: "cadence", platform: "all", dp: 51 },
  ];

  for (const p of patterns) {
    db.prepare(`INSERT INTO patterns (id, user_id, insight, confidence, category, platform, data_points) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      uuidv4(), userId, p.insight, p.confidence, p.category, p.platform, p.dp
    );
  }

  // ─── API Health ───
  const healthData = [
    { platform: "tiktok", calls_used: 34, calls_max: 100 },
    { platform: "instagram", calls_used: 22, calls_max: 80 },
    { platform: "linkedin", calls_used: 18, calls_max: 60 },
    { platform: "x", calls_used: 45, calls_max: 120 },
    { platform: "youtube", calls_used: 8, calls_max: 50 },
  ];

  for (const h of healthData) {
    db.prepare(`INSERT INTO api_health (id, user_id, platform, connected, calls_used, calls_max, status, last_sync) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      uuidv4(), userId, h.platform, 1, h.calls_used, h.calls_max, "healthy", new Date().toISOString()
    );
  }

  logger.info("Seed complete!");
  logger.info("Login: jordan@catalystos.io / catalyst2026");
  process.exit(0);
}

seed().catch((err) => {
  logger.error("Seed failed", { error: err.message });
  process.exit(1);
});
