const fs = require('node:fs')
const path = require('node:path')

const prebuildsDir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
if (fs.existsSync(prebuildsDir)) {
  for (const dir of fs.readdirSync(prebuildsDir)) {
    const helper = path.join(prebuildsDir, dir, 'spawn-helper')
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755)
  }
}
