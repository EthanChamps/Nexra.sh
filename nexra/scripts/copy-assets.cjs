const fs = require('node:fs')
const path = require('node:path')

// Resolve from this file so asset copying also works outside the app directory.
const appDir = path.join(__dirname, '..')
for (const directory of ['scripts', 'assets']) {
  fs.cpSync(
    path.join(appDir, 'electron', 'services', directory),
    path.join(appDir, 'dist-electron', directory),
    { recursive: true },
  )
}
