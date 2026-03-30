// ─── Auth Middleware ───
// Verifies JWT, attaches user to req, handles expired tokens gracefully.

import jwt from "jsonwebtoken";
import config from "../config/index.js";
import { Users } from "../models/index.js";
import { AuthError } from "../utils/errors.js";

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new AuthError("No token provided");
    }

    const token = header.slice(7);
    const payload = jwt.verify(token, config.auth.jwtSecret);
    const user = await Users.findById(payload.sub);

    if (!user) throw new AuthError("User not found");

    req.user = Users.safe(user);
    req.userId = user.id;
    next();
  } catch (err) {
    if (err instanceof AuthError) return next(err);
    if (err.name === "TokenExpiredError") return next(new AuthError("Token expired"));
    if (err.name === "JsonWebTokenError") return next(new AuthError("Invalid token"));
    next(new AuthError("Authentication failed"));
  }
}

export function generateToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiry }
  );
}

// Optional auth — doesn't fail, just doesn't attach user
export async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (header && header.startsWith("Bearer ")) {
      const token = header.slice(7);
      const payload = jwt.verify(token, config.auth.jwtSecret);
      const user = await Users.findById(payload.sub);
      if (user) {
        req.user = Users.safe(user);
        req.userId = user.id;
      }
    }
  } catch {
    // Silently continue without auth
  }
  next();
}
