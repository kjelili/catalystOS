// ─── Catalyst OS Configuration ───
// Loads and validates all environment variables at startup.
// Fails fast if critical config is missing.

import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, "../../.env") });
const isVercel =
  process.env.VERCEL === "1" ||
  Boolean(process.env.VERCEL_REGION) ||
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

function env(key, fallback) {
  const val = process.env[key];
  if (val !== undefined && val !== "") return val;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${key}`);
}

const config = Object.freeze({
  port: parseInt(env("PORT", "4000"), 10),
  nodeEnv: env("NODE_ENV", "development"),
  isDev: env("NODE_ENV", "development") === "development",
  isProd: env("NODE_ENV", "development") === "production",
  isTest: env("NODE_ENV", "development") === "test",

  api: {
    prefix: env("API_PREFIX", "/api/v1"),
  },

  auth: {
    jwtSecret: env("JWT_SECRET", "dev-secret-change-in-production"),
    jwtExpiry: env("JWT_EXPIRY", "7d"),
    bcryptRounds: parseInt(env("BCRYPT_ROUNDS", "12"), 10),
  },

  db: {
    url: env("DATABASE_URL", ""),
    // Vercel filesystem is ephemeral; /tmp is writable per invocation.
    path: env("DB_PATH", isVercel ? "/tmp/catalyst.db" : join(__dirname, "../../data/catalyst.db")),
  },

  rateLimit: {
    windowMs: parseInt(env("RATE_LIMIT_WINDOW_MS", "900000"), 10),
    max: parseInt(env("RATE_LIMIT_MAX_REQUESTS", "100"), 10),
  },

  platforms: {
    tiktok: {
      clientKey: env("TIKTOK_CLIENT_KEY", ""),
      clientSecret: env("TIKTOK_CLIENT_SECRET", ""),
    },
    instagram: {
      accessToken: env("INSTAGRAM_ACCESS_TOKEN", ""),
    },
    linkedin: {
      accessToken: env("LINKEDIN_ACCESS_TOKEN", ""),
    },
    x: {
      apiKey: env("X_API_KEY", ""),
      apiSecret: env("X_API_SECRET", ""),
    },
    youtube: {
      apiKey: env("YOUTUBE_API_KEY", ""),
    },
  },

  ai: {
    openaiKey: env("OPENAI_API_KEY", ""),
    anthropicKey: env("ANTHROPIC_API_KEY", ""),
  },

  alerts: {
    twilioSid: env("TWILIO_ACCOUNT_SID", ""),
    twilioToken: env("TWILIO_AUTH_TOKEN", ""),
    twilioFrom: env("TWILIO_PHONE_FROM", ""),
    alertTo: env("ALERT_PHONE_TO", ""),
  },

  logging: {
    level: env("LOG_LEVEL", "info"),
  },
});

export default config;
