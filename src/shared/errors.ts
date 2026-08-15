import type { OperationResult, StructuredError } from './types'

interface StructuredErrorOptions {
  detail?: string
  exitCode?: number
  retryable?: boolean
  suggestedActions?: string[]
}

export function structuredError(
  code: string,
  stage: string,
  message: string,
  options: StructuredErrorOptions = {}
): StructuredError {
  return {
    code,
    stage,
    message,
    ...(options.detail ? { detail: options.detail } : {}),
    ...(options.exitCode !== undefined ? { exitCode: options.exitCode } : {}),
    retryable: options.retryable ?? false,
    suggestedActions: [...(options.suggestedActions || [])]
  }
}

export function operationFailure<T = undefined>(
  code: string,
  stage: string,
  message: string,
  options: StructuredErrorOptions = {}
): OperationResult<T> {
  return { ok: false, error: structuredError(code, stage, message, options) }
}

export function failureFromUnknown<T = undefined>(
  error: unknown,
  code: string,
  stage: string,
  fallback: string,
  options: StructuredErrorOptions = {}
): OperationResult<T> {
  return { ok: false, error: structuredErrorFromUnknown(error, code, stage, fallback, options) }
}

export function structuredErrorFromUnknown(
  error: unknown,
  code: string,
  stage: string,
  fallback: string,
  options: StructuredErrorOptions = {}
): StructuredError {
  const detail = error instanceof Error && error.message.trim() ? error.message : String(error || '')
  const exitCode = typeof (error as { exitCode?: unknown } | null)?.exitCode === 'number'
    ? (error as { exitCode: number }).exitCode
    : options.exitCode
  return structuredError(code, stage, fallback, {
    ...options,
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(options.detail || !detail ? {} : { detail })
  })
}

export function operationErrorMessage(
  result: Pick<OperationResult<unknown>, 'error'>,
  fallback: string
): string {
  return result.error?.message || fallback
}
