import type {
  CameraInfo,
  CameraSizeInfo,
  DeviceCapabilitySnapshot,
  DisplayInfo,
  EncoderInfo,
  RuntimeConfig
} from '../shared/types'
import { executeCommand, resolveBinary, type CommandOutput } from './runtime'

const CACHE_TTL_MS = 5 * 60_000
const MAX_CACHE_ENTRIES = 50
const PROBE_TIMEOUT_MS = 20_000
const PROBE_MAX_BUFFER = 1024 * 1024

type ProbeKind = keyof DeviceCapabilitySnapshot['errors']
type Executor = (file: string, args: string[], timeout?: number, maxBuffer?: number) => Promise<CommandOutput>
type Resolver = (runtime: RuntimeConfig, binary: 'scrcpy' | 'adb') => Promise<string>

interface CacheEntry {
  expiresAt: number
  snapshot: DeviceCapabilitySnapshot
}

function numbers(value = ''): number[] {
  if (!value.trim()) return []
  return value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item))
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).trim().slice(0, 1_000) || 'Probe failed.'
}

export function parseEncoderList(output: string): EncoderInfo[] {
  const result: EncoderInfo[] = []
  const pattern = /--(video|audio)-codec=([^\s]+)\s+--\1-encoder=([^\s]+)([^\r\n]*)/g
  for (const match of output.matchAll(pattern)) {
    const metadata = match[4] || ''
    const implementation = metadata.match(/\((hw|sw|hybrid)\)/)?.[1] as EncoderInfo['implementation'] | undefined
    result.push({
      kind: match[1] as EncoderInfo['kind'], codec: match[2], name: match[3],
      implementation: implementation || 'unknown', vendor: metadata.includes('[vendor]'),
      aliasFor: metadata.match(/\(alias for ([^)]+)\)/)?.[1]
    })
  }
  return result
}

export function parseDisplayList(output: string): DisplayInfo[] {
  return [...output.matchAll(/--display-id=(\d+)\s+\((?:(\d+)x(\d+)|size unknown)\)/g)].map((match) => ({
    id: Number(match[1]),
    ...(match[2] && match[3] ? { width: Number(match[2]), height: Number(match[3]) } : {})
  }))
}

function cameraHeader(line: string): CameraInfo | undefined {
  const match = line.match(/--camera-id=([^\s]+)\s+\((front|back|external|unknown),\s*(\d+)x(\d+)(?:,\s*fps=\{([^}]*)\})?(?:,\s*zoom-range=\[([^,\]]+),\s*([^\]]+)\])?\)/)
  if (!match) return undefined
  const zoomMin = Number(match[6])
  const zoomMax = Number(match[7])
  return {
    id: match[1], facing: match[2] as CameraInfo['facing'], sensorWidth: Number(match[3]), sensorHeight: Number(match[4]),
    fps: numbers(match[5]),
    ...(Number.isFinite(zoomMin) && Number.isFinite(zoomMax) ? { zoomRange: { min: zoomMin, max: zoomMax } } : {}),
    sizes: []
  }
}

export function parseCameraList(output: string): CameraInfo[] {
  const cameras: CameraInfo[] = []
  let current: CameraInfo | undefined
  let highSpeed = false
  for (const line of output.split(/\r?\n/)) {
    const header = cameraHeader(line)
    if (header) {
      current = header
      cameras.push(current)
      highSpeed = false
      continue
    }
    if (!current) continue
    if (line.includes('High speed capture (--camera-high-speed)')) {
      highSpeed = true
      continue
    }
    const size = line.match(/-\s+(\d+)x(\d+)(?:\s+\(fps=\{([^}]*)\}\))?/)
    if (!size) continue
    const entry: CameraSizeInfo = {
      width: Number(size[1]), height: Number(size[2]), highSpeed, fps: numbers(size[3])
    }
    if (!current.sizes.some((item) =>
      item.width === entry.width && item.height === entry.height && item.highSpeed === entry.highSpeed
    )) current.sizes.push(entry)
  }
  return cameras
}

function mergeCameras(base: CameraInfo[], detailed: CameraInfo[]): CameraInfo[] {
  const merged = new Map(base.map((camera) => [camera.id, structuredClone(camera)]))
  for (const camera of detailed) {
    const existing = merged.get(camera.id)
    merged.set(camera.id, existing
      ? { ...existing, ...structuredClone(camera), sizes: structuredClone(camera.sizes) }
      : structuredClone(camera))
  }
  return [...merged.values()]
}

export class DeviceCapabilityService {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(
    private readonly run: Executor = executeCommand,
    private readonly resolve: Resolver = resolveBinary,
    private readonly now = () => Date.now()
  ) {}

  async probe(runtime: RuntimeConfig, serial: string, refresh = false): Promise<DeviceCapabilitySnapshot> {
    const executable = await this.resolve(runtime, 'scrcpy')
    if (!executable) throw new Error('scrcpy executable not found.')
    const key = `${executable}\0${serial}`
    const cached = this.cache.get(key)
    if (!refresh && cached && cached.expiresAt > this.now()) {
      return { ...structuredClone(cached.snapshot), cached: true }
    }
    if (cached) this.cache.delete(key)

    const outputs: Partial<Record<ProbeKind, string>> = {}
    const errors: DeviceCapabilitySnapshot['errors'] = {}
    const commands: Array<[ProbeKind, string]> = [
      ['encoders', '--list-encoders'], ['displays', '--list-displays'],
      ['cameras', '--list-cameras'], ['cameraSizes', '--list-camera-sizes']
    ]
    for (const [kind, flag] of commands) {
      try {
        const result = await this.run(
          executable, [`--serial=${serial}`, flag], PROBE_TIMEOUT_MS, PROBE_MAX_BUFFER
        )
        outputs[kind] = `${result.stdout}\n${result.stderr}`
        if (outputs[kind]?.includes('(access denied)')) errors[kind] = 'Android denied camera access.'
      } catch (error) {
        errors[kind] = message(error)
      }
    }

    const encoders = parseEncoderList(outputs.encoders || '')
    const snapshot: DeviceCapabilitySnapshot = {
      serial,
      capturedAt: new Date(this.now()).toISOString(),
      cached: false,
      videoEncoders: encoders.filter((encoder) => encoder.kind === 'video'),
      audioEncoders: encoders.filter((encoder) => encoder.kind === 'audio'),
      displays: parseDisplayList(outputs.displays || ''),
      cameras: mergeCameras(parseCameraList(outputs.cameras || ''), parseCameraList(outputs.cameraSizes || '')),
      errors
    }
    if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value as string)
    this.cache.set(key, { expiresAt: this.now() + CACHE_TTL_MS, snapshot: structuredClone(snapshot) })
    return snapshot
  }

  clear(): void {
    this.cache.clear()
  }
}

export const deviceCapabilityService = new DeviceCapabilityService()
