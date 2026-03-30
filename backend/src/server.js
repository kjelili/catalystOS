import app from "./app.js";
import config from "./config/index.js";
import logger from "./utils/logger.js";
import { close as closeDb } from "./models/database.js";
import { startJobs } from "./jobs/scheduler.js";
import bus from "./services/eventBus.js";

const server = app.listen(config.port, () => {
  logger.info(`Catalyst OS backend running on port ${config.port} [${config.nodeEnv}]`);
  logger.info(`API prefix: ${config.api.prefix}`);
  logger.info(`Health check: http://localhost:${config.port}/healthz`);
});

// ─── Start Background Jobs ───
if (!config.isTest) {
  startJobs();
}

// ─── Graceful Shutdown ───
function shutdown(signal) {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  server.close(async (err) => {
    if (err) {
      logger.error("Error during server close", { error: err.message });
      process.exit(1);
    }

    logger.info("HTTP server closed");
    await closeDb();
    logger.info("Database connection closed");

    bus.removeAllListeners();
    logger.info("Event bus cleared");

    logger.info("Shutdown complete");
    process.exit(0);
  });

  // Force kill after 10s
  setTimeout(() => {
    logger.error("Forced shutdown — connections did not close in time");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Promise Rejection", { reason: reason?.message || reason });
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception", { error: err.message, stack: err.stack });
  shutdown("uncaughtException");
});

export default app;
