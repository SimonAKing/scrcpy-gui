import { describe, expect, it, vi } from 'vitest'
import { EventStore, validateEventQuery } from '../src/main/eventStore'

describe('EventStore', () => {
  it('keeps a bounded, cloned event history in publication order', () => {
    const store = new EventStore(2, () => new Date('2026-08-15T08:00:00.000Z'))
    const first = store.publish({ id: 'one', level: 'info', domain: 'runtime', action: 'one', message: 'first' })
    store.publish({ id: 'two', level: 'warn', domain: 'device', action: 'two', message: 'second' })
    store.publish({ id: 'three', level: 'error', domain: 'session', action: 'three', message: 'third' })

    first.message = 'mutated'
    expect(store.list({ limit: 5 }).map((event) => event.id)).toEqual(['two', 'three'])
    const listed = store.list({ limit: 5 })
    listed[0].message = 'also mutated'
    expect(store.list({ limit: 5 })[0].message).toBe('second')
  })

  it('filters by level and domain before applying the requested limit', () => {
    const store = new EventStore()
    store.publish({ id: 'one', level: 'info', domain: 'device', action: 'one', message: 'one' })
    store.publish({ id: 'two', level: 'error', domain: 'session', action: 'two', message: 'two' })
    store.publish({ id: 'three', level: 'error', domain: 'device', action: 'three', message: 'three' })

    expect(store.list({ limit: 1, levels: ['error'], domains: ['device'] }).map((event) => event.id)).toEqual(['three'])
  })

  it('bounds large messages and non-serializable or oversized event data', () => {
    const store = new EventStore()
    const message = '🙂'.repeat(5_000)
    const bounded = store.publish({ level: 'error', domain: 'runtime', action: 'large', message })
    expect(Buffer.byteLength(bounded.message)).toBeLessThanOrEqual(16 * 1024)
    expect(bounded.data).toMatchObject({ messageTruncated: true, originalLength: Buffer.byteLength(message) })

    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(store.publish({ level: 'warn', domain: 'config', action: 'circular', message: 'x', data: circular }).data)
      .toEqual({ truncated: true, reason: 'non-serializable event data' })
    expect(store.publish({ level: 'debug', domain: 'device', action: 'large-data', message: 'x', data: { value: 'x'.repeat(20_000) } }).data)
      .toEqual({ truncated: true, originalLength: 20_012 })
  })

  it('notifies subscribers with clones and supports unsubscribe and clear', () => {
    const store = new EventStore()
    const listener = vi.fn((event) => { event.message = 'mutated' })
    const unsubscribe = store.subscribe(listener)
    store.publish({ id: 'one', level: 'info', domain: 'runtime', action: 'one', message: 'original' })
    unsubscribe()
    store.publish({ id: 'two', level: 'info', domain: 'runtime', action: 'two', message: 'second' })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.list({ limit: 5 })[0].message).toBe('original')
    store.clear()
    expect(store.list({ limit: 5 })).toEqual([])
  })
})

describe('validateEventQuery', () => {
  it('accepts bounded filters, removes duplicates and rejects unknown values', () => {
    expect(validateEventQuery({ limit: 25, levels: ['warn', 'warn'], domains: ['device'] })).toEqual({
      limit: 25,
      levels: ['warn'],
      domains: ['device']
    })
    expect(() => validateEventQuery({ limit: 0 })).toThrow('1 to 5000')
    expect(() => validateEventQuery({ limit: 5, levels: ['fatal'] })).toThrow('unsupported')
    expect(() => validateEventQuery({ limit: 5, domains: ['shell'] })).toThrow('unsupported')
  })
})
