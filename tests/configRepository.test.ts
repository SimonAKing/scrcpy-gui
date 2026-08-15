import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigRepository } from '../src/main/configRepository'
import { defaultPersistedConfig } from '../src/shared/config'

const temporaryDirectories: string[] = []
const fixedNow = new Date('2026-08-15T12:00:00.000Z')

// These persisted shapes come from the tagged AppV2.vue/default config implementations:
// beta.1 blob 3ae2712e, beta.2 blob 5c5c9bff, beta.3 blob 5ac1a31a.
// beta.2 and beta.3 share the same PersistedConfig type blob (55426146), but both tags
// remain explicit cases so a release exit condition is not represented by one generic fixture.
const taggedBetaConfigs = [
  {
    tag: 'v2.0.0-beta.1',
    value: {
      runtime: { scrcpyPath: '/tools/beta-1/scrcpy' }, locale: 'ru', muteNotifications: true, minimizeToTray: true,
      launch: {
        windowTitle: 'Beta 1 phone', videoBitRate: 16, maxSize: 1440, maxFps: 30, orientation: '90',
        videoCodec: 'h265', shortcutModifier: 'lalt', keyboardMode: 'uhid', alwaysOnTop: true,
        control: true, audio: false, turnScreenOff: true, stayAwake: true, showTouches: true,
        fullscreen: false, borderless: true, recordEnabled: true, recordPath: '/tmp/beta-1.mp4', noPlayback: true,
        crop: { x: 4, y: 8, width: 1080, height: 1920 }, window: { x: 20, y: 30, width: 600, height: 900 },
        extraArgs: '--power-off-on-close'
      }
    },
    expected: {
      runtime: { scrcpyPath: '/tools/beta-1/scrcpy' }, locale: 'ru', muteNotifications: true, minimizeToTray: true,
      launch: {
        windowTitle: 'Beta 1 phone', videoBitRate: 16, maxSize: 1440, maxFps: 30, orientation: '90',
        videoCodec: 'h265', shortcutModifier: 'lalt', keyboardMode: 'uhid', alwaysOnTop: true,
        audio: false, turnScreenOff: true, stayAwake: true, showTouches: true, borderless: true,
        recordEnabled: true, recordPath: '/tmp/beta-1.mp4', noPlayback: true,
        crop: { x: 4, y: 8, width: 1080, height: 1920 }, window: { x: 20, y: 30, width: 600, height: 900 },
        extraArgs: '--power-off-on-close'
      }
    }
  },
  ...(['v2.0.0-beta.2', 'v2.0.0-beta.3'] as const).map((tag, index) => ({
    tag,
    value: {
      runtime: { scrcpyPath: `/tools/beta-${index + 2}/scrcpy` }, locale: index ? 'zh-TW' : 'zh-CN',
      muteNotifications: Boolean(index), minimizeToTray: true, killAdbOnQuit: true,
      bossKeyEnabled: true, bossKeyAccelerator: 'CommandOrControl+Alt+B', autoSelectFirstDevice: false,
      autoLaunchDevices: { 'BETA-DEVICE': true },
      launch: {
        windowTitle: `${tag} phone`, videoBitRate: 24, videoBuffer: 40, audioBuffer: 80,
        maxSize: 1920, maxFps: 60, displayId: 2, orientation: '180', videoCodec: 'h264',
        shortcutModifier: 'ralt', keyboardMode: 'uhid', mouseMode: 'uhid', gamepadMode: 'uhid',
        alwaysOnTop: true, control: true, audio: true, turnScreenOff: false, stayAwake: true,
        showTouches: false, fullscreen: true, borderless: false, windowAspectRatioLock: false,
        pushTarget: '/sdcard/Download', tunnelPort: '27183:27199', recordEnabled: true,
        recordPath: `/tmp/${tag}.mkv`, autoRecordName: true, recordDirectory: '/tmp/recordings', noPlayback: false,
        crop: { x: 1, y: 2, width: 720, height: 1280 }, window: { x: 40, y: 50, width: 720, height: 1280 },
        extraArgs: '--disable-screensaver'
      },
      profiles: [{ id: `profile-${index}`, name: `Profile ${index}`, launch: { maxFps: 90, videoCodec: 'h265' } }],
      deviceProfiles: { 'BETA-DEVICE': `profile-${index}` }, deviceAliases: { 'BETA-DEVICE': `Beta device ${index}` },
      wirelessTargets: [{ id: `wifi-${index}`, name: 'Lab phone', address: '192.168.1.9:5555', autoConnect: true }],
      automations: [{ id: `macro-${index}`, name: 'Home', steps: [{ action: 'home', delayMs: 120 }] }]
    },
    expected: {
      runtime: { scrcpyPath: `/tools/beta-${index + 2}/scrcpy` }, locale: index ? 'zh-TW' : 'zh-CN',
      minimizeToTray: true, killAdbOnQuit: true, bossKeyEnabled: true,
      bossKeyAccelerator: 'CommandOrControl+Alt+B', autoSelectFirstDevice: false,
      autoLaunchDevices: { 'BETA-DEVICE': true }, deviceAliases: { 'BETA-DEVICE': `Beta device ${index}` },
      deviceProfiles: { 'BETA-DEVICE': `profile-${index}` },
      launch: {
        windowTitle: `${tag} phone`, videoBitRate: 24, videoBuffer: 40, audioBuffer: 80,
        maxSize: 1920, maxFps: 60, displayId: 2, orientation: '180', videoCodec: 'h264',
        shortcutModifier: 'ralt', keyboardMode: 'uhid', mouseMode: 'uhid', gamepadMode: 'uhid',
        alwaysOnTop: true, stayAwake: true, fullscreen: true, windowAspectRatioLock: false,
        pushTarget: '/sdcard/Download', tunnelPort: '27183:27199', recordEnabled: true,
        recordPath: `/tmp/${tag}.mkv`, autoRecordName: true, recordDirectory: '/tmp/recordings',
        crop: { x: 1, y: 2, width: 720, height: 1280 }, window: { x: 40, y: 50, width: 720, height: 1280 },
        extraArgs: '--disable-screensaver'
      },
      profiles: [{ id: `profile-${index}`, name: `Profile ${index}`, launch: { maxFps: 90, videoCodec: 'h265' } }],
      wirelessTargets: [{ id: `wifi-${index}`, name: 'Lab phone', address: '192.168.1.9:5555', autoConnect: true }],
      automations: [{ id: `macro-${index}`, name: 'Home' }]
    }
  }))
]

async function repository(): Promise<{ directory: string; store: ConfigRepository }> {
  const directory = await mkdtemp(join(tmpdir(), 'scrcpy-gui-config-'))
  temporaryDirectories.push(directory)
  return { directory, store: new ConfigRepository(directory, () => fixedNow) }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('ConfigRepository', () => {
  it.each(taggedBetaConfigs)('migrates the persisted $tag shape without losing supported values', async ({ value, expected }) => {
    const { directory, store } = await repository()
    const loaded = await store.load(JSON.stringify(value), 'en')

    expect(loaded.migration.source).toBe('legacy-v2')
    expect(loaded.config).toMatchObject(expected)
    expect(JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'))).toMatchObject({ schemaVersion: 3, revision: 1 })
  })

  it('migrates valid beta config item-by-item without persisting a bundled absolute path', async () => {
    const { directory, store } = await repository()
    const legacy = {
      locale: 'zh-CN',
      runtime: { scrcpyPath: '' },
      launch: { maxSize: 1920 },
      profiles: [{ id: 'profile-1', name: 'Pixel', launch: { maxFps: 60 } }, null],
      deviceAliases: { 'ABC-123': 'Test phone' },
      deviceProfiles: { 'ABC-123': 'profile-1', 'MISSING-PROFILE': 'nope' },
      autoLaunchDevices: { 'ABC-123': true },
      wirelessTargets: [
        { id: 'wifi-1', name: 'Lab', address: '192.168.1.8:5555', autoConnect: true },
        { id: 'wifi-bad', name: 'Bad', address: '999.1.1.1', autoConnect: false }
      ],
      automations: [
        { id: 'macro-1', name: 'Home', steps: [{ action: 'home', delayMs: 100 }] },
        { id: 'macro-bad', name: 'Shell', steps: [{ action: 'raw-shell', delayMs: 0 }] }
      ]
    }

    const loaded = await store.load(JSON.stringify(legacy), 'en')
    expect(loaded.migration.source).toBe('legacy-v2')
    expect(loaded.migration.skipped).toBe(4)
    expect(loaded.config.launch.maxSize).toBe(1920)
    expect(loaded.config.profiles[0].launch.maxFps).toBe(60)
    expect(loaded.config.deviceAliases['ABC-123']).toBe('Test phone')
    expect(loaded.config.deviceProfiles['ABC-123']).toBe('profile-1')
    expect(loaded.config.wirelessTargets).toHaveLength(1)
    expect(loaded.config.automations).toHaveLength(1)

    const persisted = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'))
    expect(persisted).toMatchObject({ schemaVersion: 3, revision: 1, runtime: { mode: 'bundled', customScrcpyPath: '' } })
    expect(persisted.knownDevices[0]).toMatchObject({ alias: 'Test phone', lastSerial: 'ABC-123', autoLaunch: true })
    expect(persisted.knownDevices[0].id).toMatch(/^device-[a-f0-9]{16}$/)
    if (process.platform !== 'win32') expect((await stat(join(directory, 'config.json'))).mode & 0o777).toBe(0o600)
  })

  it('atomically advances revisions and rotates the previous primary file to backup', async () => {
    const { directory, store } = await repository()
    const loaded = await store.load('', 'en')
    const changed = structuredClone(loaded.config)
    changed.launch.maxFps = 90
    changed.muteNotifications = true

    const saved = await store.save(loaded.revision, changed)
    expect(saved).toMatchObject({ ok: true, data: { revision: 2 } })
    expect(JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'))).toMatchObject({ revision: 2 })
    expect(JSON.parse(await readFile(join(directory, 'config.backup.json'), 'utf8'))).toMatchObject({ revision: 1 })

    const stale = await store.save(loaded.revision, defaultPersistedConfig('en'))
    expect(stale.ok).toBe(false)
    expect(stale.error).toMatchObject({ code: 'CONFIG_REVISION_CONFLICT', stage: 'config-save', retryable: true })
    expect(stale.error?.message).toContain('current revision is 2')
    expect(JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'))).toMatchObject({ revision: 2 })
  })

  it('recovers a corrupt primary from the last validated backup without backing up corruption', async () => {
    const { directory, store } = await repository()
    const loaded = await store.load('', 'en')
    const changed = structuredClone(loaded.config)
    changed.launch.maxSize = 1440
    await store.save(loaded.revision, changed)
    await writeFile(join(directory, 'config.json'), '{corrupt', 'utf8')

    const recovered = await new ConfigRepository(directory, () => fixedNow).load('', 'en')
    expect(recovered.migration.source).toBe('backup')
    expect(recovered.revision).toBe(1)
    expect(JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'))).toMatchObject({ schemaVersion: 3, revision: 1 })
    expect(JSON.parse(await readFile(join(directory, 'config.backup.json'), 'utf8'))).toMatchObject({ schemaVersion: 3, revision: 1 })
  })

  it('rejects invalid config values without touching the primary file', async () => {
    const { directory, store } = await repository()
    const loaded = await store.load('', 'en')
    const before = await readFile(join(directory, 'config.json'), 'utf8')
    const invalid = structuredClone(loaded.config)
    invalid.launch.videoBitRate = Number.NaN

    const result = await store.save(loaded.revision, invalid)
    expect(result.ok).toBe(false)
    expect(result.error).toMatchObject({ code: 'CONFIG_SAVE_FAILED', stage: 'config-save' })
    expect(result.error?.detail).toContain('videoBitRate')
    expect(await readFile(join(directory, 'config.json'), 'utf8')).toBe(before)
  })

  it('serializes concurrent saves so the same revision cannot overwrite twice', async () => {
    const { directory, store } = await repository()
    const loaded = await store.load('', 'en')
    const first = structuredClone(loaded.config)
    const second = structuredClone(loaded.config)
    first.launch.maxFps = 30
    second.launch.maxFps = 120

    const results = await Promise.all([store.save(loaded.revision, first), store.save(loaded.revision, second)])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)
    expect(JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'))).toMatchObject({ revision: 2 })
  })

  it('round-trips bounded profile extension data for forward-compatible imports', async () => {
    const { directory, store } = await repository()
    const loaded = await store.load('', 'en')
    const changed = structuredClone(loaded.config)
    changed.profiles.push({
      id: 'profile-with-extension',
      name: 'Forward compatible',
      launch: structuredClone(changed.launch),
      extensions: { vendor: { feature: true, values: [1, 'two', null] } }
    })
    expect(await store.save(loaded.revision, changed)).toMatchObject({ ok: true })
    const reloaded = await new ConfigRepository(directory, () => fixedNow).load('', 'en')
    expect(reloaded.config.profiles[0].extensions).toEqual({ vendor: { feature: true, values: [1, 'two', null] } })
  })

  it('persists device groups by stable device id while exposing serials to the renderer', async () => {
    const { directory, store } = await repository()
    const loaded = await store.load('', 'en')
    const changed = structuredClone(loaded.config)
    changed.deviceAliases.SERIAL_A = 'Lab A'
    changed.deviceAliases.SERIAL_B = 'Lab B'
    changed.groups.push({
      id: 'group-1', name: 'Lab', description: 'Test bench', serials: ['SERIAL_A', 'SERIAL_B'],
      concurrencyLimit: 2
    })
    expect(await store.save(loaded.revision, changed)).toMatchObject({ ok: true })

    const raw = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'))
    expect(raw.groups[0].deviceIds).toHaveLength(2)
    expect(raw.groups[0].deviceIds).not.toContain('SERIAL_A')
    expect(raw.knownDevices.every((device: { groupIds: string[] }) => device.groupIds.includes('group-1'))).toBe(true)

    const reloaded = await new ConfigRepository(directory, () => fixedNow).load('', 'en')
    expect(reloaded.config.groups[0]).toEqual({
      id: 'group-1', name: 'Lab', description: 'Test bench', serials: ['SERIAL_A', 'SERIAL_B'],
      defaultProfileId: undefined, concurrencyLimit: 2
    })
  })

  it('bounds the legacy migration payload before parsing it', async () => {
    const { store } = await repository()
    await expect(store.load(`{"padding":"${'x'.repeat(2 * 1024 * 1024)}"}`, 'en')).rejects.toThrow('2 MB')
  })

  it('refuses a future schema without modifying or backing up the unknown file', async () => {
    const { directory } = await repository()
    const future = '{"schemaVersion":4,"revision":99,"futureField":true}\n'
    await writeFile(join(directory, 'config.json'), future, 'utf8')

    await expect(new ConfigRepository(directory).load('', 'en')).rejects.toThrow('newer than supported')
    expect(await readFile(join(directory, 'config.json'), 'utf8')).toBe(future)
    await expect(readFile(join(directory, 'config.backup.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
