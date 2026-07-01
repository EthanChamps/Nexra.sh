import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('nexra', {
  store: { snapshot: () => ipcRenderer.invoke('store:snapshot') },
  agent: {
    send: (req: any, onEvent: any) => { const ch = 'agent:event:' + req.chatId; const l = (_: any, e: any) => onEvent(e); ipcRenderer.on(ch, l); return ipcRenderer.invoke('agent:send', req).finally(() => ipcRenderer.removeListener(ch, l)) },
    install: (req: any, onEvent: any) => { const ch = 'agent:event:' + req.chatId; const l = (_: any, e: any) => onEvent(e); ipcRenderer.on(ch, l); return ipcRenderer.invoke('agent:install', req).finally(() => ipcRenderer.removeListener(ch, l)) },
  },
  shell: {
    tabs: () => ipcRenderer.invoke('shell:tabs'),
    run: (shell: any, raw: any) => ipcRenderer.invoke('shell:run', { shell, raw }),
    prompt: (shell: any) => ipcRenderer.invoke('shell:prompt', shell),
  },
})
