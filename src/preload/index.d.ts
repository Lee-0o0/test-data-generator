export {}

declare global {
  interface Window {
    tdg: {
      models: {
        list: () => Promise<unknown[]>
        get: (id: number) => Promise<Record<string, unknown> | undefined>
        create: (payload: { name: string; description?: string }) => Promise<{ id: number }>
        update: (payload: { id: number; name: string; description?: string }) => Promise<void>
        delete: (id: number) => Promise<void>
        copy: (id: number) => Promise<{ id: number }>
      }
      fields: {
        list: (modelId: number) => Promise<unknown[]>
        save: (payload: {
          modelId: number
          fields: Array<{
            field_name: string
            field_type: string
            required: boolean
            rule_expr: string
            sample_value?: string
            remark?: string
            sort_order: number
          }>
        }) => Promise<{ ok: true } | { ok: false; errors: string[] }>
      }
      rule: {
        preview: (
          ruleExpr: string,
          fieldKey?: string,
          fieldType?: string
        ) => Promise<{ ok: true; preview: string } | { ok: false; error?: string }>
      }
      generate: {
        preview: (payload: {
          modelId: number
          count: number
          seed?: string
        }) => Promise<{ fields: unknown[]; rows: Record<string, string | number>[] }>
      }
      export: {
        csv: (payload: {
          modelId: number
          count: number
          seed?: string
          modelName: string
        }) => Promise<
          | { ok: true; filePath: string; durationMs: number; rowCount: number }
          | { ok: false; reason: string }
        >
        json: (payload: {
          modelId: number
          count: number
          seed?: string
          modelName: string
        }) => Promise<
          | { ok: true; filePath: string; durationMs: number; rowCount: number }
          | { ok: false; reason: string }
        >
        mysql: (payload: {
          modelId: number
          count: number
          seed?: string
          modelName: string
        }) => Promise<
          | { ok: true; filePath: string; durationMs: number; rowCount: number }
          | { ok: false; reason: string }
        >
      }
      history: {
        list: () => Promise<unknown[]>
        delete: (id: number) => Promise<void>
      }
      ai: {
        suggestRules: (
          fields: Array<{ field_name: string; field_type: string }>
        ) => Promise<
          Record<string, { rule_expr: string; field_type?: string; sample_value?: string }>
        >,
        getLogInfo: () => Promise<{ dir: string; logFile: string }>
        openLogFolder: () => Promise<{ dir: string; error: string | null }>
      }
      app: {
        maxRows: () => Promise<number>
      }
      settings: {
        get: () => Promise<{
          https_proxy: string
          gemini_api_key: string
          gemini_model: string
          openrouter_api_key: string
          openrouter_model: string
          kimi_api_key: string
          kimi_model: string
          ai_suggest_provider: string
        }>
        set: (patch: Record<string, string>) => Promise<{ ok: true } | { ok: false; error?: string }>
      }
    }
  }
}
