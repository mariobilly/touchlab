// Dev mode: API server on 4747 (no static) + Vite with HMR on 4748 proxying /api.
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const kids = [
  spawn(process.execPath, [join(root, 'server.mjs'), '--dev'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: root, stdio: 'inherit' }),
]
const stop = () => { for (const k of kids) k.kill(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const k of kids) k.on('exit', stop)
