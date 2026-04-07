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
        }) => Promise<void>
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
      }
      history: {
        list: () => Promise<unknown[]>
        delete: (id: number) => Promise<void>
      }
      ai: {
        suggestRules: (fieldNames: string[]) => Promise<Record<string, string>>
      }
      app: {
        maxRows: () => Promise<number>
      }
    }
  }
}
