import OpenAI from 'openai'

/**
 * Node 端可直接调用 OpenAI 兼容 API（含自建网关）。
 * 在环境变量中配置：OPENAI_API_KEY、OPENAI_BASE_URL（可选）
 */
export async function suggestRulesForFields(
  fieldNames: string[]
): Promise<Record<string, string>> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return heuristicSuggest(fieldNames)
  }
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL
  })
  const prompt = `你是测试数据规则助手。根据字段名，为每个字段返回一条 rule_expr（不要解释）。
可用规则（与引擎一致）：
fixed(任意固定文本)、string(长度)、int(小,大)、decimal(小,大,小数位)、name、phone、email、address、
date(年1,年2)、timestamp、uuid、enum(A,B,C)、increment、regex(模式) 如 regex(\\d{6})
仅输出 JSON 对象，键为字段名，值为规则字符串。
字段：${JSON.stringify(fieldNames)}`

  const res = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2
  })
  const text = res.choices[0]?.message?.content?.trim() ?? '{}'
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  const raw = jsonMatch ? jsonMatch[0] : text
  try {
    const obj = JSON.parse(raw) as Record<string, string>
    return obj
  } catch {
    return heuristicSuggest(fieldNames)
  }
}

function heuristicSuggest(fieldNames: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of fieldNames) {
    const n = name.toLowerCase()
    if (n.includes('phone') || n === 'mobile' || n === 'tel') out[name] = 'phone'
    else if (n.includes('email') || n === 'mail') out[name] = 'email'
    else if (n.includes('address') || n.includes('addr')) out[name] = 'address'
    else if (n.includes('name') || n.includes('username') || n === 'nickname') out[name] = 'name'
    else if (n.includes('amount') || n.includes('price') || n.includes('money')) out[name] = 'decimal(0,10000,2)'
    else if (n.includes('timestamp') || n.endsWith('_ts')) out[name] = 'timestamp'
    else if (n.includes('time') || n.includes('date') || n.includes('created')) out[name] = 'date(2020,2025)'
    else if (n === 'id' || n.endsWith('_id')) out[name] = 'increment'
    else if (n.includes('uuid')) out[name] = 'uuid'
    else if (n.includes('status') || n.includes('type') || n.includes('state'))
      out[name] = 'enum(ACTIVE,INACTIVE,PENDING)'
    else out[name] = 'string(8)'
  }
  return out
}
