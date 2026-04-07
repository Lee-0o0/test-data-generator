export type GenerateContext = {
  rowIndex: number
  incrementCounters: Map<string, number>
  random: () => number
}

const CN_SURNAMES = ['张', '李', '王', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡']
const CN_GIVEN = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '涛', '明', '超', '鹏', '玲', '丹', '浩']

const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const WORD_EXTRA = '_'
const SPACE_CHARS = ' \t'

/** 用于 [^...] 时的默认字符池（避免生成不可见控制字符） */
const DEFAULT_CLASS_UNIVERSE =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.@#%'

function pick<T>(arr: T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)]!
}

function randomInt(min: number, max: number, rnd: () => number): number {
  return Math.floor(rnd() * (max - min + 1)) + min
}

function randomDigits(len: number, rnd: () => number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += String(randomInt(0, 9, rnd))
  return s
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function daysInMonth(y: number, m: number): number {
  const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (m === 2 && isLeapYear(y)) return 29
  return dim[m - 1] ?? 28
}

/**
 * 解析 rule(name + 平衡括号内参数)，支持 regex(\d{6})、enum(A,B)、fixed(a(b)) 等。
 */
export function parseRuleCall(expr: string): { name: string; args: string } | null {
  const t = expr.trim()
  const open = t.indexOf('(')
  if (open === -1) return null
  const name = t.slice(0, open).trim()
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return null
  let depth = 0
  let close = -1
  for (let i = open; i < t.length; i++) {
    const ch = t[i]!
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close === -1) return null
  if (t.slice(close + 1).trim() !== '') return null
  return { name, args: t.slice(open + 1, close) }
}

/** 按最外层 `+` 拼接规则，如 SKP+string(8)；括号内的 + 不参与切分 */
export function splitTopLevelPlus(expr: string): string[] {
  const out: string[] = []
  let cur = ''
  let depth = 0
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]!
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === '+' && depth === 0) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function splitTopLevelArgs(argStr: string): string[] {
  const out: string[] = []
  let cur = ''
  let depth = 0
  for (const ch of argStr) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function stripEnumToken(s: string): string {
  const t = s.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

const MAX_QUANTIFIER_REPEAT = 48

function readQuantifier(
  pattern: string,
  i: number
): { min: number; max: number; next: number } {
  if (i >= pattern.length) return { min: 1, max: 1, next: i }
  const c = pattern[i]!
  if (c === '*') return { min: 0, max: MAX_QUANTIFIER_REPEAT, next: i + 1 }
  if (c === '+') return { min: 1, max: MAX_QUANTIFIER_REPEAT, next: i + 1 }
  if (c === '?') return { min: 0, max: 1, next: i + 1 }
  if (c === '{') {
    const end = pattern.indexOf('}', i)
    if (end === -1) return { min: 1, max: 1, next: i }
    const inner = pattern.slice(i + 1, end)
    const m = inner.match(/^(\d+)(?:,(\d*))?$/)
    if (!m) return { min: 1, max: 1, next: end + 1 }
    const a = parseInt(m[1]!, 10)
    if (m[2] === undefined) return { min: a, max: a, next: end + 1 }
    if (m[2] === '') return { min: a, max: MAX_QUANTIFIER_REPEAT, next: end + 1 }
    const b = parseInt(m[2]!, 10)
    return { min: Math.min(a, b), max: Math.max(a, b), next: end + 1 }
  }
  return { min: 1, max: 1, next: i }
}

function repeatGenerated(
  genOne: () => string,
  min: number,
  max: number,
  rnd: () => number
): string {
  const lo = Math.max(0, min)
  const hi = Math.max(lo, max)
  const n = lo === hi ? lo : randomInt(lo, hi, rnd)
  let s = ''
  for (let k = 0; k < n; k++) s += genOne()
  return s
}

function charFromEscape(e: string, rnd: () => number): string {
  switch (e) {
    case 'd':
      return String(randomInt(0, 9, rnd))
    case 'D': {
      const pool = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!@#%'
      return pick(pool.split(''), rnd)!
    }
    case 'w':
      return pick((ALNUM + WORD_EXTRA).split(''), rnd)!
    case 'W': {
      const pool = ' !@#$%^&*()[]{};:,.<>?/'
      return pick(pool.split(''), rnd)!
    }
    case 's':
      return pick(SPACE_CHARS.split(''), rnd)!
    case 'S':
      return pick(ALNUM.split(''), rnd)!
    case 't':
      return '\t'
    case 'n':
      return '\n'
    default:
      return e
  }
}

function parseCharClass(
  pattern: string,
  start: number,
  rnd: () => number
): { pool: string[]; next: number } {
  // start at '['
  let i = start + 1
  let negated = false
  if (i < pattern.length && pattern[i] === '^') {
    negated = true
    i++
  }
  const set = new Set<string>()
  while (i < pattern.length && pattern[i] !== ']') {
    if (pattern[i] === '\\' && i + 1 < pattern.length) {
      const e = pattern[i + 1]!
      i += 2
      if (e === 'd') {
        for (const ch of '0123456789') set.add(ch)
      } else if (e === 'w') {
        for (const ch of ALNUM + WORD_EXTRA) set.add(ch)
      } else if (e === 's') {
        for (const ch of SPACE_CHARS) set.add(ch)
      } else {
        set.add(charFromEscape(e, rnd))
      }
      continue
    }
    const a = pattern[i]!
    if (
      i + 2 < pattern.length &&
      pattern[i + 1] === '-' &&
      pattern[i + 2] !== ']' &&
      pattern[i + 2] !== '\\'
    ) {
      const b = pattern[i + 2]!
      const ca = a.charCodeAt(0)
      const cb = b.charCodeAt(0)
      const from = Math.min(ca, cb)
      const to = Math.max(ca, cb)
      for (let c = from; c <= to; c++) set.add(String.fromCharCode(c))
      i += 3
      continue
    }
    set.add(a)
    i++
  }
  const end = i < pattern.length && pattern[i] === ']' ? i + 1 : i
  let pool: string[]
  if (negated) {
    pool = DEFAULT_CLASS_UNIVERSE.split('').filter((c) => !set.has(c))
    if (pool.length === 0) pool = ['x']
  } else {
    pool = [...set]
    if (pool.length === 0) pool = ['x']
  }
  return { pool, next: end }
}

/**
 * 由正则子集生成字符串：支持 . \d \w \s 及转义、[]、* + ? {n} {n,m}；用于 regex(\d{6}) 等。
 */
export function genFromRegex(pattern: string, rnd: () => number): string {
  let i = 0
  let out = ''

  const consumePiece = (): void => {
    if (i >= pattern.length) return

    if (pattern[i] === '[') {
      const { pool, next } = parseCharClass(pattern, i, rnd)
      i = next
      const q = readQuantifier(pattern, i)
      i = q.next
      out += repeatGenerated(() => pick(pool, rnd), q.min, q.max, rnd)
      return
    }

    if (pattern[i] === '\\' && i + 1 < pattern.length) {
      const e = pattern[i + 1]!
      i += 2
      const q = readQuantifier(pattern, i)
      i = q.next
      out += repeatGenerated(() => charFromEscape(e, rnd), q.min, q.max, rnd)
      return
    }

    if (pattern[i] === '.') {
      i++
      const q = readQuantifier(pattern, i)
      i = q.next
      out += repeatGenerated(
        () => String.fromCharCode(97 + randomInt(0, 25, rnd)),
        q.min,
        q.max,
        rnd
      )
      return
    }

    const lit = pattern[i]!
    i++
    const q = readQuantifier(pattern, i)
    i = q.next
    out += repeatGenerated(() => lit, q.min, q.max, rnd)
  }

  while (i < pattern.length) {
    consumePiece()
  }
  return out
}

function normalizeRegexArg(args: string): string {
  let p = args.trim()
  const m = p.match(/^\/(.*)\/([gimsuy]*)$/)
  if (m) return m[1]!
  return p
}

const CALL_RULE_NAMES = new Set([
  'fixed',
  'string',
  'int',
  'decimal',
  'date',
  'datetime',
  'enum',
  'regex'
])

const KEYWORD_RULES = new Set([
  'name',
  'phone',
  'email',
  'address',
  'timestamp',
  'uuid',
  'increment'
])

function validateSegment(seg: string): string | null {
  const s = seg.trim()
  if (!s) return '规则有误：存在空片段'

  const call = parseRuleCall(s)
  if (call) {
    if (!CALL_RULE_NAMES.has(call.name)) {
      return `规则有误：未知规则 ${call.name}`
    }
    const args = splitTopLevelArgs(call.args)
    switch (call.name) {
      case 'string': {
        const n = parseInt(args[0] ?? '', 10)
        if (!args[0] || Number.isNaN(n) || n < 1) {
          return '规则有误：string 须为正整数长度，如 string(8)'
        }
        break
      }
      case 'int': {
        if (args.length < 2) return '规则有误：int 须为 int(小,大)'
        const a = parseInt(args[0]!, 10)
        const b = parseInt(args[1]!, 10)
        if (Number.isNaN(a) || Number.isNaN(b)) return '规则有误：int 参数须为整数'
        break
      }
      case 'decimal': {
        if (args.length < 3) return '规则有误：decimal 须为 decimal(小,大,小数位)'
        const min = parseFloat(args[0]!)
        const max = parseFloat(args[1]!)
        const scale = parseInt(args[2]!, 10)
        if (Number.isNaN(min) || Number.isNaN(max) || Number.isNaN(scale) || scale < 0) {
          return '规则有误：decimal 参数无效'
        }
        break
      }
      case 'date':
      case 'datetime': {
        if (args.length < 2) return `规则有误：${call.name} 须为 ${call.name}(年1,年2)`
        const y1 = parseInt(args[0]!, 10)
        const y2 = parseInt(args[1]!, 10)
        if (Number.isNaN(y1) || Number.isNaN(y2)) return '规则有误：年份须为数字'
        break
      }
      case 'enum': {
        if (args.length < 1 || args.every((x) => !x.trim())) {
          return '规则有误：enum 至少包含一个选项'
        }
        break
      }
      case 'regex': {
        if (!call.args.trim()) return '规则有误：regex 模式不能为空'
        try {
          genFromRegex(normalizeRegexArg(call.args), () => 0.5)
        } catch {
          return '规则有误：regex 模式无法解析'
        }
        break
      }
      case 'fixed':
        break
      default:
        break
    }
    return null
  }

  if (KEYWORD_RULES.has(s)) return null
  if (s.includes('(') || s.includes(')')) {
    return '规则有误：括号不匹配或无法解析'
  }
  return null
}

/** 校验整条规则表达式（含 + 拼接） */
export function validateRuleExpr(expr: string): { valid: boolean; message?: string } {
  const t = expr.trim()
  if (!t) return { valid: false, message: '规则有误：不能为空' }
  const parts = splitTopLevelPlus(t)
  for (const p of parts) {
    const err = validateSegment(p)
    if (err) return { valid: false, message: err }
  }
  return { valid: true }
}

const TYPE_MISMATCH = '类型与规则不匹配：'

/** 字段类型与生成规则须一致（如 int 类型不可写 SKP+string(8)） */
export function validateTypeRuleConsistency(
  fieldType: string,
  ruleExpr: string
): { ok: boolean; message?: string } {
  const t = ruleExpr.trim()
  if (!t) return { ok: true }
  const parts = splitTopLevelPlus(t)
  const multi = parts.length > 1
  const call = parseRuleCall(t)
  const callName = call?.name

  const fail = (msg: string) => ({ ok: false as const, message: TYPE_MISMATCH + msg })

  switch (fieldType) {
    case 'int': {
      if (multi) return fail('int 类型只能使用 int(小,大)，不能使用 + 拼接')
      if (callName !== 'int') return fail('须为 int(小,大)')
      return { ok: true }
    }
    case 'decimal': {
      if (multi) return fail('decimal 类型只能使用 decimal(小,大,小数位)，不能使用 + 拼接')
      if (callName !== 'decimal') return fail('须为 decimal(小,大,小数位)')
      return { ok: true }
    }
    case 'date': {
      if (multi) return fail('date 类型只能使用 date(年1,年2)，不能使用 + 拼接')
      if (callName !== 'date') return fail('须为 date(年1,年2)')
      return { ok: true }
    }
    case 'datetime': {
      if (multi) return fail('datetime 类型只能使用 datetime(年1,年2)，不能使用 + 拼接')
      if (callName !== 'datetime') return fail('须为 datetime(年1,年2)')
      return { ok: true }
    }
    case 'timestamp': {
      if (t !== 'timestamp') return fail('须为关键字 timestamp')
      return { ok: true }
    }
    case 'bool': {
      if (callName !== 'enum') return fail('bool 类型须使用 enum(true,false) 等形式')
      return { ok: true }
    }
    case 'phone': {
      if (t !== 'phone') return fail('须为关键字 phone')
      return { ok: true }
    }
    case 'email': {
      if (t !== 'email') return fail('须为关键字 email')
      return { ok: true }
    }
    case 'uuid': {
      if (t !== 'uuid') return fail('须为关键字 uuid')
      return { ok: true }
    }
    case 'increment': {
      if (t !== 'increment') return fail('须为关键字 increment')
      return { ok: true }
    }
    case 'name': {
      if (t !== 'name') return fail('须为关键字 name')
      return { ok: true }
    }
    case 'address': {
      if (t !== 'address') return fail('须为关键字 address')
      return { ok: true }
    }
    case 'regex': {
      if (callName !== 'regex') return fail('须为 regex(模式)')
      return { ok: true }
    }
    case 'fixed': {
      if (callName !== 'fixed') return fail('须为 fixed(文本)')
      return { ok: true }
    }
    case 'enum': {
      if (callName !== 'enum') return fail('须为 enum(选项1,选项2,...)')
      return { ok: true }
    }
    case 'string': {
      if (callName === 'string' || callName === 'fixed' || callName === 'regex') return { ok: true }
      if (multi) {
        const hasString = parts.some((p) => parseRuleCall(p.trim())?.name === 'string')
        if (hasString) return { ok: true }
        return fail('使用 + 拼接时须包含 string(长度)，例如 SKP+string(8)')
      }
      if (!t.includes('(') && !t.includes(')')) return { ok: true }
      return fail('须为 string(长度)、fixed(...)、regex(...) 或 前缀+string(长度)，或纯文本字面量')
    }
    default:
      return { ok: true }
  }
}

/** 语法 + 类型一致性；fieldType 为空时仅校验语法 */
export function validateFieldRule(
  fieldType: string | undefined,
  ruleExpr: string
): { valid: boolean; message?: string } {
  const syn = validateRuleExpr(ruleExpr)
  if (!syn.valid) return syn
  if (fieldType) {
    const tc = validateTypeRuleConsistency(fieldType, ruleExpr)
    if (!tc.ok) return { valid: false, message: tc.message }
  }
  return { valid: true }
}

/** 与字段类型对应的默认规则（智能推荐兜底） */
export function defaultRuleForFieldType(fieldType: string): string {
  switch (fieldType) {
    case 'int':
      return 'int(1,100)'
    case 'decimal':
      return 'decimal(0,100,2)'
    case 'date':
      return 'date(2020,2025)'
    case 'datetime':
      return 'datetime(2020,2025)'
    case 'timestamp':
      return 'timestamp'
    case 'bool':
      return 'enum(true,false)'
    case 'phone':
      return 'phone'
    case 'email':
      return 'email'
    case 'uuid':
      return 'uuid'
    case 'enum':
      return 'enum(A,B,C)'
    case 'name':
      return 'name'
    case 'address':
      return 'address'
    case 'regex':
      return 'regex(\\d{6})'
    case 'fixed':
      return 'fixed(默认值)'
    case 'increment':
      return 'increment'
    case 'string':
    default:
      return 'SKP+string(8)'
  }
}

/** 固定种子生成一条示例值，用于界面预览 */
export function previewRuleSample(
  ruleExpr: string,
  fieldKey = '__preview__',
  fieldType?: string
): {
  ok: boolean
  preview?: string
  error?: string
} {
  const v = validateFieldRule(fieldType, ruleExpr)
  if (!v.valid) return { ok: false, error: v.message ?? '规则有误' }
  try {
    const rnd = createRandom('tdg-rule-preview-v1')
    const ctx: GenerateContext = {
      rowIndex: 0,
      incrementCounters: new Map(),
      random: rnd
    }
    const val = generateValue(ruleExpr, fieldKey, ctx)
    return { ok: true, preview: String(val) }
  } catch {
    return { ok: false, error: '规则有误' }
  }
}

function generateValueSingle(
  ruleExpr: string,
  fieldKey: string,
  ctx: GenerateContext
): string | number {
  const raw = ruleExpr.trim()
  const rnd = ctx.random

  const call = parseRuleCall(raw)
  if (call) {
    const args = splitTopLevelArgs(call.args)
    switch (call.name) {
      case 'fixed':
        return call.args
      case 'string': {
        const len = Math.max(1, parseInt(args[0] ?? '8', 10) || 8)
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
        let s = ''
        for (let j = 0; j < len; j++) s += chars[randomInt(0, chars.length - 1, rnd)]!
        return s
      }
      case 'int': {
        const a = parseInt(args[0] ?? '0', 10)
        const b = parseInt(args[1] ?? '100', 10)
        return randomInt(Math.min(a, b), Math.max(a, b), rnd)
      }
      case 'decimal': {
        const min = parseFloat(args[0] ?? '0')
        const max = parseFloat(args[1] ?? '100')
        const scale = Math.max(0, parseInt(args[2] ?? '2', 10) || 2)
        const lo = Math.min(min, max)
        const hi = Math.max(min, max)
        const v = lo + rnd() * (hi - lo)
        return Number(v.toFixed(scale))
      }
      case 'date': {
        const y1 = parseInt(args[0] ?? '2020', 10)
        const y2 = parseInt(args[1] ?? '2025', 10)
        const y = randomInt(Math.min(y1, y2), Math.max(y1, y2), rnd)
        const m = randomInt(1, 12, rnd)
        const dim = daysInMonth(y, m)
        const d = randomInt(1, dim, rnd)
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      }
      case 'datetime': {
        const y1 = parseInt(args[0] ?? '2020', 10)
        const y2 = parseInt(args[1] ?? '2025', 10)
        const y = randomInt(Math.min(y1, y2), Math.max(y1, y2), rnd)
        const m = randomInt(1, 12, rnd)
        const dim = daysInMonth(y, m)
        const d = randomInt(1, dim, rnd)
        const hh = randomInt(0, 23, rnd)
        const mm = randomInt(0, 59, rnd)
        const ss = randomInt(0, 59, rnd)
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
      }
      case 'enum':
        if (args.length === 0) return ''
        return pick(args.map(stripEnumToken), rnd) ?? ''
      case 'regex': {
        const inner = normalizeRegexArg(call.args)
        try {
          return genFromRegex(inner, rnd)
        } catch {
          return ''
        }
      }
      default:
        break
    }
  }

  switch (raw) {
    case 'name':
      return pick(CN_SURNAMES, rnd)! + pick(CN_GIVEN, rnd)! + pick(CN_GIVEN, rnd)!
    case 'phone':
      return `1${randomInt(3, 9, rnd)}${randomDigits(9, rnd)}`
    case 'email': {
      const user = `u${randomDigits(8, rnd)}`
      const domain = pick(['mail', 'qq', '163', 'test', 'example'], rnd)
      return `${user}@${domain}.com`
    }
    case 'address':
      return `北京市朝阳区测试路${randomInt(1, 999, rnd)}号`
    case 'timestamp':
      return Date.now() - randomInt(0, 86400000 * 365 * 5, rnd)
    case 'uuid': {
      const hex = '0123456789abcdef'
      let u = ''
      for (let j = 0; j < 32; j++) u += hex[randomInt(0, 15, rnd)]!
      return `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`
    }
    case 'increment': {
      const prev = ctx.incrementCounters.get(fieldKey) ?? 0
      const next = prev + 1
      ctx.incrementCounters.set(fieldKey, next)
      return next
    }
    default:
      return raw
  }
}

/**
 * 生成规则值。支持最外层 `+` 拼接（如 SKP+string(8)），其余见 generateValueSingle。
 */
export function generateValue(
  ruleExpr: string,
  fieldKey: string,
  ctx: GenerateContext
): string | number {
  const raw = ruleExpr.trim()
  if (!raw) return ''
  const parts = splitTopLevelPlus(raw)
  if (parts.length === 0) return ''
  if (parts.length > 1) {
    return parts.map((p) => String(generateValueSingle(p.trim(), fieldKey, ctx))).join('')
  }
  return generateValueSingle(parts[0]!.trim(), fieldKey, ctx)
}

export function createRandom(seed?: string): () => number {
  if (!seed) return Math.random
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  let state = h >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}
