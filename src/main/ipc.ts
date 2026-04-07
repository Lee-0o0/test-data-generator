import { ipcMain, dialog, shell } from 'electron'
import { dbapi } from './db'
import { generateDataset, MAX_ROWS } from './generate'
import { exportCsv } from './exportCsv'
import { exportJson, exportMysqlSql } from './exportJsonMysql'
import { suggestRulesForFields } from './aiService'
import { ensureAiLogDir, getAiLogDirPath, getAiRequestsLogPath } from './aiLog'
import { getMemorySettings, isValidSettingKey, saveSettings, type AppSettings } from './settingsStore'
import { previewRuleSample, validateFieldRule } from './ruleEngine'

export function registerIpc(): void {
  ipcMain.handle('models:list', () => {
    return dbapi.prepare(`SELECT * FROM data_model ORDER BY updated_at DESC`).all()
  })

  ipcMain.handle('models:get', (_e, id: number) => {
    return dbapi.prepare(`SELECT * FROM data_model WHERE id = ?`).get(id)
  })

  ipcMain.handle('models:create', (_e, payload: { name: string; description?: string }) => {
    const info = dbapi
      .prepare(`INSERT INTO data_model (name, description) VALUES (?, ?)`)
      .run(payload.name, payload.description ?? null)
    return { id: info.lastInsertRowid }
  })

  ipcMain.handle(
    'models:update',
    (_e, payload: { id: number; name: string; description?: string }) => {
      dbapi
        .prepare(
          `UPDATE data_model SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .run(payload.name, payload.description ?? null, payload.id)
    }
  )

  ipcMain.handle('models:delete', (_e, id: number) => {
    dbapi.prepare(`DELETE FROM data_model WHERE id = ?`).run(id)
  })

  ipcMain.handle('models:copy', (_e, id: number) => {
    const m = dbapi.prepare(`SELECT * FROM data_model WHERE id = ?`).get(id) as
      | { name: string; description: string | null }
      | undefined
    if (!m) throw new Error('模型不存在')
    const base = `${m.name}_copy`
    let name = base
    let n = 1
    while (dbapi.prepare(`SELECT 1 AS x FROM data_model WHERE name = ?`).get(name)) {
      n++
      name = `${base}_${n}`
    }
    return dbapi.transaction(() => {
      const info = dbapi
        .prepare(`INSERT INTO data_model (name, description) VALUES (?, ?)`)
        .run(name, m.description)
      const newId = info.lastInsertRowid
      const fields = dbapi
        .prepare(`SELECT * FROM model_field WHERE model_id = ? ORDER BY sort_order, id`)
        .all(id) as Array<{
        field_name: string
        field_type: string
        required: number
        rule_expr: string
        sample_value: string | null
        remark: string | null
        sort_order: number
      }>
      const ins = dbapi.prepare(
        `INSERT INTO model_field (model_id, field_name, field_type, required, rule_expr, sample_value, remark, sort_order)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      for (const f of fields) {
        ins.run(
          newId,
          f.field_name,
          f.field_type,
          f.required,
          f.rule_expr,
          f.sample_value,
          f.remark,
          f.sort_order
        )
      }
      return { id: newId }
    })
  })

  ipcMain.handle('fields:list', (_e, modelId: number) => {
    return dbapi
      .prepare(`SELECT * FROM model_field WHERE model_id = ? ORDER BY sort_order ASC, id ASC`)
      .all(modelId)
  })

  ipcMain.handle(
    'rule:preview',
    (_e, payload: { ruleExpr: string; fieldKey?: string; fieldType?: string }) => {
      return previewRuleSample(
        payload.ruleExpr,
        payload.fieldKey ?? '__preview__',
        payload.fieldType
      )
    }
  )

  ipcMain.handle(
    'fields:save',
    (
      _e,
      payload: {
        modelId: number
        fields: Array<{
          field_name: string
          field_type: string
          required: boolean
          rule_expr: string
          sample_value?: string
          remark?: string
          sort_order: number
        }>
      }
    ) => {
      const errors: string[] = []
      for (const f of payload.fields) {
        const vr = validateFieldRule(String(f.field_type ?? ''), String(f.rule_expr ?? '').trim())
        if (!vr.valid) {
          errors.push(`「${f.field_name.trim() || '未命名字段'}」${vr.message ?? '规则无效'}`)
        }
      }
      if (errors.length > 0) {
        return { ok: false as const, errors }
      }

      dbapi.transaction(() => {
        dbapi.prepare(`DELETE FROM model_field WHERE model_id = ?`).run(payload.modelId)
        const ins = dbapi.prepare(
          `INSERT INTO model_field (model_id, field_name, field_type, required, rule_expr, sample_value, remark, sort_order)
           VALUES (?,?,?,?,?,?,?,?)`
        )
        for (const f of payload.fields) {
          ins.run(
            payload.modelId,
            f.field_name,
            f.field_type,
            f.required ? 1 : 0,
            f.rule_expr,
            f.sample_value ?? null,
            f.remark ?? null,
            f.sort_order
          )
        }
        dbapi
          .prepare(`UPDATE data_model SET updated_at = datetime('now') WHERE id = ?`)
          .run(payload.modelId)
      })
      return { ok: true as const }
    }
  )

  ipcMain.handle(
    'generate:preview',
    (_e, payload: { modelId: number; count: number; seed?: string }) => {
      const count = Math.min(MAX_ROWS, Math.max(1, Math.floor(payload.count)))
      return generateDataset(payload.modelId, count, payload.seed)
    }
  )

  ipcMain.handle(
    'export:csv',
    async (
      _e,
      payload: { modelId: number; count: number; seed?: string; modelName: string }
    ) => {
      const { filePath } = await dialog.showSaveDialog({
        title: '导出 CSV',
        defaultPath: `${payload.modelName}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (!filePath) return { ok: false as const, reason: 'cancelled' }
      const started = Date.now()
      const count = Math.min(MAX_ROWS, Math.max(1, Math.floor(payload.count)))
      const { fields, rows } = generateDataset(payload.modelId, count, payload.seed)
      exportCsv(filePath, fields, rows)
      const duration = Date.now() - started
      dbapi
        .prepare(
          `INSERT INTO generation_history (model_id, model_name, row_count, export_format, file_path, duration_ms, seed)
           VALUES (?,?,?,?,?,?,?)`
        )
        .run(
          payload.modelId,
          payload.modelName,
          count,
          'csv',
          filePath,
          duration,
          payload.seed ?? null
        )
      return { ok: true as const, filePath, durationMs: duration, rowCount: count }
    }
  )

  ipcMain.handle(
    'export:json',
    async (
      _e,
      payload: { modelId: number; count: number; seed?: string; modelName: string }
    ) => {
      const { filePath } = await dialog.showSaveDialog({
        title: '导出 JSON',
        defaultPath: `${payload.modelName}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (!filePath) return { ok: false as const, reason: 'cancelled' }
      const started = Date.now()
      const count = Math.min(MAX_ROWS, Math.max(1, Math.floor(payload.count)))
      const { rows } = generateDataset(payload.modelId, count, payload.seed)
      exportJson(filePath, rows)
      const duration = Date.now() - started
      dbapi
        .prepare(
          `INSERT INTO generation_history (model_id, model_name, row_count, export_format, file_path, duration_ms, seed)
           VALUES (?,?,?,?,?,?,?)`
        )
        .run(
          payload.modelId,
          payload.modelName,
          count,
          'json',
          filePath,
          duration,
          payload.seed ?? null
        )
      return { ok: true as const, filePath, durationMs: duration, rowCount: count }
    }
  )

  ipcMain.handle(
    'export:mysql',
    async (
      _e,
      payload: { modelId: number; count: number; seed?: string; modelName: string }
    ) => {
      const { filePath } = await dialog.showSaveDialog({
        title: '导出 MySQL SQL',
        defaultPath: `${payload.modelName}.sql`,
        filters: [{ name: 'SQL', extensions: ['sql'] }]
      })
      if (!filePath) return { ok: false as const, reason: 'cancelled' }
      const started = Date.now()
      const count = Math.min(MAX_ROWS, Math.max(1, Math.floor(payload.count)))
      const { fields, rows } = generateDataset(payload.modelId, count, payload.seed)
      exportMysqlSql(filePath, payload.modelName, fields, rows)
      const duration = Date.now() - started
      dbapi
        .prepare(
          `INSERT INTO generation_history (model_id, model_name, row_count, export_format, file_path, duration_ms, seed)
           VALUES (?,?,?,?,?,?,?)`
        )
        .run(
          payload.modelId,
          payload.modelName,
          count,
          'mysql',
          filePath,
          duration,
          payload.seed ?? null
        )
      return { ok: true as const, filePath, durationMs: duration, rowCount: count }
    }
  )

  ipcMain.handle('history:list', () => {
    return dbapi.prepare(`SELECT * FROM generation_history ORDER BY created_at DESC LIMIT 200`).all()
  })

  ipcMain.handle('history:delete', (_e, id: number) => {
    dbapi.prepare(`DELETE FROM generation_history WHERE id = ?`).run(id)
  })

  ipcMain.handle(
    'ai:suggestRules',
    async (_e, fields: Array<{ field_name: string; field_type: string }>) => {
      return suggestRulesForFields(fields)
    }
  )

  ipcMain.handle('ai:getLogInfo', () => ({
    dir: getAiLogDirPath(),
    logFile: getAiRequestsLogPath()
  }))

  ipcMain.handle('ai:openLogFolder', async () => {
    ensureAiLogDir()
    const dir = getAiLogDirPath()
    const err = await shell.openPath(dir)
    return { dir, error: err || null }
  })

  ipcMain.handle('app:maxRows', () => MAX_ROWS)

  ipcMain.handle('settings:get', () => getMemorySettings())

  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    const safe: Partial<AppSettings> = {}
    for (const [k, v] of Object.entries(patch)) {
      if (isValidSettingKey(k)) {
        safe[k] = typeof v === 'string' ? v : ''
      }
    }
    const proxy = safe.https_proxy?.trim() ?? ''
    if (proxy) {
      try {
        const u = new URL(proxy)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return { ok: false as const, error: '代理地址须为 http:// 或 https:// 开头' }
        }
      } catch {
        return { ok: false as const, error: '代理地址格式无效，示例：http://127.0.0.1:7890' }
      }
    }
    const aiProv = safe.ai_suggest_provider?.trim().toLowerCase().replace(/-/g, '_')
    if (aiProv) {
      const allowed = [
        'auto',
        'openrouter_first',
        'kimi_first',
        'gemini_only',
        'openrouter_only',
        'kimi_only',
        'gemini_first',
        'openai_first',
        'openai_only'
      ]
      if (!allowed.includes(aiProv)) {
        return {
          ok: false as const,
          error:
            '智能推荐策略须为 auto / openrouter_first / kimi_first / gemini_only / openrouter_only / kimi_only'
        }
      }
      if (aiProv === 'gemini_first') {
        safe.ai_suggest_provider = 'auto'
      } else if (aiProv === 'openai_first') {
        safe.ai_suggest_provider = 'openrouter_first'
      } else if (aiProv === 'openai_only') {
        safe.ai_suggest_provider = 'openrouter_only'
      }
    }
    saveSettings(safe)
    return { ok: true as const }
  })
}
