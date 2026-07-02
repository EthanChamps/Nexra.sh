import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildSnapshot } from './services/store.mock'
import { runSend, runInstall } from './services/agent.mock'
import { shellTabs, createSession, writeToSession, resizeSession, killSession, killAllSessions } from './services/shell.pty'

const __dirname2 = path.dirname(fileURLToPath(import.meta.url))

function createWindow() {
  const win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 1080, minHeight: 680,
    backgroundColor: '#0a0b0d', show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname2, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL)
  else win.loadFile(path.join(__dirname2, '../dist/index.html'))
}

app.whenReady().then(() => {
  ipcMain.handle('store:snapshot', () => buildSnapshot())
  ipcMain.handle('agent:send', (ev, req) => runSend(req, e => ev.sender.send('agent:event:' + req.chatId, e)))
  ipcMain.handle('agent:install', (ev, req) => runInstall(req, e => ev.sender.send('agent:event:' + req.chatId, e)))
  ipcMain.handle('shell:tabs', () => shellTabs())
  ipcMain.handle('shell:create', (ev, { shell, cols, rows }: { shell: any; cols: number; rows: number }) =>
    createSession(shell, cols, rows, data => ev.sender.send('shell:data', { sessionId: shell, data })))
  ipcMain.handle('shell:write', (_e, { sessionId, data }: { sessionId: any; data: string }) => writeToSession(sessionId, data))
  ipcMain.handle('shell:resize', (_e, { sessionId, cols, rows }: { sessionId: any; cols: number; rows: number }) => resizeSession(sessionId, cols, rows))
  ipcMain.handle('shell:kill', (_e, sessionId: any) => killSession(sessionId))
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => killAllSessions())
