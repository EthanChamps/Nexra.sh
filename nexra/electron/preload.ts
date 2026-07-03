import { contextBridge, ipcRenderer } from 'electron'

const shellDataListeners = new Map<string, Set<(data: string) => void>>()
ipcRenderer.on('shell:data', (_e, payload: { sessionId: string; data: string }) => {
  shellDataListeners.get(payload.sessionId)?.forEach(cb => cb(payload.data))
})

contextBridge.exposeInMainWorld('nexra', {
  platform: process.platform,
  store: {
    snapshot: () => ipcRenderer.invoke('store:snapshot'),
    save: (companies: any) => ipcRenderer.invoke('store:save', companies),
    deleteCompany: (id: string) => ipcRenderer.invoke('store:deleteCompany', id),
    deleteChat: (id: string) => ipcRenderer.invoke('store:deleteChat', id),
    coverage: (engagementId: string) => ipcRenderer.invoke('store:coverage', engagementId),
    memory: (engagementId: string) => ipcRenderer.invoke('store:memory', engagementId),
  },
  agent: {
    send: (req: any, onEvent: any) => { const ch = 'agent:event:' + req.chatId; const l = (_: any, e: any) => onEvent(e); ipcRenderer.on(ch, l); return ipcRenderer.invoke('agent:send', req).finally(() => ipcRenderer.removeListener(ch, l)) },
    title: (req: any) => ipcRenderer.invoke('agent:title', req),
    install: (req: any, onEvent: any) => { const ch = 'agent:event:' + req.chatId; const l = (_: any, e: any) => onEvent(e); ipcRenderer.on(ch, l); return ipcRenderer.invoke('agent:install', req).finally(() => ipcRenderer.removeListener(ch, l)) },
    cancel: (chatId: string) => ipcRenderer.invoke('agent:cancel', chatId),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (partial: any) => ipcRenderer.invoke('settings:set', partial),
    setKey: (provider: string, plaintext: string) => ipcRenderer.invoke('settings:setKey', { provider, plaintext }),
  },
  // Credential vault — list/create/delete deal in METADATA only; fill/tie send
  // plaintext renderer→main once and it is never returned (mirrors setKey).
  secrets: {
    list: (companyId: string) => ipcRenderer.invoke('secrets:list', companyId),
    create: (input: any) => ipcRenderer.invoke('secrets:create', input),
    fill: (id: string, values: Record<string, string>) => ipcRenderer.invoke('secrets:fill', { id, values }),
    tie: (id: string, aliasOf: string) => ipcRenderer.invoke('secrets:tie', { id, aliasOf }),
    delete: (id: string) => ipcRenderer.invoke('secrets:delete', id),
    fulfillPending: (id: string, values: Record<string, string>) => ipcRenderer.invoke('secrets:fulfill-pending', { id, values }),
  },
  // Agent-requested inputs — plaintext travels renderer→main once (mirrors secrets).
  inputs: {
    fulfill: (companyId: string, key: string, value: string, sensitive: boolean) =>
      ipcRenderer.invoke('inputs:fulfill', { companyId, key, value, sensitive }),
  },
  scope: {
    get: (engagementId: string) => ipcRenderer.invoke('scope:get', engagementId),
    set: (engagementId: string, scope: any) => ipcRenderer.invoke('scope:set', { engagementId, scope }),
    setAndValidate: (engagementId: string, scope: any) => ipcRenderer.invoke('scope:set-and-validate', { engagementId, scope }),
  },
  findings: {
    list: (chatId: string) => ipcRenderer.invoke('findings:list', chatId),
  },
  shell: {
    tabs: () => ipcRenderer.invoke('shell:tabs'),
    create: (shell: any, cols: number, rows: number, companyId?: string) => ipcRenderer.invoke('shell:create', { shell, cols, rows, companyId }),
    write: (sessionId: any, data: string) => ipcRenderer.invoke('shell:write', { sessionId, data }),
    resize: (sessionId: any, cols: number, rows: number) => ipcRenderer.invoke('shell:resize', { sessionId, cols, rows }),
    kill: (sessionId: any) => ipcRenderer.invoke('shell:kill', sessionId),
    onData: (sessionId: string, cb: (data: string) => void) => {
      if (!shellDataListeners.has(sessionId)) shellDataListeners.set(sessionId, new Set())
      shellDataListeners.get(sessionId)!.add(cb)
      return () => shellDataListeners.get(sessionId)?.delete(cb)
    },
  },
})
