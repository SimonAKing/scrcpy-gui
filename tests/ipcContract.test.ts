import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const main = readFileSync(resolve(process.cwd(), 'src/main/main.ts'), 'utf8')
const preload = readFileSync(resolve(process.cwd(), 'src/main/preload.ts'), 'utf8')

function matches(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1])
}

describe('typed preload IPC contract', () => {
  it('backs every exposed invoke channel with a guarded main-process handler', () => {
    const invoked = new Set(matches(preload, /ipcRenderer\.invoke\('([^']+)'/g))
    const handled = new Set(matches(main, /handle\(\s*'([^']+)'/g))
    expect([...invoked].filter((channel) => !handled.has(channel))).toEqual([])
    expect(invoked).toContain('batch:preflight')
    expect(invoked).toContain('batch:start')
    expect(invoked).toContain('automation:import-preview')
  })

  it('backs every Renderer subscription and removes the exact listener on unsubscribe', () => {
    const subscribed = new Set(matches(preload, /ipcRenderer\.on\('([^']+)'/g))
    const removed = new Set(matches(preload, /ipcRenderer\.removeListener\('([^']+)'/g))
    expect([...subscribed].filter((channel) => !removed.has(channel))).toEqual([])
    for (const channel of subscribed) expect(main).toContain(`webContents.send('${channel}'`)
    expect(subscribed).toContain('batch:run-event')
  })

  it('routes all handlers through the trusted-sender wrapper', () => {
    expect(main).toContain('assertTrustedIpcSender(event)')
    expect(main).not.toMatch(/ipcMain\.handle\((?!channel)/)
  })
})
