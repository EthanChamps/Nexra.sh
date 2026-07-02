import { contextBridge, ipcRenderer } from 'electron'

const shellDataListeners = new Map<string, Set<(data: string) => void>>()
ipcRenderer.on('shell:data', (_e, payload: { sessionId: string; data: string }) => {
  shellDataListeners.get(payload.sessionId)?.forEach(cb => cb(payload.data))
})

contextBridge.exposeInMainWorld('nexra', {
  platform: process.platform,
  store: { snapshot: () => ipcRenderer.invoke('store:snapshot') },
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
  shell: {
    tabs: () => ipcRenderer.invoke('shell:tabs'),
    create: (shell: any, cols: number, rows: number) => ipcRenderer.invoke('shell:create', { shell, cols, rows }),
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
