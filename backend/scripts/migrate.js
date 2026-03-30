// ─── Migration Runner ───
// Run with: node scripts/migrate.js
// Creates all tables if they don't exist.

import { migrate, close } from "../src/models/database.js";
import logger from "../src/utils/logger.js";

async function run() {
  try {
    await migrate();
    logger.info("Migration complete");
  } catch (err) {
    logger.error("Migration failed", { error: err.message });
    process.exit(1);
  } finally {
    await close();
  }
}

run();
