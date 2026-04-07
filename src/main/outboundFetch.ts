import { fetch, ProxyAgent } from 'undici'
import type { Dispatcher } from 'undici'

const agents = new Map<string, ProxyAgent>()

/** 由 settingsStore.reloadSettings() 根据数据库 + 环境变量写入；未初始化前为空 */
let activeProxyUrl: string | undefined

/** 应用启动或修改设置后刷新代理时调用，会清空已缓存的 ProxyAgent */
export function setOutboundProxyUrl(url: string | undefined): void {
  agents.clear()
  const t = url?.trim()
  activeProxyUrl = t || undefined
}

export function getOutboundProxyUrl(): string | undefined {
  return activeProxyUrl
}

/** 日志中展示代理地址（隐去 path、用户名密码） */
export function maskProxyUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url)
    const port = u.port || (u.protocol === 'https:' ? '443' : '80')
    return `${u.protocol}//${u.hostname}:${port}`
  } catch {
    return '[invalid-proxy-url]'
  }
}

function getDispatcher(proxyUrl: string | undefined): Dispatcher | undefined {
  if (!proxyUrl) return undefined
  let a = agents.get(proxyUrl)
  if (!a) {
    a = new ProxyAgent(proxyUrl)
    agents.set(proxyUrl, a)
  }
  return a
}

/**
 * 带可选 HTTP(S) 代理的出站请求；默认超时 120s（直连 Google 易触发 10s 默认超时）。
 * Node/Electron 全局 fetch 不读 HTTPS_PROXY，故 Gemini 等需显式走此封装。
 */
export async function fetchWithOptionalProxy(
  url: string,
  init: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const proxy = getOutboundProxyUrl()
  const timeoutMs = init.timeoutMs ?? 120_000
  const { timeoutMs: _drop, ...rest } = init
  const dispatcher = getDispatcher(proxy)
  const signal = AbortSignal.timeout(timeoutMs)
  return fetch(url, {
    ...rest,
    dispatcher,
    signal
  } as Parameters<typeof fetch>[1]) as unknown as Response
}
