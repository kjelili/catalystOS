// ─── Middleware: Validation + Error Handling ───

import { AppError, ValidationError } from "../utils/errors.js";
import logger from "../utils/logger.js";

// Zod schema validation middleware factory
export function validate(schema, source = "body") {
  return (req, res, next) => {
    try {
      const data = req[source];
      const parsed = schema.parse(data);
      req[source] = parsed; // Replace with cleaned/typed data
      next();
    } catch (err) {
      if (err.errors) {
        const details = err.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        }));
        next(new ValidationError("Validation failed", details));
      } else {
        next(new ValidationError(err.message));
      }
    }
  };
}

// Global error handler — ALL errors flow through here
export function errorHandler(err, req, res, _next) {
  // Operational errors (expected)
  if (err instanceof AppError) {
    const response = {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
      },
    };
    if (err.details) response.error.details = err.details;

    if (err.statusCode >= 500) {
      logger.error(`${err.code}: ${err.message}`, { stack: err.stack, path: req.path });
    } else {
      logger.warn(`${err.statusCode} ${err.code}: ${err.message}`, { path: req.path });
    }

    return res.status(err.statusCode).json(response);
  }

  // Unexpected errors
  logger.error("Unhandled error", { message: err.message, stack: err.stack, path: req.path });
  res.status(500).json({
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
  });
}

// 404 handler
export function notFoundHandler(req, res) {
  res.status(404).json({
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}

// Request logging (supplements morgan)
export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn(`Slow request: ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
}
