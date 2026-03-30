// ─── Structured Logger ───
// Winston-based logger with JSON format for production, pretty print for dev.

import winston from "winston";
import config from "../config/index.js";

const { combine, timestamp, printf, colorize, json } = winston.format;

const devFormat = combine(
  colorize(),
  timestamp({ format: "HH:mm:ss" }),
  printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

const prodFormat = combine(timestamp(), json());

const logger = winston.createLogger({
  level: config.logging.level,
  format: config.isProd ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
    ...(config.isProd
      ? [
          new winston.transports.File({ filename: "logs/error.log", level: "error", maxsize: 5242880, maxFiles: 5 }),
          new winston.transports.File({ filename: "logs/combined.log", maxsize: 5242880, maxFiles: 5 }),
        ]
      : []),
  ],
  exceptionHandlers: [new winston.transports.Console()],
  rejectionHandlers: [new winston.transports.Console()],
});

export default logger;
