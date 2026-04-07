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

/**
 * 生成规则值。完整支持：
 * fixed(...) string(n) int(a,b) decimal(min,max,scale) date(y1,y2)
 * name phone email address timestamp uuid enum(A,B) increment
 * regex(...)
 */
export function generateValue(
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
