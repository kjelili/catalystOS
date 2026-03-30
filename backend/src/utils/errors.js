// ─── Application Error Classes ───
// Typed errors that map cleanly to HTTP status codes.
// The global error handler uses these to send consistent responses.

export class AppError extends Error {
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details = null) {
    super(message, 400, "VALIDATION_ERROR");
    this.details = details;
  }
}

export class AuthError extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401, "AUTH_ERROR");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403, "FORBIDDEN");
  }
}

export class RateLimitError extends AppError {
  constructor(platform = "unknown") {
    super(`Rate limit exceeded for ${platform}`, 429, "RATE_LIMIT");
    this.platform = platform;
  }
}

export class PlatformError extends AppError {
  constructor(platform, message) {
    super(`${platform}: ${message}`, 502, "PLATFORM_ERROR");
    this.platform = platform;
  }
}
