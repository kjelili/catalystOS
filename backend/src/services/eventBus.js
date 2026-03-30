// ─── Event Bus ───
// Central pub/sub for decoupled communication between services.
// In production, replace with Redis pub/sub or NATS for multi-instance.

import EventEmitter from "eventemitter3";
import logger from "../utils/logger.js";

class EventBus extends EventEmitter {
  publish(event, data = {}) {
    logger.debug(`Event: ${event}`, { data: typeof data === "object" ? JSON.stringify(data).slice(0, 200) : data });
    this.emit(event, data);
  }

  subscribe(event, handler) {
    this.on(event, handler);
    return () => this.off(event, handler);
  }
}

// Event name constants
export const Events = {
  // Campaign lifecycle
  CAMPAIGN_CREATED: "campaign:created",
  CAMPAIGN_UPDATED: "campaign:updated",
  CAMPAIGN_LAUNCHED: "campaign:launched",
  CAMPAIGN_PAUSED: "campaign:paused",

  // Forge
  FORGE_STARTED: "forge:started",
  FORGE_COMPLETE: "forge:complete",
  VARIANT_APPROVED: "variant:approved",
  VARIANT_ALL_APPROVED: "variant:all_approved",

  // Radar
  SIGNAL_DETECTED: "signal:detected",
  SIGNAL_DISMISSED: "signal:dismissed",
  BRIEF_CREATED: "brief:created",
  BRIEF_APPROVED: "brief:approved",

  // Cortex
  PATTERN_LEARNED: "cortex:pattern_learned",
  DIGEST_GENERATED: "cortex:digest",

  // Crisis
  CRISIS_TRIGGERED: "crisis:triggered",
  CRISIS_RESOLVED: "crisis:resolved",

  // System
  API_HEALTH_CHECK: "system:api_health",
  RATE_LIMIT_WARNING: "system:rate_limit_warning",
};

const bus = new EventBus();
export default bus;
