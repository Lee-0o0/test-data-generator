import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('tdg', {
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    get: (id: number) => ipcRenderer.invoke('models:get', id),
    create: (payload: { name: string; description?: string }) =>
      ipcRenderer.invoke('models:create', payload),
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
  generate: {
    preview: (payload: { modelId: number; count: number; seed?: string }) =>
      ipcRenderer.invoke('generate:preview', payload)
  },
  export: {
    csv: (payload: { modelId: number; count: number; seed?: string; modelName: string }) =>
      ipcRenderer.invoke('export:csv', payload)
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    delete: (id: number) => ipcRenderer.invoke('history:delete', id)
  },
  ai: {
    suggestRules: (fieldNames: string[]) => ipcRenderer.invoke('ai:suggestRules', fieldNames)
  },
  app: {
    maxRows: () => ipcRenderer.invoke('app:maxRows')
  }
})
