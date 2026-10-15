import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildIssueHelperUrl } from '../src/main/issueHelper'

const environment = {
  appVersion: '2.4.5', scrcpyVersion: 'scrcpy 4.1 <https://github.com/Genymobile/scrcpy>',
  platform: 'win32', release: '10.0.26300', arch: 'x64'
}

describe('issue helper', () => {
  it('opens the validated bug form with environment fields rather than an empty report body', () => {
    const url = new URL(buildIssueHelperUrl(environment))
    expect(url.origin + url.pathname).toBe('https://github.com/SimonAKing/scrcpy-gui/issues/new')
    expect(url.searchParams.get('template')).toBe('bug.yml')
    expect(url.searchParams.get('version')).toBe(environment.appVersion)
    expect(url.searchParams.get('scrcpy-version')).toBe(environment.scrcpyVersion)
    expect(url.searchParams.get('os')).toBe('win32 10.0.26300 / x64')
    expect(url.searchParams.has('body')).toBe(false)
    for (const key of ['reproduction', 'behavior', 'logs']) expect(url.searchParams.has(key)).toBe(false)

    const form = readFileSync('.github/ISSUE_TEMPLATE/bug.yml', 'utf8')
    for (const key of ['version', 'scrcpy-version', 'os', 'diagnostics']) expect(form).toContain(`id: ${key}\n`)
    for (const key of ['reproduction', 'behavior', 'logs']) {
      const field = form.split('  - type: ').find((section) => section.includes(`id: ${key}\n`))
      expect(field).toContain('required: true')
    }
  })

  it('keeps an attachment name as text, preserves URL characters, and explains manual upload', () => {
    const name = 'diagnostics #1&os=changed.zip'
    const url = new URL(buildIssueHelperUrl({ ...environment, bundleName: name }))
    expect(url.searchParams.get('diagnostics')).toContain(`Attach \`${name}\` manually`)
    expect(url.searchParams.get('diagnostics')).toContain('did not upload any file or submit this issue')
    expect(url.searchParams.get('os')).toBe('win32 10.0.26300 / x64')
  })

  it('handles reports opened before exporting diagnostics', () => {
    const url = new URL(buildIssueHelperUrl({ ...environment, scrcpyVersion: '' }))
    expect(url.searchParams.get('scrcpy-version')).toBe('See diagnostic bundle')
    expect(url.searchParams.get('diagnostics')).toContain('Attach the exported diagnostic bundle manually')
  })
})
