// Shared Express app for local server and Vercel.
// Keep this file side-effect-light so it can run in serverless safely.

import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import morgan from "morgan";

import config from "./config/index.js";
import logger from "./utils/logger.js";
import { migrate, getDb } from "./models/database.js";
import routes from "./routes/index.js";
import { errorHandler, notFoundHandler, requestLogger } from "./middleware/handlers.js";

// Ensure schema exists on cold start.
await migrate();

const app = express();

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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    ok: false,
    error: { code: "RATE_LIMIT", message: "Too many auth attempts. Wait 15 minutes." },
  },
});
app.use(`${config.api.prefix}/auth`, authLimiter);

app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

if (config.isDev) {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined", {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: (req) => req.path === "/healthz",
  }));
}
app.use(requestLogger);

app.get("/healthz", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: "1.0.0",
  });
});

app.get("/readyz", async (req, res) => {
  try {
    await getDb().get("SELECT 1");
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "not ready" });
  }
});

// Friendly root response for deployments where users open the base URL.
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Catalyst OS API",
    health: "/healthz",
    readiness: "/readyz",
    apiPrefix: config.api.prefix,
  });
});

app.use(config.api.prefix, routes);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
