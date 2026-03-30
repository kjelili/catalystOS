// ─── Platform Connector Service ───
// Unified abstraction over all social media APIs.
// Each platform has a connector that handles auth, rate limiting,
// and API-specific formatting. Swap implementations without touching routes.

import { ApiHealth, Audit } from "../models/index.js";
import { RateLimitError, PlatformError } from "../utils/errors.js";
import bus, { Events } from "./eventBus.js";
import logger from "../utils/logger.js";
import config from "../config/index.js";

// ─── Base Connector ───
class BasePlatformConnector {
  constructor(platformId, name) {
    this.platformId = platformId;
    this.name = name;
  }

  // Check rate limit before any API call
  checkRateLimit(userId) {
    const health = ApiHealth.findOne("user_id = ? AND platform = ?", [userId, this.platformId]);
    if (health && health.calls_used >= health.calls_max) {
      bus.publish(Events.RATE_LIMIT_WARNING, { platform: this.platformId, userId });
      throw new RateLimitError(this.name);
    }
  }

  // Record an API call
  recordCall(userId) {
    ApiHealth.incrementCalls(userId, this.platformId);
  }

  // Standard publish flow
  async publish(userId, variant) {
    this.checkRateLimit(userId);

    try {
      logger.info(`${this.name}: publishing variant ${variant.id}`);
      const result = await this._publish(variant);
      this.recordCall(userId);
      Audit.log(userId, "publish", "variant", variant.id, { platform: this.platformId });
      return result;
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      logger.error(`${this.name}: publish failed`, { error: err.message, variantId: variant.id });
      throw new PlatformError(this.name, err.message);
    }
  }

  // Fetch engagement metrics
  async fetchEngagement(userId, externalId) {
    this.checkRateLimit(userId);
    try {
      const result = await this._fetchEngagement(externalId);
      this.recordCall(userId);
      return result;
    } catch (err) {
      logger.error(`${this.name}: fetch engagement failed`, { error: err.message });
      throw new PlatformError(this.name, err.message);
    }
  }

  // Override in subclasses
  async _publish(_variant) { throw new Error("Not implemented"); }
  async _fetchEngagement(_externalId) { throw new Error("Not implemented"); }
}

// ─── TikTok Connector ───
class TikTokConnector extends BasePlatformConnector {
  constructor() { super("tiktok", "TikTok"); }

  async _publish(variant) {
    // In production: POST to TikTok Content Posting API
    // https://developers.tiktok.com/doc/content-posting-api
    logger.info("TikTok: would POST /v2/post/publish/video/init/");
    return { externalId: `tt_${Date.now()}`, url: `https://tiktok.com/@user/video/${Date.now()}` };
  }

  async _fetchEngagement(externalId) {
    // In production: GET /v2/video/query/
    return { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
  }
}

// ─── Instagram Connector ───
class InstagramConnector extends BasePlatformConnector {
  constructor() { super("instagram", "Instagram"); }

  async _publish(variant) {
    // In production: POST to Instagram Graph API
    // Step 1: POST /{ig-user-id}/media (create container)
    // Step 2: POST /{ig-user-id}/media_publish (publish)
    logger.info("Instagram: would POST /media then /media_publish");
    return { externalId: `ig_${Date.now()}`, url: `https://instagram.com/reel/${Date.now()}` };
  }

  async _fetchEngagement(externalId) {
    return { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
  }
}

// ─── LinkedIn Connector ───
class LinkedInConnector extends BasePlatformConnector {
  constructor() { super("linkedin", "LinkedIn"); }

  async _publish(variant) {
    // In production: POST to LinkedIn UGC API
    // POST /ugcPosts with shareContent
    logger.info("LinkedIn: would POST /ugcPosts");
    return { externalId: `li_${Date.now()}`, url: `https://linkedin.com/feed/update/urn:li:share:${Date.now()}` };
  }

  async _fetchEngagement(externalId) {
    return { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
  }
}

// ─── X (Twitter) Connector ───
class XConnector extends BasePlatformConnector {
  constructor() { super("x", "X (Twitter)"); }

  async _publish(variant) {
    // In production: POST /2/tweets (X API v2)
    logger.info("X: would POST /2/tweets");
    return { externalId: `x_${Date.now()}`, url: `https://x.com/user/status/${Date.now()}` };
  }

  async _fetchEngagement(externalId) {
    return { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
  }
}

// ─── YouTube Connector ───
class YouTubeConnector extends BasePlatformConnector {
  constructor() { super("youtube", "YouTube"); }

  async _publish(variant) {
    // In production: YouTube Data API v3
    // POST /upload/youtube/v3/videos
    logger.info("YouTube: would POST /upload/youtube/v3/videos");
    return { externalId: `yt_${Date.now()}`, url: `https://youtube.com/shorts/${Date.now()}` };
  }

  async _fetchEngagement(externalId) {
    return { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
  }
}

// ─── Platform Registry ───
class PlatformService {
  constructor() {
    this.connectors = {
      tiktok: new TikTokConnector(),
      instagram: new InstagramConnector(),
      linkedin: new LinkedInConnector(),
      x: new XConnector(),
      youtube: new YouTubeConnector(),
    };
  }

  getConnector(platformId) {
    const c = this.connectors[platformId];
    if (!c) throw new PlatformError(platformId, "Unknown platform");
    return c;
  }

  async publish(userId, platformId, variant) {
    return this.getConnector(platformId).publish(userId, variant);
  }

  async fetchEngagement(userId, platformId, externalId) {
    return this.getConnector(platformId).fetchEngagement(userId, externalId);
  }

  // Initialize API health records for a user
  initializeHealth(userId) {
    const platforms = Object.keys(this.connectors);
    for (const p of platforms) {
      const limits = { tiktok: 100, instagram: 80, linkedin: 60, x: 120, youtube: 50 };
      ApiHealth.upsert(userId, p, {
        connected: 1,
        calls_used: 0,
        calls_max: limits[p] || 100,
        status: "healthy",
        last_sync: new Date().toISOString(),
      });
    }
  }

  // Get health status for all platforms
  getHealth(userId) {
    return ApiHealth.getForUser(userId);
  }
}

export default new PlatformService();
