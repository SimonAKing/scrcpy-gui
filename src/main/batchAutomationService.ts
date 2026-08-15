import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type {
  BatchAction,
  BatchActionResult,
  BatchItemResult,
  BatchPreflight,
  BatchPreflightItem,
  BatchPreflightRequest,
  BatchRunEvent,
  BatchRunReport,
  CapabilitySnapshot,
  Device,
  DeviceControlAction,
  DeviceLaunch,
  FileConflictPolicy,
  FileTransferResult,
  ApkInstallResult,
  BatchOperationResult,
  OperationResult,
  RuntimeConfig,
  ScrcpySession
} from '../shared/types'
import { operationFailure, structuredErrorFromUnknown } from '../shared/errors'
import { scenesConflict } from '../shared/scenes'
import { AutomationRunner } from './automationRunner'

const PREFLIGHT_TTL_MS = 10 * 60_000
const TERMINAL_SESSION_STATES = new Set(['stopped', 'failed'])

interface FrozenPlan {
  runtime: RuntimeConfig
  request: BatchPreflightRequest
  preflight: BatchPreflight
  resource?: PreparedBatchResource
}

export interface PreparedBatchFile {
  path: string
  name: string
  size: number
}

export type PreparedBatchResource =
  | { kind: 'file-push'; files: PreparedBatchFile[] }
  | { kind: 'apk-install'; file: PreparedBatchFile }

export interface BatchAutomationDependencies {
  devices(): Device[]
  sessions(): ScrcpySession[]
  launch(runtime: RuntimeConfig, launches: DeviceLaunch[]): Promise<OperationResult<string[]>>
  control(runtime: RuntimeConfig, serial: string, action: DeviceControlAction): Promise<OperationResult<string>>
  screenshot(runtime: RuntimeConfig, serial: string, label?: string): Promise<{ message: string; artifactId?: string }>
  startApp(runtime: RuntimeConfig, serial: string, packageId: string): Promise<string>
  pushFiles(
    runtime: RuntimeConfig,
    serials: string[],
    files: PreparedBatchFile[],
    target: string,
    conflict: FileConflictPolicy
  ): Promise<BatchOperationResult<FileTransferResult>>
  installApk(
    runtime: RuntimeConfig,
    serials: string[],
    file: PreparedBatchFile,
    replace: boolean,
    downgrade: boolean
  ): Promise<BatchOperationResult<ApkInstallResult>>
  automationRunner: AutomationRunner
  now?: () => Date
  createId?: () => string
}

type BatchRunListener = (event: BatchRunEvent) => void

function featureForScene(scene: DeviceLaunch['launch']['scene']): keyof CapabilitySnapshot['features'] {
  return scene === 'virtual-display' ? 'virtualDisplay' : scene === 'record-only' ? 'recordOnly' : scene === 'control-only' ? 'controlOnly' : scene
}

function actionLabel(action: BatchAction, serial: string, resource?: PreparedBatchResource): string {
  if (action.type === 'launch') return `Launch ${action.launches.find((item) => item.serial === serial)?.launch.scene || 'scene'}`
  if (action.type === 'control') return `Control: ${action.action}`
  if (action.type === 'start-app') return `Start ${action.packageId}`
  if (action.type === 'automation') return `Run ${action.automation.name} (${action.automation.steps.length} steps)`
  if (action.type === 'file-push') return `Push ${resource?.kind === 'file-push' ? resource.files.length : 0} files to ${action.target}`
  if (action.type === 'apk-install') return `Install ${resource?.kind === 'apk-install' ? resource.file.name : 'APK'}`
  return 'Capture screenshot'
}

function needsConfirmation(action: BatchAction): boolean {
  return action.type === 'automation'
    ? action.automation.steps.some((step) => step.type === 'tap' || step.type === 'swipe' || step.type === 'text')
    : action.type === 'file-push'
      ? action.conflict === 'replace'
      : action.type === 'apk-install' && action.downgrade
}

function confirmationKind(action: BatchAction): BatchPreflight['confirmationKind'] {
  return action.type === 'automation' ? 'input' : action.type === 'file-push' ? 'overwrite' : action.type === 'apk-install' ? 'downgrade' : undefined
}

export function actionConcurrency(action: BatchAction, requested: number): number {
  const limit = action.type === 'file-push' || action.type === 'apk-install'
    ? 2
    : action.type === 'automation' || action.type === 'launch'
      ? 3
      : action.type === 'screenshot'
        ? 4
        : 8
  return Math.min(requested, limit)
}

async function mapLimit<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex++
      results[index] = await mapper(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()))
  return results
}

export class BatchAutomationService {
  private readonly plans = new Map<string, FrozenPlan>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly listeners = new Set<BatchRunListener>()
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(private readonly dependencies: BatchAutomationDependencies) {
    this.now = dependencies.now || (() => new Date())
    this.createId = dependencies.createId || randomUUID
  }

  subscribe(listener: BatchRunListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async preflight(
    runtime: RuntimeConfig,
    request: BatchPreflightRequest,
    capabilities?: CapabilitySnapshot,
    resource?: PreparedBatchResource
  ): Promise<BatchPreflight> {
    this.prunePlans()
    if (request.action.type === 'file-push' && (resource?.kind !== 'file-push' || !resource.files.length)) {
      throw new TypeError('Batch file push requires selected local files.')
    }
    if (request.action.type === 'apk-install' && resource?.kind !== 'apk-install') {
      throw new TypeError('Batch APK install requires a selected package.')
    }
    const devices = new Map(this.dependencies.devices().map((device) => [device.serial, device]))
    const sessions = this.dependencies.sessions().filter((session) => !TERMINAL_SESSION_STATES.has(session.state))
    const recordingPathBySerial = new Map<string, string>()
    const duplicateRecordingPaths = new Set<string>()
    if (request.action.type === 'launch') {
      const seen = new Set<string>()
      for (const launch of request.action.launches) {
        if (!launch.launch.recordEnabled || launch.launch.autoRecordName || !launch.launch.recordPath.trim()) continue
        const path = resolve(launch.launch.recordPath.trim())
        const key = process.platform === 'win32' ? path.toLocaleLowerCase() : path
        recordingPathBySerial.set(launch.serial, key)
        if (seen.has(key)) duplicateRecordingPaths.add(key)
        seen.add(key)
      }
    }
    const items = await Promise.all(request.serials.map(async (serial): Promise<BatchPreflightItem> => {
      const device = devices.get(serial)
      const online = Boolean(device && device.state !== 'offline')
      const authorized = device?.state === 'device'
      let capability: BatchPreflightItem['capability'] = 'pass'
      let sessionConflict = false
      const reasons: string[] = []
      if (!device) reasons.push('Device is not currently connected.')
      else if (device.state !== 'device') reasons.push(`Device state is ${device.state}; authorization is required.`)

      if (request.action.type === 'launch') {
        const launch = request.action.launches.find((item) => item.serial === serial)
        if (!launch) {
          capability = 'fail'
          reasons.push('No launch configuration is assigned to this device.')
        } else {
          const feature = featureForScene(launch.launch.scene)
          if (capabilities && !capabilities.features[feature]) {
            capability = 'fail'
            reasons.push(`The selected runtime does not report ${launch.launch.scene} support.`)
          } else if (!capabilities) {
            capability = 'warning'
            reasons.push('Runtime capabilities could not be confirmed.')
          }
          sessionConflict = sessions.some((session) =>
            session.serialAtLaunch === serial && scenesConflict(session.scene, launch.launch.scene)
          )
          if (sessionConflict) reasons.push('An active session conflicts with the selected scene.')
          const recordingPath = recordingPathBySerial.get(serial)
          if (recordingPath && duplicateRecordingPaths.has(recordingPath)) {
            capability = 'fail'
            reasons.push('Multiple devices would write to the same recording file.')
          }
        }
      }

      if (authorized && request.action.type === 'automation') {
        const automation = request.action.automation
        const needsGeometry = automation.design.orientation !== 'any' || automation.design.aspectRatio > 0 ||
          automation.steps.some((step) => step.type === 'tap' || step.type === 'swipe' || step.type === 'assert-device')
        if (needsGeometry) {
          try {
            const geometry = await this.dependencies.automationRunner.inspect(runtime, serial)
            if (automation.design.orientation !== 'any' && automation.design.orientation !== geometry.orientation) {
              capability = 'warning'
              reasons.push(`Current orientation is ${geometry.orientation}; automation was designed for ${automation.design.orientation}.`)
            }
            if (automation.design.aspectRatio > 0 && Math.abs(geometry.aspectRatio - automation.design.aspectRatio) > 0.08) {
              capability = 'warning'
              reasons.push(`Current aspect ratio ${geometry.aspectRatio.toFixed(3)} differs from the design ratio ${automation.design.aspectRatio.toFixed(3)}.`)
            }
          } catch (error) {
            capability = 'fail'
            reasons.push(error instanceof Error ? error.message : String(error))
          }
        }
      }

      return {
        serial,
        online,
        authorized,
        capability,
        sessionConflict,
        eligible: online && authorized && capability !== 'fail' && !sessionConflict,
        estimatedAction: actionLabel(request.action, serial, resource),
        reasons
      }
    }))
    const token = this.createId()
    const createdAt = this.now()
    const expiresAt = new Date(createdAt.getTime() + PREFLIGHT_TTL_MS)
    const preflight: BatchPreflight = {
      token,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      actionType: request.action.type,
      confirmationRequired: needsConfirmation(request.action),
      confirmationKind: needsConfirmation(request.action) ? confirmationKind(request.action) : undefined,
      items
    }
    this.plans.set(token, {
      runtime: structuredClone(runtime), request: structuredClone(request), preflight: structuredClone(preflight),
      resource: resource ? structuredClone(resource) : undefined
    })
    return preflight
  }

  start(
    runtime: RuntimeConfig,
    token: string,
    passingOnly: boolean,
    confirmedDangerous: boolean
  ): OperationResult<string> {
    this.prunePlans()
    const plan = this.plans.get(token)
    if (!plan) return operationFailure('BATCH_PREFLIGHT_EXPIRED', 'batch-start', 'Batch preflight is missing or expired.')
    if (JSON.stringify(plan.runtime) !== JSON.stringify(runtime)) {
      return operationFailure('BATCH_RUNTIME_CHANGED', 'batch-start', 'Runtime changed after preflight; inspect the batch again.')
    }
    if (plan.preflight.confirmationRequired && !confirmedDangerous) {
      return operationFailure('BATCH_CONFIRMATION_REQUIRED', 'batch-start', 'Tap, swipe, or text steps require explicit batch confirmation.')
    }
    const eligible = plan.preflight.items.filter((item) => item.eligible)
    if (!passingOnly && eligible.length !== plan.preflight.items.length) {
      return operationFailure('BATCH_PREFLIGHT_FAILED', 'batch-start', 'One or more devices failed preflight. Choose only passing devices or cancel.')
    }
    if (!eligible.length) return operationFailure('BATCH_NO_ELIGIBLE_TARGETS', 'batch-start', 'No devices passed preflight.')
    this.plans.delete(token)
    const runId = this.createId()
    const controller = new AbortController()
    this.controllers.set(runId, controller)
    void this.execute(runId, plan, new Set(eligible.map((item) => item.serial)), controller)
    return { ok: true, data: runId }
  }

  cancel(runId: string): OperationResult {
    const controller = this.controllers.get(runId)
    if (!controller) return operationFailure('BATCH_RUN_NOT_ACTIVE', 'batch-cancel', 'No active batch run was found.')
    controller.abort()
    return { ok: true }
  }

  stopAll(): void {
    for (const controller of this.controllers.values()) controller.abort()
  }

  private async execute(runId: string, plan: FrozenPlan, eligible: Set<string>, controller: AbortController): Promise<void> {
    const startedAt = this.now().toISOString()
    this.emit({ runId, actionType: plan.request.action.type, status: 'started', timestamp: startedAt, message: `Batch run started for ${eligible.size} devices.` })
    const skipped: BatchItemResult<BatchActionResult>[] = plan.preflight.items
      .filter((item) => !eligible.has(item.serial))
      .map((item) => ({
        targetId: item.serial,
        ok: false,
        error: {
          code: 'BATCH_TARGET_SKIPPED', stage: 'batch-preflight', message: 'Target was skipped after preflight.',
          detail: item.reasons.join(' '), retryable: true, suggestedActions: ['Reconnect or authorize the device, then run preflight again.']
        }
      }))
    const results = await mapLimit([...eligible], actionConcurrency(plan.request.action, plan.request.concurrencyLimit), async (serial) =>
      this.executeTarget(runId, plan.runtime, plan.request.action, serial, controller.signal, plan.resource)
    )
    const allResults = [...results, ...skipped]
    const succeeded = results.filter((item) => item.ok).length
    const canceled = controller.signal.aborted
    const state: BatchRunReport['state'] = canceled
      ? 'canceled'
      : succeeded === eligible.size && skipped.length === 0
        ? 'completed'
        : succeeded > 0
          ? 'partial'
          : 'failed'
    const report: BatchRunReport = {
      id: runId,
      actionType: plan.request.action.type,
      state,
      canceled,
      startedAt,
      completedAt: this.now().toISOString(),
      results: allResults
    }
    this.controllers.delete(runId)
    this.emit({
      runId,
      actionType: plan.request.action.type,
      status: canceled ? 'canceled' : 'completed',
      timestamp: report.completedAt,
      message: canceled ? 'Batch run canceled; no new steps will be scheduled.' : `Batch run finished with ${succeeded}/${eligible.size} successful targets.`,
      report
    })
  }

  private async executeTarget(
    runId: string,
    runtime: RuntimeConfig,
    action: BatchAction,
    serial: string,
    signal: AbortSignal,
    resource?: PreparedBatchResource
  ): Promise<BatchItemResult<BatchActionResult>> {
    if (signal.aborted) return this.canceledTarget(serial)
    try {
      let result: BatchActionResult
      if (action.type === 'launch') {
        const launch = action.launches.find((item) => item.serial === serial)
        if (!launch) throw new Error('Frozen launch plan is missing this device.')
        const launched = await this.dependencies.launch(runtime, [launch])
        if (!launched.ok) throw new Error(launched.error?.detail || launched.error?.message || 'Launch failed.')
        result = { serial, actionType: action.type, message: 'scrcpy session queued.', sessionIds: launched.data || [] }
      } else if (action.type === 'control') {
        const controlled = await this.dependencies.control(runtime, serial, action.action)
        if (!controlled.ok) throw new Error(controlled.error?.detail || controlled.error?.message || 'Control action failed.')
        result = { serial, actionType: action.type, message: controlled.data || `Control action sent to ${serial}.` }
      } else if (action.type === 'screenshot') {
        const captured = await this.dependencies.screenshot(runtime, serial)
        result = { serial, actionType: action.type, message: captured.message, artifactId: captured.artifactId }
      } else if (action.type === 'start-app') {
        result = { serial, actionType: action.type, message: await this.dependencies.startApp(runtime, serial, action.packageId) }
      } else if (action.type === 'automation') {
        const completed = await this.dependencies.automationRunner.run(runtime, serial, action.automation.steps, {
          runId,
          signal,
          onEvent: (event) => this.emit(event)
        })
        result = { serial, actionType: action.type, message: completed.message, completedSteps: completed.completedSteps }
      } else if (action.type === 'file-push') {
        if (resource?.kind !== 'file-push') throw new Error('Frozen file selection is missing.')
        const batch = await this.dependencies.pushFiles(runtime, [serial], resource.files, action.target, action.conflict)
        const failed = batch.results.find((item) => !item.ok)
        if (failed) throw new Error(failed.error?.detail || failed.error?.message || 'File push failed.')
        result = { serial, actionType: action.type, message: `Pushed ${batch.results.length} files to ${serial}.` }
      } else {
        if (resource?.kind !== 'apk-install') throw new Error('Frozen APK selection is missing.')
        const batch = await this.dependencies.installApk(runtime, [serial], resource.file, action.replace, action.downgrade)
        const installed = batch.results[0]
        if (!installed?.ok) throw new Error(installed?.error?.detail || installed?.error?.message || 'APK install failed.')
        result = { serial, actionType: action.type, message: installed.data?.output || `Installed ${resource.file.name}.` }
      }
      if (signal.aborted) return this.canceledTarget(serial)
      this.emit({ runId, actionType: action.type, targetId: serial, status: 'target-success', timestamp: this.now().toISOString(), message: result.message })
      return { targetId: serial, ok: true, data: result }
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) return this.canceledTarget(serial)
      const structured = structuredErrorFromUnknown(error, 'BATCH_TARGET_FAILED', `batch-${action.type}`, `Unable to complete ${actionLabel(action, serial, resource)} on ${serial}.`, {
        retryable: true,
        suggestedActions: ['Review the target result and device state before retrying.']
      })
      this.emit({ runId, actionType: action.type, targetId: serial, status: 'target-failure', timestamp: this.now().toISOString(), message: structured.message })
      return { targetId: serial, ok: false, error: structured }
    }
  }

  private canceledTarget(serial: string): BatchItemResult<BatchActionResult> {
    return {
      targetId: serial,
      ok: false,
      error: {
        code: 'BATCH_TARGET_CANCELED', stage: 'batch-cancel', message: 'Target canceled before completing.',
        retryable: true, suggestedActions: ['Run preflight again to retry this target.']
      }
    }
  }

  private emit(event: BatchRunEvent): void {
    for (const listener of this.listeners) listener(structuredClone(event))
  }

  private prunePlans(): void {
    const now = this.now().getTime()
    for (const [token, plan] of this.plans) {
      if (new Date(plan.preflight.expiresAt).getTime() <= now) this.plans.delete(token)
    }
  }
}
