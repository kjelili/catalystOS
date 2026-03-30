// ═══════════════════════════════════════════════════════════════════════════════
// CATALYST OS — Main Server Entry Point
// Express application with security hardening, structured logging,
// rate limiting, graceful shutdown, and health endpoints.
// ═══════════════════════════════════════════════════════════════════════════════

import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import morgan from "morgan";

import config from "./config/index.js";
import logger from "./utils/logger.js";
import { migrate, getDb, close as closeDb } from "./models/database.js";
import routes from "./routes/index.js";
import { errorHandler, notFoundHandler, requestLogger } from "./middleware/handlers.js";
import { startJobs } from "./jobs/scheduler.js";
import bus from "./services/eventBus.js";

// ─── Initialize Database ───
migrate();

// ─── Create Express App ───
const app = express();

// ─── Security Middleware ───
app.use(helmet({
  contentSecurityPolicy: config.isProd ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: config.isProd
    ? [/\.catalystos\.io$/, /\.catalyst-os\.com$/]
    : "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86400,
}));

// ─── Rate Limiting ───
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: { code: "RATE_LIMIT", message: "Too many requests. Please try again later." },
  },
  keyGenerator: (req) => req.headers["x-forwarded-for"] || req.ip,
});
app.use(limiter);

// Stricter limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    ok: false,
    error: { code: "RATE_LIMIT", message: "Too many auth attempts. Wait 15 minutes." },
  },
});
app.use(`${config.api.prefix}/auth`, authLimiter);

// ─── Parsing & Compression ───
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

// ─── Request Logging ───
if (config.isDev) {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined", {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: (req) => req.path === "/healthz",
  }));
}
app.use(requestLogger);

// ─── Health Check (pre-auth, for load balancers) ───
app.get("/healthz", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: "1.0.0",
  });
});

app.get("/readyz", (req, res) => {
  try {
    getDb().prepare("SELECT 1").get();
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "not ready" });
  }
});

// ─── API Routes ───
app.use(config.api.prefix, routes);

// ─── Error Handling ───
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Start Server ───
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

  server.close((err) => {
    if (err) {
      logger.error("Error during server close", { error: err.message });
      process.exit(1);
    }

    logger.info("HTTP server closed");
    closeDb();
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
