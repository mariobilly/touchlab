// Finds an installed Chrome or Edge for the headless dev scripts (smoke.mjs, shot.mjs).
// Set TOUCHLAB_BROWSER to a chrome.exe / msedge.exe path to pick one yourself.
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function browserPath() {
  const env = process.env
  const candidates = [
    env.TOUCHLAB_BROWSER,
    ...[env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean).flatMap(base => [
      join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  const hit = candidates.find(p => existsSync(p))
  if (!hit) throw new Error('No Chrome or Edge found. Set TOUCHLAB_BROWSER to the browser\'s .exe path.')
  return hit
}
