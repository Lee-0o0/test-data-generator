/**
 * 解析 MySQL 风格 CREATE TABLE，用于导入数据模型（列名、可空性、类型 → 本应用 field_type + 默认规则）。
 */

import { defaultRuleForFieldType } from './ruleEngine'

export type MysqlColumnSpec = {
  name: string
  /** 原始列定义片段（截断），写入备注便于对照 */
  raw: string
  nullable: boolean
  autoIncrement: boolean
  unsigned: boolean
  mysqlType: string
  charLength?: number
  precision?: number
  scale?: number
  enumValues?: string[]
}

export type ParseMysqlDdlResult =
  | { ok: true; tableName: string; columns: MysqlColumnSpec[] }
  | { ok: false; error: string }

function stripSqlComments(sql: string): string {
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, ' ')
  s = s.replace(/--[^\n\r]*/g, ' ')
  return s
}

function findMatchingParen(s: string, openIdx: number): number {
  let depth = 0
  let q: "'" | '"' | null = null
  for (let j = openIdx; j < s.length; j++) {
    const c = s[j]!
    if (q) {
      if (c === '\\' && q === '"') {
        j++
        continue
      }
      if (c === q && s[j - 1] !== '\\') q = null
      continue
    }
    if (c === "'" || c === '"') {
      q = c
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return j
    }
  }
  return -1
}

function splitTopLevelCommas(inner: string): string[] {
  const parts: string[] = []
  let cur = ''
  let depth = 0
  let q: "'" | '"' | null = null
  for (let k = 0; k < inner.length; k++) {
    const c = inner[k]!
    if (q) {
      if (c === '\\' && q === '"') {
        cur += c + (inner[k + 1] ?? '')
        k++
        continue
      }
      if (c === q && (q === "'" ? inner[k - 1] !== '\\' : true)) {
        cur += c
        q = null
        continue
      }
      cur += c
      continue
    }
    if (c === "'" || c === '"') {
      q = c
      cur += c
      continue
    }
    if (c === '(') {
      depth++
      cur += c
      continue
    }
    if (c === ')') {
      depth = Math.max(0, depth - 1)
      cur += c
      continue
    }
    if (c === ',' && depth === 0) {
      if (cur.trim()) parts.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i]!)) i++
  return i
}

function consumeIdent(s: string, i: number): { name: string; next: number } | null {
  i = skipWs(s, i)
  if (i >= s.length) return null
  if (s[i] === '`') {
    const j = s.indexOf('`', i + 1)
    if (j === -1) return null
    return { name: s.slice(i + 1, j), next: j + 1 }
  }
  const m = s.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_]*/)
  if (!m) return null
  return { name: m[0], next: i + m[0].length }
}

/** 解析 `db`.`tbl` 或 tbl 后的左括号位置（相对于 fragment 起始下标） */
function parseTableClause(
  fragment: string,
  start: number
): { tableName: string; openParen: number } | null {
  let i = skipWs(fragment, start)
  const a = consumeIdent(fragment, i)
  if (!a) return null
  i = a.next
  let tableName = a.name
  i = skipWs(fragment, i)
  if (fragment[i] === '.') {
    i = skipWs(fragment, i + 1)
    const b = consumeIdent(fragment, i)
    if (!b) return null
    tableName = b.name
    i = b.next
  }
  i = skipWs(fragment, i)
  if (fragment[i] !== '(') return null
  return { tableName, openParen: i }
}

function parseLeadingIdent(s: string): { name: string; rest: string } | null {
  let t = s.trim()
  if (!t) return null
  if (t[0] === '`') {
    const end = t.indexOf('`', 1)
    if (end === -1) return null
    return { name: t.slice(1, end), rest: t.slice(end + 1).trim() }
  }
  const m = t.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/)
  if (!m) return null
  return { name: m[1]!, rest: t.slice(m[0].length).trim() }
}

function splitEnumList(inner: string): string[] {
  const out: string[] = []
  let cur = ''
  let q: "'" | '"' | null = null
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!
    if (q) {
      if (c === '\\' && i + 1 < inner.length) {
        cur += inner[i + 1]!
        i++
        continue
      }
      if (c === q) {
        out.push(cur)
        cur = ''
        q = null
        continue
      }
      cur += c
      continue
    }
    if (c === "'" || c === '"') {
      q = c
      cur = ''
      continue
    }
    if (c === ',' && !q) {
      const t = cur.trim()
      if (t) out.push(t)
      cur = ''
      continue
    }
    if (!/\s/.test(c) || cur.length) cur += c
  }
  const last = cur.trim()
  if (last) out.push(last)
  return out.map((x) => x.trim()).filter(Boolean)
}

function stripTrailingClause(def: string): string {
  let d = def
  d = d.replace(/\s+COMMENT\s+('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/gi, '')
  d = d.replace(/\s+ON\s+UPDATE\s+[^,)]*/gi, '')
  d = d.replace(
    /\s+DEFAULT\s+('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\d+\.?\d*|NULL|TRUE|FALSE|CURRENT_TIMESTAMP(?:\s+ON\s+UPDATE\s+CURRENT_TIMESTAMP)?|b'[01]+')/gi,
    ''
  )
  d = d.replace(/\s+AUTO_INCREMENT\b/gi, '')
  d = d.replace(/\s+GENERATED\s+ALWAYS\s+AS\s*\([^)]+\)(?:\s+(?:STORED|VIRTUAL))?/gi, '')
  d = d.replace(/\s+CHARACTER\s+SET\s+\w+/gi, '')
  d = d.replace(/\s+COLLATE\s+\w+/gi, '')
  d = d.replace(/\s+NOT\s+NULL\b/gi, '')
  d = d.replace(/\s+NULL\b/gi, '')
  d = d.replace(/\s+UNSIGNED\b/gi, '')
  d = d.replace(/\s+ZEROFILL\b/gi, '')
  return d.trim()
}

function parseColumnDefinition(part: string): MysqlColumnSpec | null {
  const raw = part.length > 200 ? `${part.slice(0, 197)}...` : part
  const id = parseLeadingIdent(part)
  if (!id) return null
  let def = id.rest
  const autoIncrement = /\bAUTO_INCREMENT\b/i.test(def)
  const notNull = /\bNOT\s+NULL\b/i.test(def)
  const unsigned = /\bUNSIGNED\b/i.test(def)
  const nullable = !notNull

  def = stripTrailingClause(def)

  let mysqlType = ''
  let charLength: number | undefined
  let precision: number | undefined
  let scale: number | undefined
  let enumValues: string[] | undefined

  if (/^ENUM\s*\(/i.test(def)) {
    const openParen = def.search(/\(/i)
    if (openParen === -1) return null
    const close = findMatchingParen(def, openParen)
    if (close === -1) return null
    const inner = def.slice(openParen + 1, close)
    enumValues = splitEnumList(inner)
    mysqlType = 'ENUM'
  } else if (/^SET\s*\(/i.test(def)) {
    mysqlType = 'SET'
  } else {
    const decM = def.match(/^(DECIMAL|NUMERIC|FIXED)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/i)
    if (decM) {
      mysqlType = decM[1]!.toUpperCase()
      precision = parseInt(decM[2]!, 10)
      scale = parseInt(decM[3]!, 10)
    } else {
      const vcM = def.match(/^(VAR)?CHAR\s*\(\s*(\d+)\s*\)/i)
      if (vcM) {
        mysqlType = vcM[1] ? 'VARCHAR' : 'CHAR'
        charLength = parseInt(vcM[2]!, 10)
      } else {
        const binM = def.match(/^(VARBINARY|BINARY)\s*\(\s*(\d+)\s*\)/i)
        if (binM) {
          mysqlType = binM[1]!.toUpperCase()
          charLength = parseInt(binM[2]!, 10)
        } else {
          const floatM = def.match(/^(FLOAT|DOUBLE|REAL)(\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?/i)
          if (floatM) {
            mysqlType = floatM[1]!.toUpperCase()
          } else {
            const intM = def.match(
              /^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)(\s*\(\s*(\d+)\s*\))?/i
            )
            if (intM) {
              mysqlType = intM[1]!.toUpperCase()
              if (intM[3]) charLength = parseInt(intM[3]!, 10)
            } else {
              const bitM = def.match(/^BIT\s*\(\s*(\d+)\s*\)/i)
              if (bitM) {
                mysqlType = 'BIT'
                charLength = parseInt(bitM[1]!, 10)
              } else {
                const simple = def.match(
                  /^([A-Z_]+)(?:\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?/i
                )
                if (simple) mysqlType = simple[1]!.toUpperCase()
                else return null
              }
            }
          }
        }
      }
    }
  }

  return {
    name: id.name,
    raw,
    nullable,
    autoIncrement,
    unsigned,
    mysqlType,
    charLength,
    precision,
    scale,
    enumValues
  }
}

function isConstraintLine(part: string): boolean {
  const u = part.toUpperCase().trim()
  return (
    u.startsWith('PRIMARY KEY') ||
    u.startsWith('UNIQUE KEY') ||
    u.startsWith('UNIQUE INDEX') ||
    u.startsWith('UNIQUE ') ||
    u.startsWith('KEY ') ||
    u.startsWith('INDEX ') ||
    u.startsWith('CONSTRAINT ') ||
    u.startsWith('FOREIGN KEY') ||
    u.startsWith('FULLTEXT') ||
    u.startsWith('SPATIAL') ||
    u.startsWith('CHECK ')
  )
}

/** 对外：从一段 SQL 中解析第一条 CREATE TABLE */
export function parseMysqlCreateTable(ddl: string): ParseMysqlDdlResult {
  const s = stripSqlComments(ddl).trim()
  if (!s) return { ok: false, error: 'SQL 为空' }

  const idx = s.search(/\bCREATE\s+TABLE\b/i)
  if (idx === -1) return { ok: false, error: '未找到 CREATE TABLE 语句' }

  const tail = s.slice(idx)
  const head = tail.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i)
  if (!head) return { ok: false, error: 'CREATE TABLE 语法无法识别' }

  const afterHead = tail.slice(head[0].length)
  const tbl = parseTableClause(afterHead, 0)
  if (!tbl) return { ok: false, error: '无法解析表名' }

  const openPos = head[0].length + tbl.openParen
  const closeRel = findMatchingParen(tail, openPos)
  if (closeRel === -1) return { ok: false, error: '括号不匹配' }

  const body = tail.slice(openPos + 1, closeRel)
  const parts = splitTopLevelCommas(body)
  const columns: MysqlColumnSpec[] = []

  for (const part of parts) {
    if (!part || isConstraintLine(part)) continue
    const col = parseColumnDefinition(part)
    if (col) columns.push(col)
  }

  if (columns.length === 0) return { ok: false, error: '未解析到任何列（可能仅有索引/约束）' }

  return { ok: true, tableName: tbl.tableName, columns }
}

function maxDecimalValue(p: number, s: number): number {
  const id = Math.max(0, p - s)
  const intMax = id > 0 ? Math.pow(10, id) - 1 : 0
  const frac =
    s > 0 ? (Math.pow(10, s) - 1) / Math.pow(10, s) : 0
  return intMax + frac
}

function escapeEnumToken(v: string): string {
  if (/[,\s()]/.test(v)) return `'${v.replace(/'/g, "\\'")}'`
  return v
}

/** 将解析后的列映射为 fields:save 所需结构 */
export function mysqlColumnsToFieldPayloads(
  columns: MysqlColumnSpec[]
): Array<{
  field_name: string
  field_type: string
  required: boolean
  rule_expr: string
  sample_value: string
  remark: string
  sort_order: number
}> {
  return columns.map((col, sort_order) => {
    const remark = `DDL：${col.raw}`
    let field_type = 'string'
    let rule_expr = defaultRuleForFieldType('string')
    let sample_value = ''

    if (col.autoIncrement) {
      field_type = 'increment'
      rule_expr = 'increment'
      sample_value = '1'
    } else if (col.mysqlType === 'ENUM' && col.enumValues?.length) {
      field_type = 'enum'
      const tokens = col.enumValues.map(escapeEnumToken)
      rule_expr = `enum(${tokens.join(',')})`
      sample_value = col.enumValues[0] ?? 'A'
    } else if (col.mysqlType === 'BIT' && col.charLength === 1) {
      field_type = 'bool'
      rule_expr = 'enum(true,false)'
      sample_value = 'true'
    } else if (col.mysqlType === 'TINYINT' && col.charLength === 1) {
      field_type = 'bool'
      rule_expr = 'enum(true,false)'
      sample_value = 'true'
    } else if (
      /^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)$/i.test(col.mysqlType)
    ) {
      field_type = 'int'
      if (col.unsigned) {
        rule_expr = 'int(0,4294967295)'
        sample_value = '100'
      } else {
        rule_expr = defaultRuleForFieldType('int')
        sample_value = '42'
      }
    } else if (
      /^(DECIMAL|NUMERIC|FIXED)$/i.test(col.mysqlType) &&
      col.precision != null &&
      col.scale != null
    ) {
      field_type = 'decimal'
      const maxV = maxDecimalValue(col.precision, col.scale)
      rule_expr = `decimal(0,${maxV},${col.scale})`
      sample_value = String(Math.min(maxV, 99.99))
    } else if (/^(FLOAT|DOUBLE|REAL)$/i.test(col.mysqlType)) {
      field_type = 'decimal'
      rule_expr = 'decimal(0,1000000,4)'
      sample_value = '3.1415'
    } else if (/^(DATE)$/i.test(col.mysqlType)) {
      field_type = 'date'
      rule_expr = defaultRuleForFieldType('date')
      sample_value = '2023-08-17'
    } else if (/^(DATETIME)$/i.test(col.mysqlType)) {
      field_type = 'datetime'
      rule_expr = defaultRuleForFieldType('datetime')
      sample_value = '2024-06-15 14:32:08'
    } else if (/^(TIMESTAMP)$/i.test(col.mysqlType)) {
      field_type = 'timestamp'
      rule_expr = 'timestamp'
      sample_value = '1714521600000'
    } else if (/^TIME$/i.test(col.mysqlType)) {
      field_type = 'regex'
      rule_expr = 'regex(\\d{2}:\\d{2}:\\d{2})'
      sample_value = '14:32:08'
    } else if (/^YEAR$/i.test(col.mysqlType)) {
      field_type = 'int'
      rule_expr = 'int(1901,2155)'
      sample_value = '2024'
    } else if (/^BOOL(EAN)?$/i.test(col.mysqlType)) {
      field_type = 'bool'
      rule_expr = 'enum(true,false)'
      sample_value = 'true'
    } else if (/^(JSON)$/i.test(col.mysqlType)) {
      field_type = 'string'
      const n = 128
      rule_expr = `string(${n})`
      sample_value = '{}'
    } else if (/^(TEXT|TINYTEXT|MEDIUMTEXT|LONGTEXT|SET)$/i.test(col.mysqlType)) {
      field_type = 'string'
      rule_expr = 'string(64)'
      sample_value = 'sample text'
    } else if (/^(BLOB|TINYBLOB|MEDIUMBLOB|LONGBLOB|VARBINARY|BINARY)$/i.test(col.mysqlType)) {
      field_type = 'string'
      const n = Math.min(Math.max(col.charLength ?? 32, 8), 128)
      rule_expr = `string(${n})`
      sample_value = 'deadbeef'
    } else if (/^(CHAR|VARCHAR)$/i.test(col.mysqlType) && col.charLength != null) {
      field_type = 'string'
      const n = Math.min(Math.max(col.charLength, 1), 512)
      rule_expr = `string(${n})`
      sample_value = 'abc'
    } else {
      field_type = 'string'
      rule_expr = defaultRuleForFieldType('string')
      sample_value = 'text'
    }

    const required = !col.nullable

    return {
      field_name: col.name,
      field_type,
      required,
      rule_expr,
      sample_value,
      remark,
      sort_order
    }
  })
}
