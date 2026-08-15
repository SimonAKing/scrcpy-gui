import { describe, expect, it } from 'vitest'
import { failureFromUnknown, operationErrorMessage, operationFailure, structuredError } from '../src/shared/errors'

describe('structured operation errors', () => {
  it('creates a stable public envelope with independent suggested actions', () => {
    const actions = ['Retry']
    const error = structuredError('ADB_LIST_FAILED', 'device-list', 'Unable to list devices.', {
      retryable: true,
      exitCode: 7,
      suggestedActions: actions
    })
    actions.push('mutated')
    expect(error).toEqual({
      code: 'ADB_LIST_FAILED',
      stage: 'device-list',
      message: 'Unable to list devices.',
      exitCode: 7,
      retryable: true,
      suggestedActions: ['Retry']
    })
  })

  it('keeps implementation details out of the default display message', () => {
    const result = failureFromUnknown(
      new Error('spawn /Users/example/private/adb ENOENT'),
      'ADB_LIST_FAILED',
      'device-list',
      'Unable to list Android devices.'
    )
    expect(operationErrorMessage(result, 'fallback')).toBe('Unable to list Android devices.')
    expect(result.error?.detail).toContain('/Users/example/private/adb')
  })

  it('uses the supplied fallback only when no structured error is present', () => {
    expect(operationErrorMessage(operationFailure('X', 'test', 'Known error.'), 'fallback')).toBe('Known error.')
    expect(operationErrorMessage({}, 'fallback')).toBe('fallback')
  })
})
