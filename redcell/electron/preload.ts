import { contextBridge } from 'electron'
// Filled out in Task 3. Placeholder keeps window.redcell defined.
contextBridge.exposeInMainWorld('redcell', {})
