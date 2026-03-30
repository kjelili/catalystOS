// ─── Base Model ───
// Provides typed CRUD helpers for any table.
// All models extend this for consistent query patterns.

import { v4 as uuidv4 } from "uuid";
import { getDb } from "./database.js";

export default class BaseModel {
  constructor(table) {
    this.table = table;
    this._hasUpdatedAt = null;
  }

  get db() {
    return getDb();
  }

  findById(id) {
    return this.db.prepare(`SELECT * FROM ${this.table} WHERE id = ?`).get(id) || null;
  }

  findByUser(userId, { limit = 100, offset = 0, orderBy = "created_at DESC", where = "" } = {}) {
    const extra = where ? `AND ${where}` : "";
    return this.db
      .prepare(`SELECT * FROM ${this.table} WHERE user_id = ? ${extra} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(userId, limit, offset);
  }

  findOne(where, params = []) {
    return this.db.prepare(`SELECT * FROM ${this.table} WHERE ${where}`).get(...params) || null;
  }

  findAll(where = "1=1", params = [], orderBy = "created_at DESC") {
    return this.db.prepare(`SELECT * FROM ${this.table} WHERE ${where} ORDER BY ${orderBy}`).all(...params);
  }

  create(data) {
    const id = data.id || uuidv4();
    const cols = Object.keys(data);
    const placeholders = cols.map(() => "?").join(", ");
    const values = cols.map((c) => data[c]);

    if (!cols.includes("id")) {
      cols.unshift("id");
      values.unshift(id);
    }

    this.db
      .prepare(`INSERT INTO ${this.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
      .run(...values);

    return this.findById(id);
  }

  update(id, data) {
    const updates = { ...data };
    if (this.hasColumn("updated_at")) {
      updates.updated_at = new Date().toISOString();
    }
    const cols = Object.keys(updates);
    const setClause = cols.map((c) => `${c} = ?`).join(", ");
    const values = [...cols.map((c) => updates[c]), id];

    this.db.prepare(`UPDATE ${this.table} SET ${setClause} WHERE id = ?`).run(...values);
    return this.findById(id);
  }

  delete(id) {
    const result = this.db.prepare(`DELETE FROM ${this.table} WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  count(where = "1=1", params = []) {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM ${this.table} WHERE ${where}`).get(...params);
    return row?.count || 0;
  }

  transaction(fn) {
    return this.db.transaction(fn)();
  }

  hasColumn(columnName) {
    if (columnName !== "updated_at") {
      const cols = this.db.prepare(`PRAGMA table_info(${this.table})`).all();
      return cols.some((c) => c.name === columnName);
    }
    if (this._hasUpdatedAt === null) {
      const cols = this.db.prepare(`PRAGMA table_info(${this.table})`).all();
      this._hasUpdatedAt = cols.some((c) => c.name === "updated_at");
    }
    return this._hasUpdatedAt;
  }
}
