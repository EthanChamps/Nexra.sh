const fs = require('node:fs')
const path = require('node:path')

const prebuildsDir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
if (fs.existsSync(prebuildsDir)) {
  for (const dir of fs.readdirSync(prebuildsDir)) {
    const helper = path.join(prebuildsDir, dir, 'spawn-helper')
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755)
  }
}

// Rebuild better-sqlite3 against Electron's ABI (it is not N-API-prebuilt like
// node-pty). Scoped with --only so node-pty's prebuilt binary is left alone.
const { execSync } = require('node:child_process')
try {
  execSync('npx --no-install electron-rebuild --only better-sqlite3', { stdio: 'inherit', cwd: __dirname + '/..' })
} catch (e) {
  console.warn('[fix-native] electron-rebuild for better-sqlite3 failed:', e.message)
}
