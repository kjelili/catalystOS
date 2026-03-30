// ═══════════════════════════════════════════════════════════════════════════════
// CATALYST OS — Test Suite
// Run: node --test tests/app.test.js
// Uses Node.js built-in test runner (no external test framework needed)
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { migrate, getDb, close } from "../src/models/database.js";
import {
  Users, VoiceDna, Campaigns, Variants, Signals,
  Briefs, Patterns, Engagement, ApiHealth, Settings, Audit,
} from "../src/models/index.js";
import forgeService from "../src/services/forgeService.js";
import radarService from "../src/services/radarService.js";
import cortexService from "../src/services/cortexService.js";
import { v4 as uuidv4 } from "uuid";

// ─── Setup: Use in-memory DB for tests ───
process.env.DB_PATH = ":memory:";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-key-for-testing-only";

let testUserId;

before(() => {
  migrate();
});

beforeEach(async () => {
  const db = getDb();
  // Clear all tables
  const tables = ["audit_log", "api_health", "settings", "patterns", "briefs", "signals", "engagement", "variants", "campaigns", "voice_dna", "users"];
  for (const t of tables) {
    db.prepare(`DELETE FROM ${t}`).run();
  }

  // Create test user
  const user = await Users.createUser({ name: "Test User", email: "test@catalyst.io", password: "testpass123" });
  testUserId = user.id;
  VoiceDna.upsert(testUserId, { tone: "Professional" });
  Settings.upsert(testUserId, {});
});

after(() => {
  close();
});

// ═══ USER MODEL TESTS ═══
describe("UserModel", () => {
  it("creates a user with hashed password", async () => {
    const user = Users.findById(testUserId);
    assert.ok(user);
    assert.equal(user.name, "Test User");
    assert.equal(user.email, "test@catalyst.io");
    assert.ok(user.password.startsWith("$2a$") || user.password.startsWith("$2b$"));
  });

  it("finds user by email", () => {
    const user = Users.findByEmail("test@catalyst.io");
    assert.ok(user);
    assert.equal(user.id, testUserId);
  });

  it("returns null for unknown email", () => {
    const user = Users.findByEmail("nobody@catalyst.io");
    assert.equal(user, null);
  });

  it("verifies correct password", async () => {
    const user = Users.findById(testUserId);
    const valid = await Users.verifyPassword(user, "testpass123");
    assert.equal(valid, true);
  });

  it("rejects wrong password", async () => {
    const user = Users.findById(testUserId);
    const valid = await Users.verifyPassword(user, "wrongpassword");
    assert.equal(valid, false);
  });

  it("safe() strips password", () => {
    const user = Users.findById(testUserId);
    const safe = Users.safe(user);
    assert.equal(safe.password, undefined);
    assert.ok(safe.name);
  });
});

// ═══ VOICE DNA TESTS ═══
describe("VoiceDnaModel", () => {
  it("creates voice DNA for user", () => {
    const vd = VoiceDna.findByUser(testUserId);
    assert.ok(vd);
    assert.equal(vd.tone, "Professional");
  });

  it("upserts voice DNA", () => {
    VoiceDna.upsert(testUserId, { tone: "Casual", emojiUsage: "heavy" });
    const vd = VoiceDna.findByUser(testUserId);
    assert.equal(vd.tone, "Casual");
    assert.equal(vd.emoji_usage, "heavy");
  });
});

// ═══ CAMPAIGN MODEL TESTS ═══
describe("CampaignModel", () => {
  it("creates a campaign", () => {
    const campaign = Campaigns.create({
      id: uuidv4(),
      user_id: testUserId,
      name: "Test Campaign",
      status: "draft",
      platforms: JSON.stringify(["tiktok", "linkedin"]),
      master_title: "Test",
      master_summary: "Summary",
      content_type: "Talking Head",
    });
    assert.ok(campaign);
    assert.equal(campaign.name, "Test Campaign");
    assert.equal(campaign.status, "draft");
  });

  it("lists campaigns by user", () => {
    Campaigns.create({ id: uuidv4(), user_id: testUserId, name: "C1", platforms: "[]", master_title: "", master_summary: "", content_type: "" });
    Campaigns.create({ id: uuidv4(), user_id: testUserId, name: "C2", platforms: "[]", master_title: "", master_summary: "", content_type: "" });
    const list = Campaigns.findByUserWithEngagement(testUserId);
    assert.equal(list.length, 2);
  });

  it("pauses all scheduled campaigns", () => {
    Campaigns.create({ id: uuidv4(), user_id: testUserId, name: "Sched", status: "scheduled", platforms: "[]", master_title: "", master_summary: "", content_type: "" });
    Campaigns.create({ id: uuidv4(), user_id: testUserId, name: "Live", status: "live", platforms: "[]", master_title: "", master_summary: "", content_type: "" });
    Campaigns.pauseAllScheduled(testUserId);
    const all = Campaigns.findByUserWithEngagement(testUserId);
    const paused = all.filter((c) => c.status === "paused");
    const live = all.filter((c) => c.status === "live");
    assert.equal(paused.length, 1);
    assert.equal(live.length, 1);
  });
});

// ═══ FORGE SERVICE TESTS ═══
describe("ForgeService", () => {
  it("generates variants for all selected platforms", async () => {
    const campaign = Campaigns.create({
      id: uuidv4(), user_id: testUserId, name: "Forge Test",
      platforms: JSON.stringify(["tiktok", "linkedin", "x"]),
      master_title: "Test Content", master_summary: "Summary", content_type: "Talking Head",
    });

    const variants = await forgeService.generateVariants(
      testUserId, campaign.id,
      { title: "Test Content", summary: "Summary" },
      ["tiktok", "linkedin", "x"]
    );

    assert.equal(variants.length, 3);
    assert.ok(variants.find((v) => v.platform === "tiktok"));
    assert.ok(variants.find((v) => v.platform === "linkedin"));
    assert.ok(variants.find((v) => v.platform === "x"));
  });

  it("applies correct hook styles per platform", async () => {
    const campaign = Campaigns.create({
      id: uuidv4(), user_id: testUserId, name: "Hook Test",
      platforms: "[]", master_title: "", master_summary: "", content_type: "",
    });

    const variants = await forgeService.generateVariants(
      testUserId, campaign.id,
      { title: "Hooks", summary: "" },
      ["tiktok", "linkedin", "x"]
    );

    assert.equal(variants.find((v) => v.platform === "tiktok").hook_style, "A");
    assert.equal(variants.find((v) => v.platform === "linkedin").hook_style, "B");
    assert.equal(variants.find((v) => v.platform === "x").hook_style, "C");
  });

  it("approves a single variant", async () => {
    const campaign = Campaigns.create({
      id: uuidv4(), user_id: testUserId, name: "Approve Test",
      platforms: "[]", master_title: "", master_summary: "", content_type: "",
    });
    const variants = await forgeService.generateVariants(testUserId, campaign.id, { title: "T", summary: "" }, ["tiktok"]);

    const updated = forgeService.approveVariant(variants[0].id, testUserId);
    assert.equal(updated.approved, 1);
    assert.equal(updated.status, "approved");
  });
});

// ═══ RADAR SERVICE TESTS ═══
describe("RadarService", () => {
  it("classifies questions correctly", () => {
    const result = radarService.analyzeComment({ text: "Does this work with Shopify?", platform: "linkedin" });
    assert.equal(result.type, "question");
    assert.equal(result.actionable, true);
  });

  it("classifies objections correctly", () => {
    const result = radarService.analyzeComment({ text: "This is too expensive for what it does", platform: "x" });
    assert.equal(result.type, "objection");
    assert.equal(result.actionable, true);
  });

  it("classifies praise correctly", () => {
    const result = radarService.analyzeComment({ text: "This is amazing, love it!", platform: "tiktok" });
    assert.equal(result.type, "praise");
  });

  it("dismisses a signal", () => {
    const signal = Signals.create({
      id: uuidv4(), user_id: testUserId, type: "question",
      topic: "Test?", count: 5, platforms: "[]", sentiment: 0.7, actionable: 1, dismissed: 0,
    });

    const result = radarService.dismissSignal(signal.id, testUserId);
    assert.ok(result);
    assert.equal(result.dismissed, 1);
  });

  it("approves a brief", () => {
    const brief = Briefs.create({
      id: uuidv4(), user_id: testUserId, title: "Test Brief",
      script: "Script...", format: "60s", platform: "linkedin", status: "pending", priority: "high",
    });

    const result = radarService.approveBrief(brief.id, testUserId);
    assert.ok(result);
    assert.equal(result.status, "approved");
  });
});

// ═══ CORTEX SERVICE TESTS ═══
describe("CortexService", () => {
  it("analyzes content mix", () => {
    Campaigns.create({ id: uuidv4(), user_id: testUserId, name: "Product Launch Promo", platforms: "[]", master_title: "", master_summary: "", content_type: "" });
    Campaigns.create({ id: uuidv4(), user_id: testUserId, name: "How-To Tutorial", platforms: "[]", master_title: "", master_summary: "", content_type: "" });

    const mix = cortexService.analyzeContentMix(testUserId);
    assert.ok(mix.promotional >= 0);
    assert.ok(mix.educational >= 0);
    assert.ok(mix.ideal);
    assert.equal(mix.ideal.promotional, 2);
  });

  it("generates weekly digest", async () => {
    const digest = await cortexService.generateWeeklyDigest(testUserId);
    assert.ok(digest);
    assert.ok(Array.isArray(digest.recommendedActions));
    assert.ok(digest.recommendedActions.length > 0);
  });

  it("learns a new pattern", () => {
    const pattern = cortexService.learnPattern(
      testUserId,
      "Test pattern insight",
      0.85,
      "format",
      "linkedin",
      10
    );
    assert.ok(pattern);
    assert.equal(pattern.insight, "Test pattern insight");
    assert.equal(pattern.confidence, 0.85);
  });

  it("reinforces existing pattern confidence", () => {
    cortexService.learnPattern(testUserId, "Repeated insight", 0.7, "timing", "all", 5);
    const updated = cortexService.learnPattern(testUserId, "Repeated insight", 0.8, "timing", "all", 3);
    assert.ok(updated.confidence > 0.7);
    assert.equal(updated.data_points, 8);
  });
});

// ═══ AUDIT LOG TESTS ═══
describe("AuditModel", () => {
  it("creates an audit entry", () => {
    Audit.log(testUserId, "create", "campaign", "c_123", { name: "Test" }, "127.0.0.1");
    const logs = Audit.findByUser(testUserId);
    assert.ok(logs.length > 0);
    assert.equal(logs[0].action, "create");
    assert.equal(logs[0].resource, "campaign");
  });
});

// ═══ API HEALTH TESTS ═══
describe("ApiHealthModel", () => {
  it("upserts platform health", () => {
    ApiHealth.upsert(testUserId, "tiktok", { connected: 1, calls_used: 10, calls_max: 100, status: "healthy" });
    const health = ApiHealth.getForUser(testUserId);
    const tiktok = health.find((h) => h.platform === "tiktok");
    assert.ok(tiktok);
    assert.equal(tiktok.connected, 1);
    assert.equal(tiktok.calls_used, 10);
  });

  it("increments API call count", () => {
    ApiHealth.upsert(testUserId, "linkedin", { connected: 1, calls_used: 5, calls_max: 60, status: "healthy" });
    ApiHealth.incrementCalls(testUserId, "linkedin", 3);
    const health = ApiHealth.getForUser(testUserId);
    const li = health.find((h) => h.platform === "linkedin");
    assert.equal(li.calls_used, 8);
  });
});

console.log("\n✅ All test suites registered. Running...\n");
