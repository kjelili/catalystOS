// ─── Background Jobs ───
// Scheduled tasks that run independently of HTTP requests.
// Uses node-cron for scheduling. In production, use Bull/BullMQ with Redis.

import cron from "node-cron";
import { Users, Campaigns, Engagement, ApiHealth } from "../models/index.js";
import cortexService from "../services/cortexService.js";
import platformService from "../services/platformService.js";
import bus, { Events } from "../services/eventBus.js";
import logger from "../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

export function startJobs() {
  logger.info("Starting background jobs");

  // ─── Every 15 minutes: Poll engagement metrics ───
  cron.schedule("*/15 * * * *", async () => {
    logger.info("Job: polling engagement metrics");
    try {
      const liveCampaigns = Campaigns.findAll("status = 'live'");
      for (const campaign of liveCampaigns) {
        const platforms = JSON.parse(campaign.platforms || "[]");
        for (const platform of platforms) {
          try {
            const metrics = await platformService.fetchEngagement(campaign.user_id, platform, null);
            Engagement.create({
              id: uuidv4(),
              campaign_id: campaign.id,
              platform,
              views: metrics.views,
              likes: metrics.likes,
              comments: metrics.comments,
              shares: metrics.shares,
              saves: metrics.saves,
            });
          } catch (err) {
            logger.warn(`Job: failed to poll ${platform} for campaign ${campaign.id}: ${err.message}`);
          }
        }
      }
    } catch (err) {
      logger.error("Job: engagement poll failed", { error: err.message });
    }
  });

  // ─── Daily at midnight: Reset API rate limit counters ───
  cron.schedule("0 0 * * *", () => {
    logger.info("Job: resetting daily API rate limits");
    try {
      ApiHealth.resetDailyCounts();
      bus.publish(Events.API_HEALTH_CHECK, { action: "daily_reset" });
    } catch (err) {
      logger.error("Job: rate limit reset failed", { error: err.message });
    }
  });

  // ─── Weekly on Monday at 6am: Run Cortex analysis ───
  cron.schedule("0 6 * * 1", async () => {
    logger.info("Job: running weekly Cortex analysis");
    try {
      const users = Users.findAll();
      for (const user of users) {
        try {
          await cortexService.runAnalysis(user.id);
        } catch (err) {
          logger.error(`Job: Cortex analysis failed for user ${user.id}`, { error: err.message });
        }
      }
    } catch (err) {
      logger.error("Job: weekly analysis sweep failed", { error: err.message });
    }
  });

  // ─── Every hour: Check API health ───
  cron.schedule("0 * * * *", () => {
    logger.info("Job: API health check");
    try {
      const allHealth = ApiHealth.findAll();
      for (const h of allHealth) {
        const usageRatio = h.calls_used / h.calls_max;
        if (usageRatio > 0.9) {
          logger.warn(`API rate limit warning: ${h.platform} at ${(usageRatio * 100).toFixed(0)}%`);
          bus.publish(Events.RATE_LIMIT_WARNING, { platform: h.platform, userId: h.user_id, usage: usageRatio });
        }
      }
    } catch (err) {
      logger.error("Job: health check failed", { error: err.message });
    }
  });

  logger.info("Background jobs scheduled: engagement poll (15m), rate reset (daily), cortex (weekly), health (hourly)");
}
