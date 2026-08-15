import type {
  AutomationStep,
  BatchRunEvent,
  DeviceControlAction,
  OperationResult,
  RuntimeConfig
} from '../shared/types'
import { adbService, type AdbClient } from './adbService'

export interface DeviceGeometry {
  width: number
  height: number
  orientation: 'portrait' | 'landscape'
  aspectRatio: number
}

export interface AutomationScreenshotResult {
  message: string
  artifactId?: string
}

export interface AutomationRunnerDependencies {
  adb?: AdbClient
  control(runtime: RuntimeConfig, serial: string, action: DeviceControlAction): Promise<OperationResult<string>>
  startApp(runtime: RuntimeConfig, serial: string, packageId: string): Promise<string>
  screenshot(runtime: RuntimeConfig, serial: string, label?: string): Promise<AutomationScreenshotResult>
  now?: () => Date
}

export interface AutomationExecutionOptions {
  runId: string
  signal: AbortSignal
  onEvent?: (event: BatchRunEvent) => void
}

const SIZE_PATTERN = /(?:Physical|Override) size:\s*(\d+)x(\d+)/i

export function parseDeviceGeometry(sizeOutput: string, orientationOutput: string): DeviceGeometry {
  const size = sizeOutput.match(SIZE_PATTERN) || sizeOutput.match(/\b(\d+)x(\d+)\b/)
  if (!size) throw new Error('Android did not report a usable display size.')
  let width = Number(size[1])
  let height = Number(size[2])
  const rotation = Number(
    orientationOutput.match(/SurfaceOrientation:\s*([0-3])/i)?.[1] ||
    orientationOutput.match(/orientation=([0-3])/i)?.[1] ||
    0
  )
  if ((rotation === 1 || rotation === 3) && height > width) [width, height] = [height, width]
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Android reported an invalid display size.')
  }
  const orientation = width > height ? 'landscape' : 'portrait'
  return { width, height, orientation, aspectRatio: Math.max(width, height) / Math.min(width, height) }
}

function abortError(): Error {
  const error = new Error('Automation canceled.')
  error.name = 'AbortError'
  return error
}

function ensureActive(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}

function delay(durationMs: number, signal: AbortSignal): Promise<void> {
  ensureActive(signal)
  if (!durationMs) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel)
      resolve()
    }, durationMs)
    const cancel = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      reject(abortError())
    }
    signal.addEventListener('abort', cancel, { once: true })
  })
}

function inputText(value: string): string {
  return value.replaceAll('%', '%%').replaceAll(' ', '%s')
}

function messageFor(step: AutomationStep): string {
  if (step.type === 'control') return `Control: ${step.action}`
  if (step.type === 'delay') return `Wait ${step.durationMs} ms`
  if (step.type === 'start-app') return `Start ${step.packageId}`
  if (step.type === 'screenshot') return step.label ? `Screenshot: ${step.label}` : 'Screenshot'
  if (step.type === 'assert-device') return `Assert ${step.condition.type}`
  return step.type === 'text' ? 'Input non-sensitive text' : step.type === 'tap' ? 'Normalized tap' : 'Normalized swipe'
}

export class AutomationRunner {
  private readonly adb: AdbClient
  private readonly now: () => Date

  constructor(private readonly dependencies: AutomationRunnerDependencies) {
    this.adb = dependencies.adb || adbService
    this.now = dependencies.now || (() => new Date())
  }

  async inspect(runtime: RuntimeConfig, serial: string): Promise<DeviceGeometry> {
    const [size, orientation] = await Promise.all([
      this.adb.runForDevice(runtime, serial, ['shell', 'wm', 'size']),
      this.adb.runForDevice(runtime, serial, ['shell', 'dumpsys', 'input'])
    ])
    return parseDeviceGeometry(`${size.stdout}\n${size.stderr}`, `${orientation.stdout}\n${orientation.stderr}`)
  }

  async run(
    runtime: RuntimeConfig,
    serial: string,
    steps: AutomationStep[],
    options: AutomationExecutionOptions
  ): Promise<{ completedSteps: number; message: string }> {
    let geometry: DeviceGeometry | undefined
    let completedSteps = 0
    const emit = (status: BatchRunEvent['status'], step: AutomationStep, stepIndex: number, message: string): void => {
      options.onEvent?.({
        runId: options.runId,
        actionType: 'automation',
        targetId: serial,
        stepIndex,
        stepType: step.type,
        status,
        timestamp: this.now().toISOString(),
        message
      })
    }
    const getGeometry = async (): Promise<DeviceGeometry> => {
      geometry ||= await this.inspect(runtime, serial)
      return geometry
    }

    for (const [stepIndex, step] of steps.entries()) {
      ensureActive(options.signal)
      emit('step-start', step, stepIndex, messageFor(step))
      try {
        if (step.type === 'delay') {
          await delay(step.durationMs, options.signal)
        } else if (step.type === 'control') {
          const result = await this.dependencies.control(runtime, serial, step.action)
          if (!result.ok) throw new Error(result.error?.detail || result.error?.message || 'Device control failed.')
        } else if (step.type === 'tap') {
          const display = await getGeometry()
          await this.adb.runForDevice(runtime, serial, [
            'shell', 'input', 'tap', String(Math.round(step.x * (display.width - 1))), String(Math.round(step.y * (display.height - 1)))
          ])
        } else if (step.type === 'swipe') {
          const display = await getGeometry()
          await this.adb.runForDevice(runtime, serial, [
            'shell', 'input', 'swipe',
            String(Math.round(step.from.x * (display.width - 1))), String(Math.round(step.from.y * (display.height - 1))),
            String(Math.round(step.to.x * (display.width - 1))), String(Math.round(step.to.y * (display.height - 1))),
            String(step.durationMs)
          ])
        } else if (step.type === 'text') {
          await this.adb.runForDevice(runtime, serial, ['shell', 'input', 'text', inputText(step.value)])
        } else if (step.type === 'start-app') {
          await this.dependencies.startApp(runtime, serial, step.packageId)
        } else if (step.type === 'screenshot') {
          await this.dependencies.screenshot(runtime, serial, step.label)
        } else {
          const display = await getGeometry()
          if (step.condition.type === 'orientation' && display.orientation !== step.condition.value) {
            throw new Error(`Device orientation is ${display.orientation}; expected ${step.condition.value}.`)
          }
          if (step.condition.type === 'aspect-ratio' && Math.abs(display.aspectRatio - step.condition.value) > step.condition.tolerance) {
            throw new Error(`Device aspect ratio ${display.aspectRatio.toFixed(3)} is outside the expected tolerance.`)
          }
        }
        ensureActive(options.signal)
        completedSteps += 1
        emit('step-success', step, stepIndex, `${messageFor(step)} completed.`)
      } catch (error) {
        emit(options.signal.aborted ? 'step-skipped' : 'step-failure', step, stepIndex, error instanceof Error ? error.message : String(error))
        for (let skippedIndex = stepIndex + 1; skippedIndex < steps.length; skippedIndex += 1) {
          emit('step-skipped', steps[skippedIndex], skippedIndex, 'Skipped because the automation stopped before this step.')
        }
        throw error
      }
    }
    return { completedSteps, message: `Completed ${completedSteps} automation steps on ${serial}.` }
  }
}
