import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/** 与数据库同级的用户数据目录下 ai-logs（可写；安装目录通常不可写） */
export function getAiLogDirPath(): string {
  return join(app.getPath('userData'), 'ai-logs')
}

export function getAiRequestsLogPath(): string {
  return join(getAiLogDirPath(), 'ai-requests.log')
}

export function ensureAiLogDir(): void {
  const dir = getAiLogDirPath()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export type AiLogProvider = 'gemini' | 'openrouter' | 'kimi' | 'local'

export function appendAiRequestLog(entry: {
  provider: AiLogProvider
  event: 'request' | 'response' | 'error'
  summary: string
  detail?: Record<string, unknown>
}): void {
  try {
    ensureAiLogDir()
    const detailStr =
      entry.detail && Object.keys(entry.detail).length > 0
        ? `${JSON.stringify(entry.detail, null, 2)}\n`
        : ''
    const block = `${'='.repeat(72)}\n${new Date().toISOString()} [${entry.provider}] ${entry.event}\n${entry.summary}\n${detailStr}`
    appendFileSync(getAiRequestsLogPath(), block, 'utf8')
  } catch (e) {
    console.error('[tdg] appendAiRequestLog failed:', e)
  }
}

/** 便于单独打开查看的最近一次 Gemini 完整提示词（每次请求覆盖） */
export function writeLastGeminiPromptFile(prompt: string): void {
  try {
    ensureAiLogDir()
    writeFileSync(join(getAiLogDirPath(), 'last-gemini-prompt.txt'), prompt, 'utf8')
  } catch (e) {
    console.error('[tdg] writeLastGeminiPromptFile failed:', e)
  }
}

export function writeLastGeminiMeta(meta: Record<string, unknown>): void {
  try {
    ensureAiLogDir()
    writeFileSync(
      join(getAiLogDirPath(), 'last-gemini-meta.json'),
      `${JSON.stringify(meta, null, 2)}\n`,
      'utf8'
    )
  } catch (e) {
    console.error('[tdg] writeLastGeminiMeta failed:', e)
  }
}

/** 最近一次模型原始返回（成功或失败均可在排错时查看） */
export function writeLastAiResponseText(provider: AiLogProvider, text: string): void {
  try {
    ensureAiLogDir()
    const name =
      provider === 'gemini'
        ? 'last-gemini-response.txt'
        : provider === 'openrouter'
          ? 'last-openrouter-response.txt'
          : provider === 'kimi'
            ? 'last-kimi-response.txt'
            : 'last-ai-response.txt'
    writeFileSync(join(getAiLogDirPath(), name), text, 'utf8')
  } catch (e) {
    console.error('[tdg] writeLastAiResponseText failed:', e)
  }
}
