import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BatchOperationResult, FileTransferResult, ScrcpySession } from '../src/shared/types'
import { ArtifactService, recordingPathForSession } from '../src/main/artifactService'

const directories: string[] = []
const now = new Date('2026-08-15T12:00:00.000Z')

async function service(): Promise<{ directory: string; store: ArtifactService }> {
  const directory = await mkdtemp(join(tmpdir(), 'scrcpy-gui-artifacts-'))
  directories.push(directory)
  return { directory, store: new ArtifactService(directory, () => now) }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('ArtifactService', () => {
  it('persists, reloads, filters and clones available artifact records', async () => {
    const { directory, store } = await service()
    const screenshot = join(directory, 'shot.png')
    await writeFile(screenshot, 'png-data')
    const saved = await store.register({ kind: 'screenshot', path: screenshot, deviceId: 'SERIAL' })

    expect(saved).toMatchObject({ kind: 'screenshot', status: 'available', name: 'shot.png', size: 8, deviceId: 'SERIAL' })
    const reloaded = new ArtifactService(directory, () => now)
    const listed = await reloaded.list({ limit: 10, kinds: ['screenshot'], deviceId: 'SERIAL' })
    expect(listed).toHaveLength(1)
    listed[0].metadata.mutated = true
    expect((await reloaded.list({ limit: 10 }))[0].metadata).not.toHaveProperty('mutated')
    if (process.platform !== 'win32') expect((await stat(join(directory, 'artifacts.json'))).mode & 0o777).toBe(0o600)
  })

  it('reconciles files removed outside the application as missing', async () => {
    const { directory, store } = await service()
    const path = join(directory, 'recording.mp4')
    await writeFile(path, 'video')
    await store.register({ kind: 'recording', path })
    await rm(path)

    expect(await store.list({ limit: 10 })).toMatchObject([{ status: 'missing', size: 0 }])
    await expect(store.getExisting((await store.list({ limit: 10 }))[0].id)).rejects.toThrow('missing')
  })

  it('indexes partial recordings as incomplete and deduplicates terminal session events', async () => {
    const { directory, store } = await service()
    const path = join(directory, 'partial.mp4')
    await writeFile(path, 'partial-video')
    const session: ScrcpySession = {
      id: 'session-1', serialAtLaunch: 'SERIAL', scene: 'screen', state: 'failed',
      args: ['--serial=SERIAL', `--record=${path}`], createdAt: now.toISOString(), exitCode: 7
    }

    expect(recordingPathForSession(session)).toBe(path)
    const first = await store.registerRecording(session)
    const second = await store.registerRecording(session)
    expect(first).toMatchObject({ status: 'incomplete', sessionId: 'session-1', metadata: { incomplete: true, exitCode: 7 } })
    expect(second?.id).toBe(first?.id)
    expect(await store.list({ limit: 10 })).toHaveLength(1)
  })

  it('does not claim an incomplete recording exists when no file was produced', async () => {
    const { directory, store } = await service()
    const session: ScrcpySession = {
      id: 'session-2', serialAtLaunch: 'SERIAL', scene: 'screen', state: 'failed',
      args: [`--record=${join(directory, 'never-created.mp4')}`], createdAt: now.toISOString()
    }
    await expect(store.registerRecording(session)).resolves.toMatchObject({ status: 'missing', size: 0 })
  })

  it('writes a path-safe transfer report and indexes it', async () => {
    const { store } = await service()
    const batch: BatchOperationResult<FileTransferResult> = {
      id: 'batch-1', startedAt: now.toISOString(), completedAt: now.toISOString(),
      results: [{
        targetId: 'SERIAL:report.txt', ok: true,
        data: { serial: 'SERIAL', sourceName: 'report.txt', size: 12, targetPath: '/sdcard/Download/report.txt', skipped: false, output: '1 file pushed' }
      }]
    }
    const artifact = await store.registerTransferReport('file-push', batch)
    const contents = await readFile(artifact.path, 'utf8')
    expect(artifact).toMatchObject({ kind: 'transfer-report', status: 'available', metadata: { total: 1, succeeded: 1, failed: 0 } })
    expect(contents).toContain('report.txt')
    expect(contents).not.toContain('/local/')
  })

  it('separates removing an index entry from permanently deleting its file', async () => {
    const { directory, store } = await service()
    const keptPath = join(directory, 'kept.png')
    const deletedPath = join(directory, 'deleted.png')
    await writeFile(keptPath, 'keep')
    await writeFile(deletedPath, 'delete')
    const kept = await store.register({ kind: 'screenshot', path: keptPath })
    const deleted = await store.register({ kind: 'screenshot', path: deletedPath })

    await store.delete(kept.id, false)
    await expect(stat(keptPath)).resolves.toBeTruthy()
    await store.delete(deleted.id, true)
    await expect(stat(deletedPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await store.list({ limit: 10 })).toEqual([])
  })

  it('rejects malformed queries without altering source files', async () => {
    const { directory, store } = await service()
    const source = join(directory, 'source.png')
    await writeFile(source, 'source')
    await expect(store.list({ limit: 0 })).rejects.toThrow('1 to 5000')
    await expect(store.list({ limit: 5, kinds: ['archive' as never] })).rejects.toThrow('unsupported kind')
    await expect(stat(source)).resolves.toBeTruthy()
  })
})
