// Vite plugin: gives every build an id, so a deploy can tell installed copies of the app
// they're out of date (see src/autoUpdate.js) and replaces sw.js, which clears old caches.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export default function buildStamp() {
  const id = new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6)
  let outDir = 'dist'
  return {
    name: 'build-stamp',
    config: () => ({ define: { __BUILD_ID__: JSON.stringify(id) } }),
    configResolved(c) { outDir = join(c.root, c.build.outDir) },
    closeBundle() {
      const sw = join(outDir, 'sw.js')
      if (existsSync(sw)) writeFileSync(sw, readFileSync(sw, 'utf8').replaceAll('__BUILD_ID__', id))
      writeFileSync(join(outDir, 'version.json'), JSON.stringify({ build: id }))
    },
  }
}
