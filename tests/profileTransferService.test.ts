import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { LaunchProfile } from '../src/shared/types'
import { defaultLaunchConfig } from '../src/shared/config'
import { ProfileTransferService } from '../src/main/profileTransferService'

const directories: string[] = []

function profile(overrides: Partial<LaunchProfile> = {}): LaunchProfile {
  return {
    id: 'profile-1', name: 'Gaming',
    launch: { ...defaultLaunchConfig(), maxFps: 120, recordEnabled: true, recordPath: '/Users/alice/Videos/game.mp4', extraArgs: '--power-off-on-close' },
    extensions: { vendor: { preserved: true } },
    ...overrides
  }
}

function document(overrides: Record<string, unknown> = {}): string {
  const service = new ProfileTransferService()
  const value = JSON.parse(service.serialize(profile(), '2.0.0-beta.5'))
  return JSON.stringify({ ...value, ...overrides })
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('ProfileTransferService', () => {
  it('exports a declarative, versioned document with expert args and machine-local path markers', () => {
    const value = JSON.parse(new ProfileTransferService().serialize(profile(), '2.0.0-beta.5'))
    expect(value).toMatchObject({
      schemaVersion: 1, kind: 'scrcpy-gui-profile', appVersion: '2.0.0-beta.5', minScrcpyVersion: '4.0',
      profile: {
        name: 'Gaming', scene: 'screen', expertArgs: ['--power-off-on-close'],
        extensions: { vendor: { preserved: true } }, machineLocalFields: ['profile.options.recordPath']
      }
    })
    expect(value.profile.options).not.toHaveProperty('extraArgs')
    expect(value.profile.options.recordPath).toBe('/Users/alice/Videos/game.mp4')
  })

  it('previews compatibility, unknown fields, local paths and locale-aware name conflicts without importing', () => {
    const raw = JSON.parse(document({ futureTopLevel: true }))
    raw.minScrcpyVersion = '5.0'
    raw.profile.futureProfileField = 'preserve elsewhere'
    raw.profile.options.futureOption = 7
    raw.profile.options.extraArgs = '--ignored-format-field'
    const service = new ProfileTransferService()
    const preview = service.preview(JSON.stringify(raw), [profile({ id: 'existing', name: 'GAMING' })], 'en')

    expect(preview).toMatchObject({
      name: 'Gaming', scene: 'screen', compatible: false,
      conflict: { profileId: 'existing', name: 'GAMING' },
      machineLocalPaths: [{ field: 'recordPath', value: '/Users/alice/Videos/game.mp4' }]
    })
    expect(preview.unknownFields).toEqual([
      'futureTopLevel', 'profile.futureProfileField', 'profile.options.futureOption', 'profile.options.extraArgs'
    ])
    expect(preview.warnings.join(' ')).toContain('requires scrcpy 5.0')
    expect(service.preview(JSON.stringify(raw), [], 'en', '5.1').compatible).toBe(true)
  })

  it('round-trips a supported non-screen scene without duplicating scene inside options', () => {
    const service = new ProfileTransferService()
    const camera = profile({
      name: 'Camera',
      launch: { ...defaultLaunchConfig(), scene: 'camera', cameraFacing: 'back', cameraFps: 60 }
    })
    const contents = service.serialize(camera, '2.0.0-beta.6')
    const exported = JSON.parse(contents)
    expect(exported.profile.scene).toBe('camera')
    expect(exported.profile.options).not.toHaveProperty('scene')

    const preview = service.preview(contents, [], 'en')
    expect(preview.scene).toBe('camera')
    const committed = service.commit(preview.token, 'duplicate', false, [])
    expect(committed.profile?.launch).toMatchObject({ scene: 'camera', cameraFacing: 'back', cameraFps: 60 })
  })

  it('imports a unique copy while disabling machine-local recording paths by default', () => {
    const service = new ProfileTransferService()
    const existing = [profile({ id: 'existing', name: 'Gaming' }), profile({ id: 'copy', name: 'Gaming (2)' })]
    const preview = service.preview(document(), existing, 'en')
    const committed = service.commit(preview.token, 'duplicate', false, existing)

    if (!committed.profile) throw new Error('Expected an imported profile.')
    expect(committed.replacedProfileId).toBeUndefined()
    expect(committed.profile.name).toBe('Gaming (3)')
    expect(committed.profile.id).not.toBe('profile-1')
    expect(committed.profile.launch).toMatchObject({ recordEnabled: false, autoRecordName: false, recordPath: '', recordDirectory: '' })
    expect(committed.profile.extensions).toEqual({ vendor: { preserved: true } })
  })

  it('replaces a same-name profile without breaking its id references and can explicitly retain paths', () => {
    const service = new ProfileTransferService()
    const existing = [profile({ id: 'assigned-profile', name: 'Gaming' })]
    const preview = service.preview(document(), existing, 'en')
    const committed = service.commit(preview.token, 'replace', true, existing)
    if (!committed.profile) throw new Error('Expected a replacement profile.')
    expect(committed).toMatchObject({ replacedProfileId: 'assigned-profile', profile: { id: 'assigned-profile', name: 'Gaming' } })
    expect(committed.profile.launch.recordPath).toBe('/Users/alice/Videos/game.mp4')
    expect(() => service.commit(preview.token, 'replace', true, existing)).toThrow('expired')
  })

  it('keeps an existing same-name profile unchanged when requested', () => {
    const service = new ProfileTransferService()
    const existing = [profile({ id: 'existing-profile', name: 'Gaming' })]
    const preview = service.preview(document(), existing, 'en')

    expect(service.commit(preview.token, 'keep', false, existing)).toEqual({
      keptExisting: true,
      replacedProfileId: 'existing-profile'
    })
    expect(existing[0].launch.recordPath).toBe('/Users/alice/Videos/game.mp4')
  })

  it('rejects unsupported scenes, managed expert flags and oversized extension payloads', () => {
    const service = new ProfileTransferService()
    const wrongScene = JSON.parse(document())
    wrongScene.profile.scene = 'future-scene'
    expect(() => service.preview(JSON.stringify(wrongScene), [], 'en')).toThrow('not supported')

    const managed = JSON.parse(document())
    managed.profile.expertArgs = ['--serial=OTHER']
    expect(() => service.preview(JSON.stringify(managed), [], 'en')).toThrow('managed by Scrcpy GUI')

    const huge = JSON.parse(document())
    huge.profile.extensions = { value: 'x'.repeat(70_000) }
    expect(() => service.preview(JSON.stringify(huge), [], 'en')).toThrow('64 KiB')
  })

  it('expires pending previews before commit', () => {
    let time = 1_000
    const service = new ProfileTransferService(() => time)
    const preview = service.preview(document(), [], 'en')
    time += 10 * 60_000 + 1
    expect(() => service.commit(preview.token, 'duplicate', false, [])).toThrow('expired')
  })

  it('atomically writes exports with private permissions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scrcpy-gui-profile-'))
    directories.push(directory)
    const path = join(directory, 'Gaming.scrcpy-profile.json')
    const service = new ProfileTransferService()
    const contents = service.serialize(profile(), '2.0.0-beta.5')
    await service.write(path, contents)
    expect(await readFile(path, 'utf8')).toBe(contents)
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
})
