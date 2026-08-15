import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm, stat, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type {
  ArtifactKind,
  ArtifactQuery,
  ArtifactRecord,
  ArtifactStatus,
  BatchOperationResult,
  BatchRunReport,
  FileTransferResult,
  ApkInstallResult,
  ScrcpySession
} from '../shared/types'
import { readBoundedRegularUtf8File } from './safeFile'

interface ArtifactIndex {
  schemaVersion: 1
  revision: number
  artifacts: ArtifactRecord[]
}

export interface RegisterArtifactInput {
  kind: ArtifactKind
  path: string
  deviceId?: string
  sessionId?: string
  status?: ArtifactStatus
  metadata?: Record<string, string | number | boolean>
}

const MAX_INDEX_BYTES = 4 * 1024 * 1024
const MAX_ARTIFACTS = 5_000
const kinds = new Set<ArtifactKind>(['screenshot', 'recording', 'transfer-report', 'diagnostic'])

function clone(record: ArtifactRecord): ArtifactRecord {
  return { ...record, metadata: { ...record.metadata } }
}

function recordPathFromArgs(args: string[]): string | undefined {
  return args.find((arg) => arg.startsWith('--record='))?.slice('--record='.length) || undefined
}

export function recordingPathForSession(session: ScrcpySession): string | undefined {
  return recordPathFromArgs(session.args)
}

function validateQuery(value: unknown): ArtifactQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Artifact query must be an object.')
  const query = value as ArtifactQuery
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > MAX_ARTIFACTS) {
    throw new TypeError(`Artifact query limit must be an integer from 1 to ${MAX_ARTIFACTS}.`)
  }
  if (query.kinds && (!Array.isArray(query.kinds) || query.kinds.some((kind) => !kinds.has(kind)))) {
    throw new TypeError('Artifact query contains an unsupported kind.')
  }
  if (query.deviceId !== undefined && (typeof query.deviceId !== 'string' || query.deviceId.length > 512)) {
    throw new TypeError('Artifact device filter is invalid.')
  }
  return { limit: query.limit, kinds: query.kinds ? [...new Set(query.kinds)] : undefined, deviceId: query.deviceId }
}

function artifactRecord(value: unknown): ArtifactRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Partial<ArtifactRecord>
  if (typeof source.id !== 'string' || source.id.length < 1 || source.id.length > 128 || !kinds.has(source.kind as ArtifactKind) ||
    !['available', 'missing', 'incomplete'].includes(String(source.status)) ||
    typeof source.createdAt !== 'string' || source.createdAt.length > 64 || typeof source.updatedAt !== 'string' || source.updatedAt.length > 64 ||
    typeof source.name !== 'string' || typeof source.path !== 'string' || source.path.length > 4_096 || !isAbsolute(source.path) ||
    typeof source.size !== 'number' || !Number.isFinite(source.size) || source.size < 0 ||
    !source.metadata || typeof source.metadata !== 'object' || Array.isArray(source.metadata)) return undefined
  const metadata: Record<string, string | number | boolean> = {}
  for (const [key, item] of Object.entries(source.metadata)) {
    if (key.length > 128 || (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') ||
      (typeof item === 'string' && item.length > 4_096) || (typeof item === 'number' && !Number.isFinite(item))) return undefined
    metadata[key] = item
  }
  return {
    id: source.id, kind: source.kind as ArtifactKind, status: source.status as ArtifactStatus,
    createdAt: source.createdAt, updatedAt: source.updatedAt, name: source.name.slice(0, 512), path: source.path,
    size: source.size, deviceId: typeof source.deviceId === 'string' ? source.deviceId : undefined,
    sessionId: typeof source.sessionId === 'string' ? source.sessionId : undefined, metadata
  }
}

export class ArtifactService {
  private readonly indexPath: string
  private readonly reportsDirectory: string
  private index: ArtifactIndex = { schemaVersion: 1, revision: 0, artifacts: [] }
  private loadPromise?: Promise<void>
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly directory: string, private readonly now = () => new Date()) {
    this.indexPath = join(directory, 'artifacts.json')
    this.reportsDirectory = join(directory, 'artifacts', 'reports')
  }

  async list(rawQuery: unknown): Promise<ArtifactRecord[]> {
    await this.load()
    const query = validateQuery(rawQuery)
    await this.reconcile()
    const allowedKinds = query.kinds?.length ? new Set(query.kinds) : undefined
    return this.index.artifacts
      .filter((item) => (!allowedKinds || allowedKinds.has(item.kind)) && (!query.deviceId || item.deviceId === query.deviceId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, query.limit)
      .map(clone)
  }

  async register(input: RegisterArtifactInput): Promise<ArtifactRecord> {
    await this.load()
    if (!kinds.has(input.kind) || !isAbsolute(input.path)) throw new TypeError('Artifact kind or path is invalid.')
    const existing = input.sessionId
      ? this.index.artifacts.find((item) => item.sessionId === input.sessionId && item.path === input.path)
      : undefined
    const file = await this.fileSnapshot(input.path)
    const requestedStatus = input.status === 'incomplete' && file.status === 'missing' ? 'missing' : input.status
    const timestamp = this.now().toISOString()
    if (existing) {
      existing.status = requestedStatus || file.status
      existing.size = file.size
      existing.updatedAt = timestamp
      existing.metadata = { ...existing.metadata, ...(input.metadata || {}) }
      await this.persist()
      return clone(existing)
    }
    const record: ArtifactRecord = {
      id: randomUUID(), kind: input.kind, status: requestedStatus || file.status,
      createdAt: timestamp, updatedAt: timestamp, name: basename(input.path), path: input.path, size: file.size,
      deviceId: input.deviceId, sessionId: input.sessionId, metadata: { ...(input.metadata || {}) }
    }
    this.index.artifacts.unshift(record)
    if (this.index.artifacts.length > MAX_ARTIFACTS) this.index.artifacts.length = MAX_ARTIFACTS
    await this.persist()
    return clone(record)
  }

  async registerRecording(session: ScrcpySession): Promise<ArtifactRecord | undefined> {
    const path = recordingPathForSession(session)
    if (!path) return undefined
    const incomplete = session.state === 'failed' || (session.exitCode !== undefined && session.exitCode !== 0)
    return this.register({
      kind: 'recording', path, deviceId: session.serialAtLaunch, sessionId: session.id,
      status: incomplete ? 'incomplete' : undefined,
      metadata: { scene: session.scene, incomplete, ...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }) }
    })
  }

  async registerTransferReport(
    kind: 'file-push' | 'apk-install',
    batch: BatchOperationResult<FileTransferResult | ApkInstallResult>
  ): Promise<ArtifactRecord> {
    await this.load()
    await mkdir(this.reportsDirectory, { recursive: true })
    const path = join(this.reportsDirectory, `${kind}-${batch.id}.json`)
    await this.atomicFile(path, `${JSON.stringify({ schemaVersion: 1, kind, ...batch }, null, 2)}\n`)
    return this.register({
      kind: 'transfer-report', path,
      metadata: {
        operation: kind,
        total: batch.results.length,
        succeeded: batch.results.filter((item) => item.ok).length,
        failed: batch.results.filter((item) => !item.ok).length
      }
    })
  }

  async registerBatchRunReport(report: BatchRunReport): Promise<ArtifactRecord> {
    await this.load()
    await mkdir(this.reportsDirectory, { recursive: true })
    const path = join(this.reportsDirectory, `batch-${report.actionType}-${report.id}.json`)
    await this.atomicFile(path, `${JSON.stringify({ schemaVersion: 1, kind: 'batch-run', ...report }, null, 2)}\n`)
    return this.register({
      kind: 'transfer-report', path,
      metadata: {
        operation: report.actionType,
        state: report.state,
        canceled: report.canceled,
        total: report.results.length,
        succeeded: report.results.filter((item) => item.ok).length,
        failed: report.results.filter((item) => !item.ok).length
      }
    })
  }

  async getExisting(id: string): Promise<ArtifactRecord> {
    await this.load()
    const record = this.index.artifacts.find((item) => item.id === id)
    if (!record) throw new Error('Artifact record was not found.')
    const file = await this.fileSnapshot(record.path)
    if (file.status === 'missing') {
      record.status = 'missing'
      record.size = 0
      record.updatedAt = this.now().toISOString()
      await this.persist()
      throw new Error('Artifact file is missing.')
    }
    return clone(record)
  }

  async delete(id: string, deleteFile: boolean): Promise<void> {
    await this.load()
    const index = this.index.artifacts.findIndex((item) => item.id === id)
    if (index < 0) throw new Error('Artifact record was not found.')
    const record = this.index.artifacts[index]
    if (deleteFile) {
      try {
        const info = await stat(record.path)
        if (!info.isFile()) throw new Error('Artifact path is not a regular file.')
        await unlink(record.path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    this.index.artifacts.splice(index, 1)
    await this.persist()
  }

  private async load(): Promise<void> {
    this.loadPromise ||= this.loadOnce()
    return this.loadPromise
  }

  private async loadOnce(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    let contents: string
    try {
      contents = await readBoundedRegularUtf8File(
        this.indexPath,
        MAX_INDEX_BYTES,
        'Artifact index must be a regular file no larger than 4 MiB.'
      )
    } catch {
      return
    }
    try {
      const parsed = JSON.parse(contents) as Partial<ArtifactIndex>
      if (parsed.schemaVersion !== 1 || !Number.isInteger(parsed.revision) || !Array.isArray(parsed.artifacts)) return
      const artifacts = parsed.artifacts.slice(0, MAX_ARTIFACTS).map(artifactRecord).filter(Boolean) as ArtifactRecord[]
      this.index = { schemaVersion: 1, revision: Number(parsed.revision), artifacts }
    } catch {
      // A corrupt optional index never blocks the application; source files remain untouched.
    }
  }

  private async reconcile(): Promise<void> {
    let changed = false
    await Promise.all(this.index.artifacts.map(async (record) => {
      const file = await this.fileSnapshot(record.path)
      const nextStatus = record.status === 'incomplete' && file.status === 'available' ? 'incomplete' : file.status
      if (record.status !== nextStatus || record.size !== file.size) {
        record.status = nextStatus
        record.size = file.size
        record.updatedAt = this.now().toISOString()
        changed = true
      }
    }))
    if (changed) await this.persist()
  }

  private async fileSnapshot(path: string): Promise<{ status: 'available' | 'missing'; size: number }> {
    try {
      const info = await stat(path)
      return info.isFile() ? { status: 'available', size: info.size } : { status: 'missing', size: 0 }
    } catch {
      return { status: 'missing', size: 0 }
    }
  }

  private async persist(): Promise<void> {
    this.index.revision += 1
    const snapshot = structuredClone(this.index)
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => this.atomicFile(this.indexPath, `${JSON.stringify(snapshot, null, 2)}\n`))
    await this.writeQueue
  }

  private async atomicFile(path: string, contents: string): Promise<void> {
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(dirname(path), { recursive: true })
    try {
      const handle = await open(temporaryPath, 'wx', 0o600)
      try {
        await handle.writeFile(contents, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporaryPath, path)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
  }
}
