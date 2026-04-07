import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import initSqlJs, { type Database as SqlJsDatabase, type SqlValue } from 'sql.js'

let sqlDb: SqlJsDatabase | null = null
let filePath = ''
let inTransaction = false

function wasmLocate(file: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, file)
  }
  return join(process.cwd(), 'node_modules/sql.js/dist', file)
}

function persist(): void {
  if (!sqlDb || !filePath) return
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const data = sqlDb.export()
  writeFileSync(filePath, Buffer.from(data))
}

export async function initDb(): Promise<void> {
  const userDir = app.getPath('userData')
  filePath = join(userDir, 'test-data-generator.db')

  const SQL = await initSqlJs({ locateFile: wasmLocate })

  if (existsSync(filePath)) {
    const buf = readFileSync(filePath)
    sqlDb = new SQL.Database(buf)
  } else {
    sqlDb = new SQL.Database()
  }
  migrate(sqlDb)
  persist()
}

export function getDb(): SqlJsDatabase {
  if (!sqlDb) throw new Error('Database not initialized')
  return sqlDb
}

export function persistDb(): void {
  persist()
}

export type ExecResult = { changes: number; lastInsertRowid: number }

export const dbapi = {
  prepare(sql: string) {
    const db = getDb()
    return {
      run(...params: SqlValue[]): ExecResult {
        const stmt = db.prepare(sql)
        stmt.bind(params)
        stmt.step()
        stmt.free()
        const idRes = db.exec('SELECT last_insert_rowid()')
        const lid = idRes[0]?.values[0]?.[0]
        const lastInsertRowid = lid != null ? Number(lid) : 0
        if (!inTransaction) persist()
        return { changes: db.getRowsModified(), lastInsertRowid }
      },
      get(...params: SqlValue[]): Record<string, SqlValue> | undefined {
        const stmt = db.prepare(sql)
        stmt.bind(params)
        const has = stmt.step()
        if (!has) {
          stmt.free()
          return undefined
        }
        const row = stmt.getAsObject() as Record<string, SqlValue>
        stmt.free()
        return row
      },
      all(...params: SqlValue[]): Record<string, SqlValue>[] {
        const stmt = db.prepare(sql)
        stmt.bind(params)
        const rows: Record<string, SqlValue>[] = []
        while (stmt.step()) {
          rows.push(stmt.getAsObject() as Record<string, SqlValue>)
        }
        stmt.free()
        return rows
      }
    }
  },
  transaction<T>(fn: () => T): T {
    const db = getDb()
    inTransaction = true
    db.run('BEGIN IMMEDIATE')
    try {
      const r = fn()
      db.run('COMMIT')
      persist()
      return r
    } catch (e) {
      db.run('ROLLBACK')
      throw e
    } finally {
      inTransaction = false
    }
  }
}

function migrate(database: SqlJsDatabase): void {
  database.run('PRAGMA foreign_keys = ON')
  database.run(`
    CREATE TABLE IF NOT EXISTS data_model (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS model_field (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER NOT NULL REFERENCES data_model(id) ON DELETE CASCADE,
      field_name TEXT NOT NULL,
      field_type TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      rule_expr TEXT NOT NULL,
      sample_value TEXT,
      remark TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE (model_id, field_name)
    );
    CREATE INDEX IF NOT EXISTS idx_model_field_model ON model_field(model_id);

    CREATE TABLE IF NOT EXISTS generation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER REFERENCES data_model(id) ON DELETE SET NULL,
      model_name TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      export_format TEXT NOT NULL,
      file_path TEXT,
      duration_ms INTEGER,
      seed TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_history_created ON generation_history(created_at DESC);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL DEFAULT ''
    );
  `)
}
