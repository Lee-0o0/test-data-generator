import OpenAI from 'openai'
import { buildAiFieldTypesContext } from './aiFieldTypesContext'
import { MOONSHOT_API_BASE, OPENROUTER_API_BASE } from './aiProviderEndpoints'
import { inferFieldTypeAndRuleFromName } from './fieldNameInference'
import { appendAiRequestLog, writeLastGeminiMeta, writeLastGeminiPromptFile, writeLastAiResponseText } from './aiLog'
import { fetchWithOptionalProxy, getOutboundProxyUrl, maskProxyUrl } from './outboundFetch'
import {
  getEffectiveAiSuggestProvider,
  getEffectiveGeminiApiKey,
  getEffectiveGeminiModel,
  getEffectiveKimiApiKey,
  getEffectiveKimiModel,
  getEffectiveOpenRouterApiKey,
  getEffectiveOpenRouterModel,
  type AiSuggestProviderMode
} from './settingsStore'
import { defaultRuleForFieldType, previewRuleSample, validateFieldRule } from './ruleEngine'

export type FieldRuleInput = { field_name: string; field_type: string }

/** 智能推荐单字段结果 */
export type SuggestRulesEntry = {
  rule_expr: string
  /** 模型或本地推断后建议的类型；存在时界面会切换类型并套用预设备注 */
  field_type?: string
  /** 与 rule 一致的示例值（主进程用引擎预览生成，保证合法） */
  sample_value?: string
}
export type SuggestRulesResult = Record<string, SuggestRulesEntry>

const ALLOWED_FIELD_TYPES = new Set([
  'string',
  'int',
  'decimal',
  'date',
  'datetime',
  'timestamp',
  'bool',
  'phone',
  'email',
  'uuid',
  'enum',
  'name',
  'address',
  'regex',
  'fixed',
  'increment'
])

function normalizeFieldType(raw: string | undefined): string | null {
  if (!raw) return null
  const t = raw.trim().toLowerCase()
  const aliases: Record<string, string> = {
    str: 'string',
    text: 'string',
    varchar: 'string',
    文本: 'string',
    字符串: 'string',
    integer: 'int',
    整数: 'int',
    number: 'decimal',
    float: 'decimal',
    double: 'decimal',
    money: 'decimal',
    小数: 'decimal',
    金额: 'decimal',
    日期: 'date',
    生日: 'date',
    时间: 'datetime',
    日期时间: 'datetime',
    时间戳: 'timestamp',
    unix: 'timestamp',
    boolean: 'bool',
    布尔: 'bool',
    手机: 'phone',
    手机号: 'phone',
    mobile: 'phone',
    tel: 'phone',
    邮箱: 'email',
    mail: 'email',
    枚举: 'enum',
    姓名: 'name',
    名字: 'name',
    联系人: 'name',
    地址: 'address',
    正则: 'regex',
    固定: 'fixed',
    literal: 'fixed',
    自增: 'increment',
    serial: 'increment'
  }
  const mapped = aliases[t]
  if (mapped && ALLOWED_FIELD_TYPES.has(mapped)) return mapped
  if (ALLOWED_FIELD_TYPES.has(t)) return t
  return null
}

type RawStructuredEntry =
  | string
  | {
      field_type?: string
      rule_expr?: string
      sample_value?: string
    }

/** 解析 Gemini / 结构化 JSON，统一校验并生成 sample_value（引擎预览优先） */
function sanitizeStructuredSuggest(
  fields: FieldRuleInput[],
  obj: Record<string, RawStructuredEntry>
): SuggestRulesResult {
  const out: SuggestRulesResult = {}
  for (const f of fields) {
    const name = f.field_name
    const raw = obj[name]
    let fieldType: string
    let ruleExpr: string
    let modelSample = ''

    if (typeof raw === 'string') {
      fieldType = f.field_type || 'string'
      ruleExpr = raw.trim()
    } else if (raw && typeof raw === 'object') {
      fieldType =
        normalizeFieldType(raw.field_type) ?? (f.field_type || 'string')
      ruleExpr = (raw.rule_expr ?? '').trim()
      if (raw.sample_value != null) {
        modelSample = String(raw.sample_value).trim()
      }
    } else {
      fieldType = f.field_type || 'string'
      ruleExpr = ''
    }

    if (!ruleExpr || !validateFieldRule(fieldType, ruleExpr).valid) {
      const inf = inferFieldTypeAndRuleFromName(f.field_name)
      if (inf && validateFieldRule(inf.field_type, inf.rule_expr).valid) {
        fieldType = inf.field_type
        ruleExpr = inf.rule_expr
      } else {
        fieldType = f.field_type || 'string'
        ruleExpr = defaultRuleForFieldType(fieldType)
      }
    }

    const pv = previewRuleSample(ruleExpr, name.trim() || '__f__', fieldType)
    const sample_value = pv.ok ? String(pv.preview) : modelSample || ''

    out[name] = {
      rule_expr: ruleExpr,
      field_type: fieldType,
      sample_value
    }
  }
  return out
}

function buildStructuredSuggestPrompt(fields: FieldRuleInput[]): string {
  const context = buildAiFieldTypesContext()
  const userPayload = JSON.stringify(
    fields.map((f) => ({ field_name: f.field_name, current_field_type: f.field_type }))
  )
  return `${context}

## 待配置字段（JSON 数组，请结合 field_name 语义与 current_field_type 参考，输出更合理的类型与规则）
${userPayload}`
}

function parseStructuredResponseToSuggest(
  text: string,
  fields: FieldRuleInput[]
): SuggestRulesResult {
  let obj: Record<string, RawStructuredEntry>
  try {
    obj = JSON.parse(text) as Record<string, RawStructuredEntry>
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) {
      throw new Error('模型返回非 JSON')
    }
    obj = JSON.parse(m[0]) as Record<string, RawStructuredEntry>
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('JSON 须为对象')
  }
  return sanitizeStructuredSuggest(fields, obj)
}

async function geminiGenerateContent(apiKey: string, modelId: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelId
  )}:generateContent`
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  }
  const bodyStr = JSON.stringify(body)

  writeLastGeminiPromptFile(prompt)
  writeLastGeminiMeta({
    url,
    modelId,
    usedProxy: Boolean(getOutboundProxyUrl()),
    proxy: maskProxyUrl(getOutboundProxyUrl()) ?? 'none',
    connectTimeoutMs: 120_000,
    promptChars: prompt.length
  })

  appendAiRequestLog({
    provider: 'gemini',
    event: 'request',
    summary: `POST generateContent`,
    detail: {
      url,
      modelId,
      promptChars: prompt.length,
      fullPromptFile: 'last-gemini-prompt.txt',
      generationConfig: body.generationConfig,
      proxy: maskProxyUrl(getOutboundProxyUrl()) ?? 'none',
      note: 'Electron 主进程 fetch 默认不读系统代理；已用 HTTPS_PROXY/GEMINI_HTTPS_PROXY 时走 undici ProxyAgent'
    }
  })

  let res: Response
  try {
    res = await fetchWithOptionalProxy(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: bodyStr,
      timeoutMs: 120_000
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const c = e instanceof Error && e.cause != null ? String(e.cause) : ''
    appendAiRequestLog({
      provider: 'gemini',
      event: 'error',
      summary: msg + (c ? ` | cause: ${c}` : ''),
      detail: {
        hint: '连接超时或失败：请设置环境变量 HTTPS_PROXY=http://127.0.0.1:端口（或 GEMINI_HTTPS_PROXY）后重启应用，并确保本地代理已开启'
      }
    })
    throw e
  }

  const rawText = await res.text()
  writeLastAiResponseText('gemini', rawText.slice(0, 500_000))

  if (!res.ok) {
    appendAiRequestLog({
      provider: 'gemini',
      event: 'error',
      summary: `HTTP ${res.status}`,
      detail: { bodyPreview: rawText.slice(0, 4000) }
    })
    throw new Error(`Gemini HTTP ${res.status}: ${rawText.slice(0, 800)}`)
  }

  let data: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    error?: { message?: string }
  }
  try {
    data = JSON.parse(rawText) as typeof data
  } catch {
    appendAiRequestLog({
      provider: 'gemini',
      event: 'error',
      summary: '响应 JSON 解析失败',
      detail: { bodyPreview: rawText.slice(0, 4000) }
    })
    throw new Error('Gemini 响应 JSON 解析失败')
  }
  if (data.error?.message) {
    appendAiRequestLog({
      provider: 'gemini',
      event: 'error',
      summary: data.error.message
    })
    throw new Error(data.error.message)
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (text == null || !String(text).trim()) {
    appendAiRequestLog({
      provider: 'gemini',
      event: 'error',
      summary: 'Gemini 未返回文本内容',
      detail: { topLevelKeys: Object.keys(data) }
    })
    throw new Error('Gemini 未返回文本内容')
  }
  const out = String(text).trim()
  appendAiRequestLog({
    provider: 'gemini',
    event: 'response',
    summary: `ok, textChars=${out.length}`,
    detail: {
      textPreview:
        out.length > 12_000
          ? `${out.slice(0, 6000)}\n...(省略)...\n${out.slice(-3000)}`
          : out
    }
  })
  return out
}

async function suggestWithGemini(
  fields: FieldRuleInput[],
  apiKey: string
): Promise<SuggestRulesResult> {
  const modelId = getEffectiveGeminiModel()
  const prompt = buildStructuredSuggestPrompt(fields)
  const text = await geminiGenerateContent(apiKey, modelId, prompt)
  return parseStructuredResponseToSuggest(text, fields)
}

function resolveAiSuggestOrder(
  mode: AiSuggestProviderMode
): Array<'gemini' | 'openrouter' | 'kimi'> {
  switch (mode) {
    case 'openrouter_first':
      return ['openrouter', 'gemini', 'kimi']
    case 'kimi_first':
      return ['kimi', 'gemini', 'openrouter']
    case 'gemini_only':
      return ['gemini']
    case 'openrouter_only':
      return ['openrouter']
    case 'kimi_only':
      return ['kimi']
    case 'auto':
    default:
      return ['gemini', 'openrouter', 'kimi']
  }
}

/**
 * OpenRouter / Kimi（Moonshot）：OpenAI 兼容 Chat Completions，固定 Base URL，仅 Key 与模型 ID 来自设置。
 */
async function suggestWithOpenAiCompatibleStructured(
  fields: FieldRuleInput[],
  kind: 'openrouter' | 'kimi'
): Promise<SuggestRulesResult> {
  const apiKey =
    kind === 'openrouter' ? getEffectiveOpenRouterApiKey() : getEffectiveKimiApiKey()
  if (!apiKey) {
    throw new Error(kind === 'openrouter' ? '未配置 OpenRouter API Key' : '未配置 Kimi（Moonshot）API Key')
  }
  const baseURL = kind === 'openrouter' ? OPENROUTER_API_BASE : MOONSHOT_API_BASE
  const model =
    kind === 'openrouter' ? getEffectiveOpenRouterModel() : getEffectiveKimiModel()
  const defaultHeaders =
    kind === 'openrouter'
      ? {
          'HTTP-Referer': 'https://testdata-generator.local',
          'X-Title': 'Test Data Generator'
        }
      : undefined

  const client = new OpenAI({
    apiKey,
    baseURL,
    defaultHeaders
  })
  const prompt = buildStructuredSuggestPrompt(fields)

  appendAiRequestLog({
    provider: kind,
    event: 'request',
    summary: `chat.completions model=${model}`,
    detail: {
      baseURL,
      fields,
      promptChars: prompt.length,
      promptPreview:
        prompt.length > 8000
          ? `${prompt.slice(0, 5000)}\n...(省略)...\n${prompt.slice(-2000)}`
          : prompt,
      ...(kind === 'openrouter' ? { reasoning: { enabled: true } } : {})
    }
  })

  let text: string
  try {
    // OpenRouter 扩展字段：reasoning（与官方 curl 示例一致；不支持的模型会忽略）
    const baseReq = {
      model,
      messages: [{ role: 'user' as const, content: prompt }],
      temperature: 0.2
    }
    const res = await client.chat.completions.create(
      kind === 'openrouter'
        ? ({ ...baseReq, reasoning: { enabled: true } } as Parameters<
            typeof client.chat.completions.create
          >[0])
        : baseReq
    )
    text = res.choices[0]?.message?.content?.trim() ?? ''
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    appendAiRequestLog({
      provider: kind,
      event: 'error',
      summary: msg
    })
    console.error(`[tdg] ${kind} suggest failed:`, e)
    throw e
  }

  writeLastAiResponseText(kind, text.slice(0, 500_000))
  appendAiRequestLog({
    provider: kind,
    event: 'response',
    summary: `ok, textChars=${text.length}`,
    detail: {
      textPreview:
        text.length > 12_000
          ? `${text.slice(0, 6000)}\n...(省略)...\n${text.slice(-3000)}`
          : text
    }
  })

  return parseStructuredResponseToSuggest(text, fields)
}

/**
 * 智能推荐：Gemini / OpenRouter / Kimi 按 ai_suggest_provider 顺序尝试；仅配置 Key 的提供商会参与。
 */
export async function suggestRulesForFields(
  fields: FieldRuleInput[]
): Promise<SuggestRulesResult> {
  if (fields.length === 0) return {}

  const mode = getEffectiveAiSuggestProvider()
  const order = resolveAiSuggestOrder(mode)

  appendAiRequestLog({
    provider: 'local',
    event: 'request',
    summary: `智能推荐策略: ${mode}，尝试顺序: ${order.join(' → ')}`,
    detail: { fieldCount: fields.length }
  })

  for (const target of order) {
    try {
      if (target === 'gemini') {
        const geminiKey = getEffectiveGeminiApiKey()
        if (!geminiKey) continue
        return await suggestWithGemini(fields, geminiKey)
      }
      if (target === 'openrouter') {
        const k = getEffectiveOpenRouterApiKey()
        if (!k) continue
        return await suggestWithOpenAiCompatibleStructured(fields, 'openrouter')
      }
      if (target === 'kimi') {
        const k = getEffectiveKimiApiKey()
        if (!k) continue
        return await suggestWithOpenAiCompatibleStructured(fields, 'kimi')
      }
    } catch (e) {
      console.error(`[tdg] ${target} suggest failed:`, e)
      if (mode === 'gemini_only' || mode === 'openrouter_only' || mode === 'kimi_only') {
        break
      }
      continue
    }
  }

  return heuristicSuggest(fields)
}

function heuristicSuggest(fields: FieldRuleInput[]): SuggestRulesResult {
  const out: SuggestRulesResult = {}
  for (const f of fields) {
    const inferred = inferFieldTypeAndRuleFromName(f.field_name)
    if (inferred) {
      const v = validateFieldRule(inferred.field_type, inferred.rule_expr)
      if (v.valid) {
        const pv = previewRuleSample(inferred.rule_expr, f.field_name.trim() || '__f__', inferred.field_type)
        out[f.field_name] = {
          rule_expr: inferred.rule_expr,
          field_type: inferred.field_type,
          sample_value: pv.ok ? String(pv.preview) : undefined
        }
        continue
      }
    }

    const t = f.field_type || 'string'
    const n = f.field_name.toLowerCase()
    let rule = defaultRuleForFieldType(t)
    switch (t) {
      case 'int':
        if (n.includes('count') || n.includes('num') || n.includes('qty')) rule = 'int(0,9999)'
        break
      case 'decimal':
        if (n.includes('amount') || n.includes('price') || n.includes('money')) rule = 'decimal(0,100000,2)'
        break
      case 'enum':
        if (n.includes('status') || n.includes('state')) rule = 'enum(ACTIVE,INACTIVE,PENDING)'
        else if (n.includes('type')) rule = 'enum(TYPE_A,TYPE_B,TYPE_C)'
        break
      case 'string':
        rule = 'SKP+string(8)'
        break
      default:
        break
    }
    if (!validateFieldRule(t, rule).valid) {
      rule = defaultRuleForFieldType(t)
    }
    const pv = previewRuleSample(rule, f.field_name.trim() || '__f__', t)
    out[f.field_name] = {
      rule_expr: rule,
      sample_value: pv.ok ? String(pv.preview) : undefined
    }
  }
  return out
}
