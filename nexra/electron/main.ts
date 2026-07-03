import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildSnapshot } from './services/store.mock'
import { runSend } from './services/agent.live'
import { runTitle } from './services/agent.title'
import { initSettingsDb, getSetting, setSetting } from './services/store.sqlite'
import { encryptSecret, decryptSecret } from './services/secrets'
import { createSecret, fillSecret, tieSecret, listSecrets, deleteSecret } from './services/secrets.vault'
import { getScope, setScope } from './services/scope'
import type { ProviderConfig } from './services/providers'
import type { EngagementScope, SecretField } from './services/store.types'
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

const inflight = new Map<string, AbortController>()

// Reads provider/model/baseUrl and decrypts the stored API key (if any) for
// the configured provider. The plaintext key lives only in this function's
// return value, transiently, while the AI SDK client is constructed — it
// must never be sent to the renderer or placed in process.env (see
// electron/services/shell.pty.ts:35 for why operator shells stay clean).
function loadConfig(): ProviderConfig {
  const provider = (getSetting('provider') ?? 'anthropic') as ProviderConfig['provider']
  const model = getSetting('model') ?? 'claude-opus-4-8'
  const baseUrl = (getSetting('baseUrl') || 'http://localhost:11434').replace(/\/+$/, '')
  const blob = getSetting('secret.apikey.' + provider)
  let apiKey: string | undefined
  if (blob) { try { apiKey = decryptSecret(blob) } catch { apiKey = undefined } }
  return { provider, model, baseUrl, apiKey }
}

app.whenReady().then(() => {
  initSettingsDb(path.join(app.getPath('userData'), 'nexra.db'))

  ipcMain.handle('store:snapshot', () => buildSnapshot())
  ipcMain.handle('agent:send', async (ev, req) => {
    const ctrl = new AbortController()
    inflight.set(req.chatId, ctrl)
    try {
      await runSend(req, loadConfig(), e => ev.sender.send('agent:event:' + req.chatId, e), ctrl.signal)
    } finally {
      inflight.delete(req.chatId)
    }
  })
  ipcMain.handle('agent:title', (_ev, req) => runTitle(req, loadConfig()))
  ipcMain.handle('agent:cancel', (_ev, chatId: string) => { inflight.get(chatId)?.abort() })
  ipcMain.handle('agent:install', (ev, req) =>
    ev.sender.send('agent:event:' + req.chatId, { type: 'error', message: 'Tool install arrives with agent execution in M3b' }))

  ipcMain.handle('settings:get', () => ({
    provider: getSetting('provider') ?? 'anthropic',
    model: getSetting('model') ?? 'claude-opus-4-8',
    baseUrl: getSetting('baseUrl') ?? 'http://localhost:11434',
    hasKey: !!getSetting('secret.apikey.' + (getSetting('provider') ?? 'anthropic')),
  }))
  ipcMain.handle('settings:set', (_ev, partial: Record<string, string>) => {
    for (const k of ['provider', 'model', 'baseUrl'] as const) if (partial[k] != null) setSetting(k, partial[k])
  })
  ipcMain.handle('settings:setKey', (_ev, { provider, plaintext }: { provider: string; plaintext: string }) =>
    setSetting('secret.apikey.' + provider, encryptSecret(plaintext)))

  // ── credential vault (M3b) — values travel renderer→main only, never back ──
  ipcMain.handle('secrets:list', (_ev, companyId: string) => listSecrets(companyId))
  ipcMain.handle('secrets:create', (_ev, input: { companyId: string; name: string; fields: SecretField[]; createdBy?: 'operator' | 'agent' }) =>
    createSecret({ companyId: input.companyId, name: input.name, fields: input.fields, createdBy: input.createdBy ?? 'operator' }))
  ipcMain.handle('secrets:fill', (_ev, { id, values }: { id: string; values: Record<string, string> }) => fillSecret(id, values))
  ipcMain.handle('secrets:tie', (_ev, { id, aliasOf }: { id: string; aliasOf: string }) => tieSecret(id, aliasOf))
  ipcMain.handle('secrets:delete', (_ev, id: string) => deleteSecret(id))

  // ── engagement scope (M3b) ──
  ipcMain.handle('scope:get', (_ev, engagementId: string) => getScope(engagementId))
  ipcMain.handle('scope:set', (_ev, { engagementId, scope }: { engagementId: string; scope: EngagementScope }) => setScope(engagementId, scope))

  // ── fulfillment: operator fills a pending secret or sets scope (M3b) ──
  ipcMain.handle('secrets:fulfill-pending', (_ev, { id, values }: { id: string; values: Record<string, string> }) => {
    try {
      fillSecret(id, values)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('scope:set-and-validate', (_ev, { engagementId, scope }: { engagementId: string; scope: EngagementScope }) => {
    try {
      setScope(engagementId, scope)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('shell:tabs', () => shellTabs())
  ipcMain.handle('shell:create', (_ev, { shell, cols, rows, companyId }: { shell: any; cols: number; rows: number; companyId?: string }) => {
    const sessionId = companyId ? `${companyId}:${shell}` : shell
    return createSession(shell, cols, rows, data => mainWindow?.webContents.send('shell:data', { sessionId, data }), companyId)
  })
  ipcMain.handle('shell:write', (_e, { sessionId, data }: { sessionId: any; data: string }) => writeToSession(sessionId, data))
  ipcMain.handle('shell:resize', (_e, { sessionId, cols, rows }: { sessionId: any; cols: number; rows: number }) => resizeSession(sessionId, cols, rows))
  ipcMain.handle('shell:kill', (_e, sessionId: any) => killSession(sessionId))
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => killAllSessions())
