// ─── Request Validation Schemas ───
// Every API input is validated with Zod before hitting controllers.
// This is the single source of truth for what constitutes valid input.

import { z } from "zod";

// ─── Auth ───
export const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Voice DNA ───
export const voiceDnaSchema = z.object({
  tone: z.enum(["Professional", "Casual", "Bold/Provocative", "Educational", "Storytelling"]),
  emojiUsage: z.enum(["none", "minimal", "moderate", "heavy"]).default("minimal"),
  hashtagStyle: z.enum(["niche", "broad", "none"]).default("niche"),
  includeWords: z.string().max(500).default(""),
  excludeWords: z.string().max(500).default(""),
  samples: z.array(z.string().max(5000)).max(10).default([]),
});

// ─── Campaigns ───
const platformEnum = z.enum(["tiktok", "instagram", "linkedin", "x", "youtube"]);

export const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  platforms: z.array(platformEnum).min(1).max(5),
  masterContent: z.object({
    title: z.string().min(1).max(300),
    summary: z.string().max(2000).default(""),
    contentType: z.enum(["Talking Head", "Screen Share", "B-Roll Heavy", "Interview", "Tutorial"]),
    fileKey: z.string().optional(), // S3/storage key for uploaded video
  }),
  scheduledFor: z.string().datetime().optional(),
});

export const updateCampaignSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(["draft", "scheduled", "live", "paused", "completed", "failed"]).optional(),
  scheduledFor: z.string().datetime().optional(),
});

// ─── Variants ───
export const approveVariantSchema = z.object({
  approved: z.boolean(),
});

export const updateVariantSchema = z.object({
  caption: z.string().max(5000).optional(),
  hookStyle: z.enum(["A", "B", "C"]).optional(),
  approved: z.boolean().optional(),
});

export const trendingAudioQuerySchema = z.object({
  platform: platformEnum.optional(),
  niche: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export const hookTestSchema = z.object({
  platform: platformEnum,
  niche: z.string().max(120).optional(),
  hooks: z.array(z.string().min(1).max(240)).min(2).max(3),
});

// ─── Signals ───
export const updateSignalSchema = z.object({
  dismissed: z.boolean().optional(),
  actionable: z.boolean().optional(),
});

// ─── Briefs ───
export const updateBriefSchema = z.object({
  title: z.string().max(300).optional(),
  script: z.string().max(10000).optional(),
  status: z.enum(["pending", "approved", "recorded", "archived"]).optional(),
  platform: platformEnum.optional(),
  format: z.string().max(100).optional(),
});

export const createBriefSchema = z.object({
  signalId: z.string().optional(),
  title: z.string().min(1).max(300),
  script: z.string().min(1).max(10000),
  platform: platformEnum,
  format: z.string().max(100),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});

// ─── Settings ───
export const updateSettingsSchema = z.object({
  sentimentThreshold: z.number().min(0).max(1).optional(),
  crisisAlertEnabled: z.boolean().optional(),
  alertPhone: z.string().max(20).optional(),
  timezone: z.string().max(50).optional(),
});

export const patternMemoryQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(7).max(180).default(30),
});

export default {
  registerSchema,
  loginSchema,
  voiceDnaSchema,
  createCampaignSchema,
  updateCampaignSchema,
  approveVariantSchema,
  updateVariantSchema,
  trendingAudioQuerySchema,
  hookTestSchema,
  updateSignalSchema,
  updateBriefSchema,
  createBriefSchema,
  updateSettingsSchema,
  patternMemoryQuerySchema,
};
