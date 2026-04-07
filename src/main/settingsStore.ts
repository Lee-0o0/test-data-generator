import { dbapi } from './db'
import { setOutboundProxyUrl } from './outboundFetch'

const SETTING_KEYS = [
  'https_proxy',
  'gemini_api_key',
  'gemini_model',
  'openrouter_api_key',
  'openrouter_model',
  'kimi_api_key',
  'kimi_model',
  'ai_suggest_provider'
] as const

export type SettingKey = (typeof SETTING_KEYS)[number]

export type AppSettings = Record<SettingKey, string>

const defaults: AppSettings = {
  https_proxy: '',
  gemini_api_key: '',
  gemini_model: '',
  openrouter_api_key: '',
  openrouter_model: 'qwen/qwen3.6-plus:free',
  kimi_api_key: '',
  kimi_model: 'moonshot-v1-8k',
  ai_suggest_provider: 'auto'
}

let memory: AppSettings = { ...defaults }

function mergeEnvHttpsProxy(dbValue: string): string {
  const v = dbValue.trim()
  if (v) return v
  return (
    process.env.GEMINI_HTTPS_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.https_proxy?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.http_proxy?.trim() ||
    ''
  )
}

/**
 * 从 app_settings 表加载到内存，并同步出站代理（outboundFetch）。
 * 须在 initDb() 之后调用；程序启动与保存设置后都会执行。
 */
export function reloadSettings(): void {
  const rows = dbapi.prepare('SELECT key, value FROM app_settings').all() as Array<{
    key: string
    value: string | null
  }>
  memory = { ...defaults }
  for (const r of rows) {
    const k = String(r.key)
    if (k in defaults) {
      memory[k as SettingKey] = String(r.value ?? '')
    }
  }
  const effectiveProxy = mergeEnvHttpsProxy(memory.https_proxy)
  setOutboundProxyUrl(effectiveProxy || undefined)
}

export function getMemorySettings(): Readonly<AppSettings> {
  return { ...memory }
}

export function getEffectiveGeminiApiKey(): string {
  return (
    memory.gemini_api_key.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    ''
  )
}

export function getEffectiveGeminiModel(): string {
  return memory.gemini_model.trim() || process.env.GEMINI_MODEL?.trim() || 'gemini-flash-latest'
}

export function getEffectiveOpenRouterApiKey(): string {
  return memory.openrouter_api_key.trim() || process.env.OPENROUTER_API_KEY?.trim() || ''
}

export function getEffectiveOpenRouterModel(): string {
  return (
    memory.openrouter_model.trim() ||
    process.env.OPENROUTER_MODEL?.trim() ||
    'qwen/qwen3.6-plus:free'
  )
}

export function getEffectiveKimiApiKey(): string {
  return (
    memory.kimi_api_key.trim() ||
    process.env.MOONSHOT_API_KEY?.trim() ||
    process.env.KIMI_API_KEY?.trim() ||
    ''
  )
}

export function getEffectiveKimiModel(): string {
  return memory.kimi_model.trim() || process.env.MOONSHOT_MODEL?.trim() || 'moonshot-v1-8k'
}

/**
 * 智能推荐在多 Key 同时存在时的策略（存库值 + 环境变量 AI_SUGGEST_PROVIDER 兜底）。
 * 兼容旧值 openai_first / openai_only → 映射到 OpenRouter。
 */
export type AiSuggestProviderMode =
  | 'auto'
  | 'openrouter_first'
  | 'kimi_first'
  | 'gemini_only'
  | 'openrouter_only'
  | 'kimi_only'

export function getEffectiveAiSuggestProvider(): AiSuggestProviderMode {
  const raw =
    memory.ai_suggest_provider.trim() ||
    process.env.AI_SUGGEST_PROVIDER?.trim() ||
    'auto'
  const m = raw.toLowerCase().replace(/-/g, '_')
  if (m === 'openrouter_first' || m === 'openai_first') return 'openrouter_first'
  if (m === 'kimi_first') return 'kimi_first'
  if (m === 'gemini_only') return 'gemini_only'
  if (m === 'openrouter_only' || m === 'openai_only') return 'openrouter_only'
  if (m === 'kimi_only') return 'kimi_only'
  if (m === 'auto' || m === 'gemini_first' || m === 'default') return 'auto'
  return 'auto'
}

/** 写入数据库并 reloadSettings（刷新内存与代理） */
export function saveSettings(patch: Partial<AppSettings>): void {
  dbapi.transaction(() => {
    const ins = dbapi.prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in defaults)) continue
      ins.run(k, v == null ? '' : String(v))
    }
  })
  reloadSettings()
}

export function isValidSettingKey(k: string): k is SettingKey {
  return k in defaults
}
