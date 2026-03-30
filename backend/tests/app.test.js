import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { v4 as uuidv4 } from "uuid";
import { migrate, getDb, close } from "../src/models/database.js";
import {
  Users, VoiceDna, Campaigns, Variants, Signals, Briefs,
  Patterns, ApiHealth, Settings, Audit,
} from "../src/models/index.js";
import forgeService from "../src/services/forgeService.js";
import radarService from "../src/services/radarService.js";
import cortexService from "../src/services/cortexService.js";

process.env.DB_PATH = ":memory:";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-key-for-testing-only";

let testUserId;

before(async () => {
  await migrate();
});

beforeEach(async () => {
  const db = getDb();
  const tables = ["audit_log", "api_health", "settings", "patterns", "briefs", "signals", "engagement", "variants", "campaigns", "voice_dna", "users"];
  for (const t of tables) {
    await db.run(`DELETE FROM ${t}`);
  }
  const user = await Users.createUser({ name: "Test User", email: "test@catalyst.io", password: "testpass123" });
  testUserId = user.id;
  await VoiceDna.upsert(testUserId, { tone: "Professional" });
  await Settings.upsert(testUserId, {});
});

after(async () => {
  await close();
});

describe("Async data layer", () => {
  it("creates and fetches user", async () => {
    const user = await Users.findById(testUserId);
    assert.ok(user);
    assert.equal(user.email, "test@catalyst.io");
  });

  it("upserts voice dna", async () => {
    await VoiceDna.upsert(testUserId, { tone: "Casual", emojiUsage: "heavy" });
    const vd = await VoiceDna.findByUser(testUserId);
    assert.equal(vd.tone, "Casual");
    assert.equal(vd.emoji_usage, "heavy");
  });

  it("creates campaign and variants through forge", async () => {
    const campaign = await Campaigns.create({
      id: uuidv4(),
      user_id: testUserId,
      name: "Test Campaign",
      status: "draft",
      platforms: JSON.stringify(["tiktok", "linkedin"]),
      master_title: "Test",
      master_summary: "Summary",
      content_type: "Talking Head",
    });
    const variants = await forgeService.generateVariants(
      testUserId,
      campaign.id,
      { title: "Test", summary: "Summary" },
      ["tiktok", "linkedin"]
    );
    assert.equal(variants.length, 2);
  });

  it("builds conversation threads", async () => {
    await Signals.create({
      id: uuidv4(),
      user_id: testUserId,
      type: "question",
      topic: "Does this integrate with Shopify?",
      count: 10,
      platforms: JSON.stringify(["linkedin", "x"]),
      sentiment: 0.7,
      actionable: 1,
      dismissed: 0,
    });
    const threads = await radarService.getConversationThreads(testUserId);
    assert.ok(threads.length >= 1);
  });

  it("returns weekly digest and pattern memory", async () => {
    const digest = await cortexService.generateWeeklyDigest(testUserId);
    assert.ok(Array.isArray(digest.recommendedActions));

    await Patterns.create({
      id: uuidv4(),
      user_id: testUserId,
      insight: "Insight",
      confidence: 0.9,
      category: "content",
      platform: "all",
      data_points: 4,
    });
    const memory = await cortexService.getPatternMemory(testUserId, 30);
    assert.equal(memory.windowDays, 30);
  });

  it("writes audit and api health rows", async () => {
    await Audit.log(testUserId, "create", "campaign", "c1", { ok: true }, "127.0.0.1");
    const logs = await Audit.findByUser(testUserId);
    assert.ok(logs.length > 0);

    await ApiHealth.upsert(testUserId, "linkedin", { connected: 1, calls_used: 2, calls_max: 60, status: "healthy" });
    await ApiHealth.incrementCalls(testUserId, "linkedin", 3);
    const rows = await ApiHealth.getForUser(testUserId);
    const li = rows.find((x) => x.platform === "linkedin");
    assert.equal(li.calls_used, 5);
  });
});
