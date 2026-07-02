import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildSnapshot } from './services/store.mock'
import { runSend, runInstall } from './services/agent.mock'
import { shellTabs, createSession, writeToSession, resizeSession, killSession, killAllSessions } from './services/shell.pty'

const __dirname2 = path.dirname(fileURLToPath(import.meta.url))

// Tracks the current (possibly re-created) window's webContents. Pty sessions
// live in the main process and outlive any single window: on macOS, closing
// the window destroys its webContents but not the pty, and `activate`
// creates a brand-new window. A pty's data callback is registered only once,
// at first spawn — capturing `ev.sender` there would permanently broadcast
// to a destroyed webContents after a close/reopen. This variable is captured
// by closures instead, so it always points at whichever window is current
// when data actually arrives. Do not "clean this up" back to `ev.sender`.
let mainWindow: BrowserWindow | null = null

function createWindow() {
  const win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 1080, minHeight: 680,
    backgroundColor: '#0a0b0d', show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // hiddenInset draws the native traffic lights over the window content with no
    // reserved space; pin their offset so the renderer can reserve matching space
    // (see Sidebar.tsx) instead of guessing at the OS default position.
    trafficLightPosition: process.platform === 'darwin' ? { x: 18, y: 20 } : undefined,
    webPreferences: {
      preload: path.join(__dirname2, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL)
  else win.loadFile(path.join(__dirname2, '../dist/index.html'))
  mainWindow = win
}

app.whenReady().then(() => {
  ipcMain.handle('store:snapshot', () => buildSnapshot())
  ipcMain.handle('agent:send', (ev, req) => runSend(req, e => ev.sender.send('agent:event:' + req.chatId, e)))
  ipcMain.handle('agent:install', (ev, req) => runInstall(req, e => ev.sender.send('agent:event:' + req.chatId, e)))
  ipcMain.handle('shell:tabs', () => shellTabs())
  ipcMain.handle('shell:create', (_ev, { shell, cols, rows }: { shell: any; cols: number; rows: number }) =>
    createSession(shell, cols, rows, data => mainWindow?.webContents.send('shell:data', { sessionId: shell, data })))
  ipcMain.handle('shell:write', (_e, { sessionId, data }: { sessionId: any; data: string }) => writeToSession(sessionId, data))
  ipcMain.handle('shell:resize', (_e, { sessionId, cols, rows }: { sessionId: any; cols: number; rows: number }) => resizeSession(sessionId, cols, rows))
  ipcMain.handle('shell:kill', (_e, sessionId: any) => killSession(sessionId))
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => killAllSessions())
