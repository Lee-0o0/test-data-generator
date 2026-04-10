import { contextBridge, ipcRenderer } from 'electron'

type ExportPayload = {
  modelId: number
  count: number
  seed?: string
  modelName: string
  previewRows?: Record<string, string | number>[]
  previewFields?: Array<{ field_name: string }>
}

contextBridge.exposeInMainWorld('tdg', {
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    get: (id: number) => ipcRenderer.invoke('models:get', id),
    create: (payload: { name: string; description?: string }) =>
      ipcRenderer.invoke('models:create', payload),
    createFromMysqlDdl: (payload: { ddl: string; modelName?: string }) =>
      ipcRenderer.invoke('models:createFromMysqlDdl', payload),
    update: (payload: { id: number; name: string; description?: string }) =>
      ipcRenderer.invoke('models:update', payload),
    delete: (id: number) => ipcRenderer.invoke('models:delete', id),
    copy: (id: number) => ipcRenderer.invoke('models:copy', id)
  },
  fields: {
    list: (modelId: number) => ipcRenderer.invoke('fields:list', modelId),
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
    }) => ipcRenderer.invoke('fields:save', payload)
  },
  rule: {
    preview: (ruleExpr: string, fieldKey?: string, fieldType?: string) =>
      ipcRenderer.invoke('rule:preview', { ruleExpr, fieldKey, fieldType })
  },
  generate: {
    preview: (payload: { modelId: number; count: number; seed?: string }) =>
      ipcRenderer.invoke('generate:preview', payload)
  },
  export: {
    csv: (payload: ExportPayload) => ipcRenderer.invoke('export:csv', payload),
    json: (payload: ExportPayload) => ipcRenderer.invoke('export:json', payload),
    mysql: (payload: ExportPayload) => ipcRenderer.invoke('export:mysql', payload)
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    delete: (id: number) => ipcRenderer.invoke('history:delete', id)
  },
  ai: {
    suggestRules: (fields: Array<{ field_name: string; field_type: string }>) =>
      ipcRenderer.invoke('ai:suggestRules', fields),
    getLogInfo: () =>
      ipcRenderer.invoke('ai:getLogInfo') as Promise<{ dir: string; logFile: string }>,
    openLogFolder: () =>
      ipcRenderer.invoke('ai:openLogFolder') as Promise<{ dir: string; error: string | null }>
  },
  app: {
    maxRows: () => ipcRenderer.invoke('app:maxRows')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Record<string, string>) => ipcRenderer.invoke('settings:set', patch)
  }
})
