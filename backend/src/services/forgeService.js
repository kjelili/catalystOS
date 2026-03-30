// ─── Forge Service ───
// Content analysis, Voice DNA application, and platform-native variant generation.
// In production, the generateCaption/generateEdits methods call an LLM API.

import { v4 as uuidv4 } from "uuid";
import { Variants, VoiceDna, Campaigns } from "../models/index.js";
import bus, { Events } from "./eventBus.js";
import logger from "../utils/logger.js";

// Platform-specific generation rules
const PLATFORM_RULES = {
  tiktok: {
    aspect: "9:16", pacing: "fast", maxCap: 150, hookStyle: "A",
    editRules: [
      "Speed up pauses by 1.5x",
      "Add karaoke-style bold captions",
      "Cut to 45s max",
      "Add transition effects between cuts",
      "Auto-zoom on speaker face",
    ],
  },
  instagram: {
    aspect: "9:16", pacing: "medium", maxCap: 2200, hookStyle: "A",
    editRules: [
      "Maintain natural pacing",
      "Add clean white subtitles",
      "Include branded outro card",
      "Hook-optimize first 3s",
      "Auto-generate cover image",
    ],
  },
  linkedin: {
    aspect: "16:9", pacing: "slow", maxCap: 3000, hookStyle: "B",
    editRules: [
      "Keep professional pacing",
      "Add minimal lower-third subtitles",
      "Corporate thumbnail overlay",
      "Include CTA end card",
      "Aspect ratio letterboxed to 16:9",
    ],
  },
  x: {
    aspect: "16:9", pacing: "fast", maxCap: 280, hookStyle: "C",
    editRules: [
      "Extract key soundbite (30s)",
      "Add context captions overlaid",
      "Crop to landscape 16:9",
      "Optimize for autoplay mute",
      "Thread preview card generated",
    ],
  },
  youtube: {
    aspect: "9:16", pacing: "medium", maxCap: 5000, hookStyle: "A",
    editRules: [
      "Trim to 58s max",
      "Add subscribe CTA overlay",
      "Vertical crop with zoom effects",
      "High-energy caption style",
      "Auto-chapter markers",
    ],
  },
};

const TRENDING_AUDIO_LIBRARY = {
  tiktok: [
    { id: "tt_a1", title: "Morning Momentum", genre: "upbeat", momentum: 0.94, fit: ["saas", "growth", "marketing"] },
    { id: "tt_a2", title: "Quiet Build", genre: "lofi", momentum: 0.82, fit: ["founder", "tutorial", "productivity"] },
    { id: "tt_a3", title: "Boardroom Bounce", genre: "electronic", momentum: 0.88, fit: ["b2b", "sales", "agency"] },
  ],
  instagram: [
    { id: "ig_a1", title: "Clean Reels Pulse", genre: "pop", momentum: 0.91, fit: ["creator", "lifestyle", "education"] },
    { id: "ig_a2", title: "Storyboard Flow", genre: "ambient", momentum: 0.79, fit: ["brand", "product", "design"] },
    { id: "ig_a3", title: "Niche Hype", genre: "house", momentum: 0.85, fit: ["coaching", "marketing", "fitness"] },
  ],
  youtube: [
    { id: "yt_a1", title: "Shorts Energy Bed", genre: "edm", momentum: 0.86, fit: ["tutorial", "tech", "gaming"] },
    { id: "yt_a2", title: "Explainer Drive", genre: "cinematic", momentum: 0.81, fit: ["education", "saas", "business"] },
    { id: "yt_a3", title: "Creator Loop", genre: "hiphop", momentum: 0.83, fit: ["creator", "review", "product"] },
  ],
};

class ForgeService {
  // Generate platform-native caption using Voice DNA
  generateCaption(platform, masterContent, voiceDna) {
    const { title, summary } = masterContent;
    const tone = voiceDna?.tone || "Professional";

    // In production, this calls the LLM API with the voice DNA prompt
    const templates = {
      tiktok: `${title} 🔥 #fyp #marketing #growth`,
      instagram: `${title}\n\n${summary || "Check this out."}\n\n💡 Save this for later!\n\n#marketing #digitalmarketing #growth`,
      linkedin: `I spent 6 months studying what makes ${title.toLowerCase()} work.\n\nHere's what most people get wrong:\n\n${summary || "Let me explain."}\n\nThoughts? 👇`,
      x: `${title}\n\nThread 🧵👇`,
      youtube: `${title} | Quick Guide #shorts`,
    };

    let caption = templates[platform] || title;

    // Apply Voice DNA word substitutions
    if (voiceDna?.exclude_words) {
      const excluded = voiceDna.exclude_words.split(",").map((w) => w.trim().toLowerCase());
      excluded.forEach((word) => {
        const regex = new RegExp(`\\b${word}\\b`, "gi");
        caption = caption.replace(regex, "");
      });
    }

    // Apply emoji rules
    if (voiceDna?.emoji_usage === "none") {
      caption = caption.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}]/gu, "");
    }

    return caption.trim();
  }

  getTrendingAudioSuggestions({ platform, niche = "", limit = 5 }) {
    const targetPlatforms = platform ? [platform] : ["tiktok", "instagram", "youtube"];
    const nicheWords = niche.toLowerCase().split(/[\s,]+/).filter(Boolean);
    const scored = [];

    for (const p of targetPlatforms) {
      const pool = TRENDING_AUDIO_LIBRARY[p] || [];
      for (const track of pool) {
        const relevanceBoost = nicheWords.some((word) => track.fit.includes(word)) ? 0.08 : 0;
        scored.push({
          ...track,
          platform: p,
          score: Math.min(1, track.momentum + relevanceBoost),
        });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ score, ...rest }) => ({ ...rest, relevance: Number(score.toFixed(2)) }));
  }

  evaluateHookVariants({ platform, hooks, niche = "" }) {
    const platformRules = PLATFORM_RULES[platform];
    const hooksByPlatform = {
      tiktok: ["curiosity", "relatable", "challenge"],
      instagram: ["story", "question", "aesthetic"],
      linkedin: ["insight", "data", "contrarian"],
      x: ["hot-take", "thread", "question"],
      youtube: ["how-to", "reveal", "challenge"],
    };
    const preferred = hooksByPlatform[platform] || [];
    const nicheWords = niche.toLowerCase().split(/[\s,]+/).filter(Boolean);

    const evaluated = hooks.map((hook) => {
      const text = hook.toLowerCase();
      let score = 0.55;

      if (text.length >= 25 && text.length <= 120) score += 0.1;
      if (text.includes("?")) score += 0.08;
      if (/\d/.test(text)) score += 0.06;
      if (preferred.some((k) => text.includes(k))) score += 0.08;
      if (nicheWords.some((word) => text.includes(word))) score += 0.06;
      if (platformRules?.pacing === "fast" && text.split(" ").length < 14) score += 0.05;

      const confidence = Math.min(0.97, Number(score.toFixed(2)));
      return {
        hook,
        confidence,
        reason:
          confidence >= 0.8
            ? "Strong fit for platform style and likely retention curve."
            : "Decent hook, but can be tighter or more specific for this platform.",
      };
    });

    const ranked = evaluated.sort((a, b) => b.confidence - a.confidence);
    return { winner: ranked[0], ranked };
  }

  // Generate all variants for a campaign
  async generateVariants(userId, campaignId, masterContent, platforms) {
    logger.info(`Forge: generating ${platforms.length} variants for campaign ${campaignId}`);
    bus.publish(Events.FORGE_STARTED, { campaignId, platforms });

    const voiceDna = VoiceDna.findByUser ? VoiceDna.findByUser(userId) : null;
    const variants = [];

    for (const platform of platforms) {
      const rules = PLATFORM_RULES[platform];
      if (!rules) {
        logger.warn(`Forge: unknown platform ${platform}, skipping`);
        continue;
      }

      const caption = this.generateCaption(platform, masterContent, voiceDna);
      const estimatedReach = Math.floor(Math.random() * 50000) + 5000;

      const variant = Variants.create({
        id: uuidv4(),
        campaign_id: campaignId,
        user_id: userId,
        platform,
        caption,
        edits: JSON.stringify(rules.editRules),
        hook_style: rules.hookStyle,
        aspect_ratio: rules.aspect,
        pacing: rules.pacing,
        estimated_reach: estimatedReach,
        approved: 0,
        status: "ready",
      });

      variants.push(variant);
    }

    bus.publish(Events.FORGE_COMPLETE, { campaignId, count: variants.length });
    logger.info(`Forge: generated ${variants.length} variants`);

    return variants;
  }

  // Approve a single variant
  approveVariant(variantId, userId) {
    const variant = Variants.findById(variantId);
    if (!variant || variant.user_id !== userId) return null;

    const updated = Variants.update(variantId, { approved: 1, status: "approved" });
    bus.publish(Events.VARIANT_APPROVED, { variantId, platform: variant.platform });
    return updated;
  }

  // Approve all variants in a campaign
  approveAll(campaignId, userId) {
    const campaign = Campaigns.findById(campaignId);
    if (!campaign || campaign.user_id !== userId) return null;

    Variants.approveAll(campaignId);
    bus.publish(Events.VARIANT_ALL_APPROVED, { campaignId });
    return Variants.findByCampaign(campaignId);
  }
}

export default new ForgeService();
