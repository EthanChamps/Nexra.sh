import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('redcell', {
  store: { snapshot: () => ipcRenderer.invoke('store:snapshot') },
  // agent + shell added in Tasks 11–12
})
