import { randomUUID } from 'node:crypto'
import type { AppEvent, AppEventDomain, AppEventLevel, AppEventQuery } from '../shared/types'

export type AppEventInput = Omit<AppEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string }
type EventListener = (event: AppEvent) => void

const MAX_EVENT_MESSAGE_BYTES = 16 * 1024
const MAX_EVENT_DATA_BYTES = 16 * 1024

function truncateUtf8(value: string, maxBytes: number): { value: string; originalLength?: number } {
  const originalLength = Buffer.byteLength(value)
  if (originalLength <= maxBytes) return { value }
  let end = value.length
  while (end > 0 && Buffer.byteLength(value.slice(0, end)) > maxBytes - 3) end -= Math.max(1, Math.ceil((Buffer.byteLength(value.slice(0, end)) - maxBytes) / 2))
  while (end > 0 && Buffer.byteLength(value.slice(0, end)) > maxBytes - 3) end -= 1
  return { value: `${value.slice(0, end)}…`, originalLength }
}

function boundedData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined
  try {
    const encoded = JSON.stringify(data)
    if (Buffer.byteLength(encoded) <= MAX_EVENT_DATA_BYTES) return structuredClone(data)
    return { truncated: true, originalLength: Buffer.byteLength(encoded) }
  } catch {
    return { truncated: true, reason: 'non-serializable event data' }
  }
}

export class EventStore {
  private readonly events: AppEvent[] = []
  private readonly listeners = new Set<EventListener>()

  constructor(private readonly capacity = 5_000, private readonly now = () => new Date()) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new TypeError('EventStore capacity must be a positive integer.')
  }

  publish(input: AppEventInput): AppEvent {
    const message = truncateUtf8(input.message, MAX_EVENT_MESSAGE_BYTES)
    const data = boundedData(input.data)
    const event: AppEvent = {
      ...input,
      id: input.id || randomUUID(),
      timestamp: input.timestamp || this.now().toISOString(),
      message: message.value,
      data: message.originalLength ? { ...data, messageTruncated: true, originalLength: message.originalLength } : data
    }
    this.events.push(event)
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity)
    for (const listener of this.listeners) listener(structuredClone(event))
    return structuredClone(event)
  }

  list(query: AppEventQuery): AppEvent[] {
    const levels = query.levels?.length ? new Set<AppEventLevel>(query.levels) : undefined
    const domains = query.domains?.length ? new Set<AppEventDomain>(query.domains) : undefined
    return this.events
      .filter((event) => (!levels || levels.has(event.level)) && (!domains || domains.has(event.domain)))
      .slice(-query.limit)
      .map((event) => structuredClone(event))
  }

  clear(): void {
    this.events.length = 0
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export function validateEventQuery(value: unknown): AppEventQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('event query must be an object.')
  const source = value as Record<string, unknown>
  if (!Number.isInteger(source.limit) || Number(source.limit) < 1 || Number(source.limit) > 5_000) {
    throw new TypeError('event query limit must be an integer from 1 to 5000.')
  }
  const validLevels = new Set<AppEventLevel>(['debug', 'info', 'warn', 'error'])
  const validDomains = new Set<AppEventDomain>(['runtime', 'device', 'session', 'config', 'automation', 'artifact', 'update'])
  const enumArray = <T extends string>(input: unknown, name: string, allowed: Set<T>): T[] | undefined => {
    if (input === undefined) return undefined
    if (!Array.isArray(input) || input.length > allowed.size || input.some((item) => typeof item !== 'string' || !allowed.has(item as T))) {
      throw new TypeError(`${name} contains an unsupported value.`)
    }
    return [...new Set(input as T[])]
  }
  return {
    limit: Number(source.limit),
    levels: enumArray(source.levels, 'event query levels', validLevels),
    domains: enumArray(source.domains, 'event query domains', validDomains)
  }
}
