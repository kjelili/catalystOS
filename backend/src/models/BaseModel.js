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

  async findById(id) {
    return await this.db.get(`SELECT * FROM ${this.table} WHERE id = ?`, [id]);
  }

  async findByUser(userId, { limit = 100, offset = 0, orderBy = "created_at DESC", where = "" } = {}) {
    const extra = where ? `AND ${where}` : "";
    return await this.db.all(
      `SELECT * FROM ${this.table} WHERE user_id = ? ${extra} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );
  }

  async findOne(where, params = []) {
    return await this.db.get(`SELECT * FROM ${this.table} WHERE ${where}`, params);
  }

  async findAll(where = "1=1", params = [], orderBy = "created_at DESC") {
    return await this.db.all(`SELECT * FROM ${this.table} WHERE ${where} ORDER BY ${orderBy}`, params);
  }

  async create(data) {
    const id = data.id || uuidv4();
    const cols = Object.keys(data);
    const values = cols.map((c) => data[c]);

    if (!cols.includes("id")) {
      cols.unshift("id");
      values.unshift(id);
    }

    await this.db.run(
      `INSERT INTO ${this.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      values
    );

    return await this.findById(id);
  }

  async update(id, data) {
    const updates = { ...data };
    if (await this.hasColumn("updated_at")) {
      updates.updated_at = new Date().toISOString();
    }
    const cols = Object.keys(updates);
    const setClause = cols.map((c) => `${c} = ?`).join(", ");
    const values = [...cols.map((c) => updates[c]), id];

    await this.db.run(`UPDATE ${this.table} SET ${setClause} WHERE id = ?`, values);
    return await this.findById(id);
  }

  async delete(id) {
    const result = await this.db.run(`DELETE FROM ${this.table} WHERE id = ?`, [id]);
    return result.changes > 0;
  }

  async count(where = "1=1", params = []) {
    const row = await this.db.get(`SELECT COUNT(*) as count FROM ${this.table} WHERE ${where}`, params);
    return row?.count || 0;
  }

  async transaction(fn) {
    return await fn();
  }

  async hasColumn(columnName) {
    if (columnName !== "updated_at") {
      const cols = await this.db.tableInfo(this.table);
      return cols.some((c) => c.name === columnName);
    }
    if (this._hasUpdatedAt === null) {
      const cols = await this.db.tableInfo(this.table);
      this._hasUpdatedAt = cols.some((c) => c.name === "updated_at");
    }
    return this._hasUpdatedAt;
  }
}
