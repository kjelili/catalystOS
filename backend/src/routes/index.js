// ─── API Routes ───
// All route definitions for Catalyst OS.
// Each route validates input, calls the appropriate service, and returns JSON.

import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { authenticate, generateToken } from "../middleware/auth.js";
import { validate } from "../middleware/handlers.js";
import {
  registerSchema, loginSchema, voiceDnaSchema,
  createCampaignSchema, updateCampaignSchema,
  approveVariantSchema, updateVariantSchema,
  updateSignalSchema, updateBriefSchema, createBriefSchema,
  updateSettingsSchema,
} from "../utils/validators.js";
import {
  Users, VoiceDna, Campaigns, Variants, Engagement,
  Signals, Briefs, Patterns, ApiHealth, Settings, Audit,
} from "../models/index.js";
import forgeService from "../services/forgeService.js";
import radarService from "../services/radarService.js";
import cortexService from "../services/cortexService.js";
import platformService from "../services/platformService.js";
import { NotFoundError, ValidationError, AuthError } from "../utils/errors.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════

router.post("/auth/register", validate(registerSchema), async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (Users.findByEmail(email)) throw new ValidationError("Email already registered");

    const user = await Users.createUser({ name, email, password });

    // Initialize defaults
    VoiceDna.upsert(user.id, { tone: "Professional" });
    Settings.upsert(user.id, {});
    platformService.initializeHealth(user.id);

    const token = generateToken(user);
    Audit.log(user.id, "register", "user", user.id, {}, req.ip);

    res.status(201).json({ ok: true, data: { user: Users.safe(user), token } });
  } catch (err) { next(err); }
});

router.post("/auth/login", validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = Users.findByEmail(email);
    if (!user) throw new AuthError("Invalid credentials");

    const valid = await Users.verifyPassword(user, password);
    if (!valid) throw new AuthError("Invalid credentials");

    const token = generateToken(user);
    Audit.log(user.id, "login", "user", user.id, {}, req.ip);

    res.json({ ok: true, data: { user: Users.safe(user), token } });
  } catch (err) { next(err); }
});

router.get("/auth/me", authenticate, (req, res) => {
  res.json({ ok: true, data: { user: req.user } });
});

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

router.get("/dashboard", authenticate, async (req, res, next) => {
  try {
    const stats = Engagement.getDashboardStats(req.userId) || {};
    const campaignStats = Campaigns.getStats(req.userId) || {};
    const pendingBriefs = Briefs.getPending(req.userId).length;
    const activeSignals = Signals.getActionable(req.userId).length;

    const totalViews = stats.total_views || 0;
    const totalEng = (stats.total_likes || 0) + (stats.total_comments || 0) + (stats.total_shares || 0);

    res.json({
      ok: true,
      data: {
        totalReach: totalViews,
        engagementRate: totalViews > 0 ? ((totalEng / totalViews) * 100).toFixed(1) : "0.0",
        activeCampaigns: campaignStats.total || 0,
        liveCampaigns: campaignStats.live || 0,
        pendingBriefs,
        activeSignals,
      },
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════
// VOICE DNA
// ═══════════════════════════════════════════════════════════════

router.get("/voice-dna", authenticate, (req, res) => {
  const vd = VoiceDna.findByUser(req.userId);
  res.json({ ok: true, data: vd });
});

router.put("/voice-dna", authenticate, validate(voiceDnaSchema), (req, res, next) => {
  try {
    const vd = VoiceDna.upsert(req.userId, req.body);
    Audit.log(req.userId, "update", "voice_dna", vd.id, {}, req.ip);
    res.json({ ok: true, data: vd });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════
// CAMPAIGNS
// ═══════════════════════════════════════════════════════════════

router.get("/campaigns", authenticate, (req, res) => {
  const campaigns = Campaigns.findByUserWithEngagement(req.userId);
  res.json({ ok: true, data: campaigns });
});

router.get("/campaigns/:id", authenticate, (req, res, next) => {
  const campaign = Campaigns.findById(req.params.id);
  if (!campaign || campaign.user_id !== req.userId) return next(new NotFoundError("Campaign"));
  const variants = Variants.findByCampaign(campaign.id);
  const engagement = Engagement.getForCampaign(campaign.id);
  res.json({ ok: true, data: { ...campaign, variants, engagement } });
});

router.post("/campaigns", authenticate, validate(createCampaignSchema), async (req, res, next) => {
  try {
    const { name, platforms, masterContent, scheduledFor } = req.body;

    const campaign = Campaigns.create({
      id: uuidv4(),
      user_id: req.userId,
      name,
      status: scheduledFor ? "scheduled" : "draft",
      platforms: JSON.stringify(platforms),
      master_title: masterContent.title,
      master_summary: masterContent.summary || "",
      content_type: masterContent.contentType,
      file_key: masterContent.fileKey || null,
      scheduled_for: scheduledFor || null,
    });

    // Auto-generate variants via Forge
    const variants = await forgeService.generateVariants(req.userId, campaign.id, masterContent, platforms);

    Audit.log(req.userId, "create", "campaign", campaign.id, { platforms, variantCount: variants.length }, req.ip);

    res.status(201).json({ ok: true, data: { campaign, variants } });
  } catch (err) { next(err); }
});

router.patch("/campaigns/:id", authenticate, validate(updateCampaignSchema), (req, res, next) => {
  try {
    const campaign = Campaigns.findById(req.params.id);
    if (!campaign || campaign.user_id !== req.userId) return next(new NotFoundError("Campaign"));

    const updated = Campaigns.update(campaign.id, req.body);
    Audit.log(req.userId, "update", "campaign", campaign.id, req.body, req.ip);
    res.json({ ok: true, data: updated });
  } catch (err) { next(err); }
});

router.delete("/campaigns/:id", authenticate, (req, res, next) => {
  const campaign = Campaigns.findById(req.params.id);
  if (!campaign || campaign.user_id !== req.userId) return next(new NotFoundError("Campaign"));

  Campaigns.delete(campaign.id);
  Audit.log(req.userId, "delete", "campaign", campaign.id, {}, req.ip);
  res.json({ ok: true, data: { deleted: true } });
});

// ═══════════════════════════════════════════════════════════════
// FORGE — VARIANT MANAGEMENT
// ═══════════════════════════════════════════════════════════════

router.get("/campaigns/:id/variants", authenticate, (req, res, next) => {
  const campaign = Campaigns.findById(req.params.id);
  if (!campaign || campaign.user_id !== req.userId) return next(new NotFoundError("Campaign"));
  res.json({ ok: true, data: Variants.findByCampaign(campaign.id) });
});

router.patch("/variants/:id", authenticate, validate(updateVariantSchema), (req, res, next) => {
  try {
    const variant = Variants.findById(req.params.id);
    if (!variant || variant.user_id !== req.userId) return next(new NotFoundError("Variant"));

    const updated = Variants.update(variant.id, req.body);
    Audit.log(req.userId, "update", "variant", variant.id, req.body, req.ip);
    res.json({ ok: true, data: updated });
  } catch (err) { next(err); }
});

router.post("/variants/:id/approve", authenticate, (req, res, next) => {
  try {
    const updated = forgeService.approveVariant(req.params.id, req.userId);
    if (!updated) return next(new NotFoundError("Variant"));
    res.json({ ok: true, data: updated });
  } catch (err) { next(err); }
});

router.post("/campaigns/:id/approve-all", authenticate, (req, res, next) => {
  try {
    const variants = forgeService.approveAll(req.params.id, req.userId);
    if (!variants) return next(new NotFoundError("Campaign"));
    res.json({ ok: true, data: variants });
  } catch (err) { next(err); }
});

// Launch — publish approved variants
router.post("/campaigns/:id/launch", authenticate, async (req, res, next) => {
  try {
    const campaign = Campaigns.findById(req.params.id);
    if (!campaign || campaign.user_id !== req.userId) return next(new NotFoundError("Campaign"));

    const variants = Variants.findByCampaign(campaign.id).filter((v) => v.approved);
    if (variants.length === 0) return next(new ValidationError("No approved variants to launch"));

    // Publish each variant to its platform
    const results = [];
    for (const v of variants) {
      try {
        const result = await platformService.publish(req.userId, v.platform, v);
        Variants.update(v.id, { status: "published", published_at: new Date().toISOString() });
        results.push({ variantId: v.id, platform: v.platform, ...result });
      } catch (err) {
        Variants.update(v.id, { status: "failed" });
        results.push({ variantId: v.id, platform: v.platform, error: err.message });
      }
    }

    Campaigns.update(campaign.id, { status: "live" });
    Audit.log(req.userId, "launch", "campaign", campaign.id, { results }, req.ip);

    res.json({ ok: true, data: { campaign: Campaigns.findById(campaign.id), publishResults: results } });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════
// RADAR — SIGNALS & BRIEFS
// ═══════════════════════════════════════════════════════════════

router.get("/signals", authenticate, (req, res) => {
  const signals = Signals.getActive(req.userId);
  res.json({ ok: true, data: signals });
});

router.patch("/signals/:id", authenticate, validate(updateSignalSchema), (req, res, next) => {
  try {
    if (req.body.dismissed) {
      const result = radarService.dismissSignal(req.params.id, req.userId);
      if (!result) return next(new NotFoundError("Signal"));
      return res.json({ ok: true, data: result });
    }
    const signal = Signals.findById(req.params.id);
    if (!signal || signal.user_id !== req.userId) return next(new NotFoundError("Signal"));
    res.json({ ok: true, data: Signals.update(signal.id, req.body) });
  } catch (err) { next(err); }
});

router.get("/briefs", authenticate, (req, res) => {
  const { status } = req.query;
  let briefs;
  if (status === "pending") briefs = Briefs.getPending(req.userId);
  else if (status === "approved") briefs = Briefs.getApproved(req.userId);
  else briefs = Briefs.getRecordingQueue(req.userId);
  res.json({ ok: true, data: briefs });
});

router.post("/briefs", authenticate, validate(createBriefSchema), (req, res, next) => {
  try {
    const brief = Briefs.create({ id: uuidv4(), user_id: req.userId, ...req.body });
    Audit.log(req.userId, "create", "brief", brief.id, {}, req.ip);
    res.status(201).json({ ok: true, data: brief });
  } catch (err) { next(err); }
});

router.patch("/briefs/:id", authenticate, validate(updateBriefSchema), (req, res, next) => {
  try {
    const brief = Briefs.findById(req.params.id);
    if (!brief || brief.user_id !== req.userId) return next(new NotFoundError("Brief"));
    const updated = Briefs.update(brief.id, req.body);
    Audit.log(req.userId, "update", "brief", brief.id, req.body, req.ip);
    res.json({ ok: true, data: updated });
  } catch (err) { next(err); }
});

router.post("/briefs/:id/approve", authenticate, (req, res, next) => {
  try {
    const result = radarService.approveBrief(req.params.id, req.userId);
    if (!result) return next(new NotFoundError("Brief"));
    res.json({ ok: true, data: result });
  } catch (err) { next(err); }
});

// Crisis
router.post("/crisis/trigger", authenticate, async (req, res, next) => {
  try {
    await radarService.triggerCrisis(req.userId, null, []);
    Audit.log(req.userId, "trigger", "crisis", null, {}, req.ip);
    res.json({ ok: true, data: { crisisMode: true, message: "All scheduled posts paused" } });
  } catch (err) { next(err); }
});

router.post("/crisis/resolve", authenticate, async (req, res, next) => {
  try {
    await radarService.resolveCrisis(req.userId);
    Audit.log(req.userId, "resolve", "crisis", null, {}, req.ip);
    res.json({ ok: true, data: { crisisMode: false, message: "Scheduled posts resumed" } });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════
// CORTEX — INTELLIGENCE
// ═══════════════════════════════════════════════════════════════

router.get("/cortex", authenticate, async (req, res, next) => {
  try {
    const intelligence = await cortexService.getIntelligence(req.userId);
    res.json({ ok: true, data: intelligence });
  } catch (err) { next(err); }
});

router.get("/cortex/patterns", authenticate, (req, res) => {
  const { minConfidence = 0.5 } = req.query;
  const patterns = Patterns.getHighConfidence(req.userId, parseFloat(minConfidence));
  res.json({ ok: true, data: patterns });
});

router.post("/cortex/analyze", authenticate, async (req, res, next) => {
  try {
    const digest = await cortexService.runAnalysis(req.userId);
    res.json({ ok: true, data: digest });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════
// API HEALTH & SETTINGS
// ═══════════════════════════════════════════════════════════════

router.get("/health/platforms", authenticate, (req, res) => {
  const health = platformService.getHealth(req.userId);
  res.json({ ok: true, data: health });
});

router.get("/settings", authenticate, (req, res) => {
  const settings = Settings.getForUser(req.userId);
  res.json({ ok: true, data: settings });
});

router.put("/settings", authenticate, validate(updateSettingsSchema), (req, res, next) => {
  try {
    const settings = Settings.upsert(req.userId, req.body);
    res.json({ ok: true, data: settings });
  } catch (err) { next(err); }
});

// Audit log
router.get("/audit", authenticate, (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  const logs = Audit.findByUser(req.userId, { limit: parseInt(limit), offset: parseInt(offset) });
  res.json({ ok: true, data: logs });
});

export default router;
