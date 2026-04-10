import { writeFileSync } from 'fs'

/** 导出为 JSON 数组（每行一条对象） */
export function exportJson(filePath: string, rows: Record<string, string | number>[]): void {
  writeFileSync(filePath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
}

function escapeMysqlIdent(name: string): string {
  return `\`${String(name).replace(/`/g, '``')}\``
}

function escapeMysqlString(s: string): string {
  return `'${s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\0/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u001a/g, '\\Z')}'`
}

function sqlValue(v: string | number): string {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return String(v)
  }
  return escapeMysqlString(String(v))
}

/** 表名：字母数字下划线，MySQL 标识符长度限制 */
function sanitizeMysqlTableName(modelName: string): string {
  let t = modelName.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  if (!t) t = 'sample_data'
  if (/^[0-9]/.test(t)) t = `t_${t}`
  return t.slice(0, 64)
}

/**
 * 仅输出 MySQL INSERT（批量）；需目标表已存在且列名、类型匹配。
 */
export function exportMysqlSql(
  filePath: string,
  tableBaseName: string,
  fields: Array<{ field_name: string }>,
  rows: Record<string, string | number>[]
): void {
  const table = escapeMysqlIdent(sanitizeMysqlTableName(tableBaseName))
  const colList = fields.map((f) => escapeMysqlIdent(f.field_name))

  const lines: string[] = []

  const batchSize = 100
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize)
    const tuples = chunk.map((row) => {
      const vals = fields.map((f) => sqlValue(row[f.field_name] ?? ''))
      return `(${vals.join(', ')})`
    })
    lines.push(`INSERT INTO ${table} (${colList.join(', ')}) VALUES`)
    lines.push(`${tuples.join(',\n')};`)
    lines.push('')
  }

  writeFileSync(filePath, lines.join('\n').trimEnd() + '\n', 'utf8')
}
