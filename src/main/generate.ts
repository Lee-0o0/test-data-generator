import { dbapi } from './db'
import { createRandom, generateValue, validateFieldRule, type GenerateContext } from './ruleEngine'

export const MAX_ROWS = 1000

export type FieldRow = {
  id: number
  model_id: number
  field_name: string
  field_type: string
  required: number
  rule_expr: string
  sample_value: string | null
  remark: string | null
  sort_order: number
}

export function generateDataset(
  modelId: number,
  count: number,
  seed?: string
): { fields: FieldRow[]; rows: Record<string, string | number>[] } {
  if (count < 1 || count > MAX_ROWS) {
    throw new Error(`生成数量必须在 1～${MAX_ROWS} 之间`)
  }
  const fields = dbapi
    .prepare(`SELECT * FROM model_field WHERE model_id = ? ORDER BY sort_order ASC, id ASC`)
    .all(modelId) as FieldRow[]
  if (fields.length === 0) {
    throw new Error('该模型下没有字段，请先配置字段')
  }

  for (const f of fields) {
    const vr = validateFieldRule(String(f.field_type ?? ''), String(f.rule_expr ?? '').trim())
    if (!vr.valid) {
      throw new Error(`字段「${f.field_name}」：${vr.message ?? '规则无效'}`)
    }
  }

  const rnd = createRandom(seed)
  const rows: Record<string, string | number>[] = []
  const incrementCounters = new Map<string, number>()

  for (let i = 0; i < count; i++) {
    const ctx: GenerateContext = { rowIndex: i, incrementCounters, random: rnd }
    const row: Record<string, string | number> = {}
    for (const f of fields) {
      row[f.field_name] = generateValue(f.rule_expr, f.field_name, ctx)
    }
    rows.push(row)
  }

  return { fields, rows }
}
