import { randomUUID } from 'node:crypto'
import type { AutomationImportPreview, AutomationMacro } from '../shared/types'
import { automationMacro } from './ipcValidation'

interface AutomationDocument {
  schemaVersion: 1
  kind: 'scrcpy-gui-automation'
  appVersion: string
  automation: AutomationMacro
}

interface PendingImport {
  automation: AutomationMacro
  expiresAt: number
}

const MAX_IMPORT_BYTES = 2 * 1024 * 1024
const IMPORT_TTL_MS = 10 * 60_000

export class AutomationTransferService {
  private readonly pending = new Map<string, PendingImport>()

  constructor(
    private readonly now = () => new Date(),
    private readonly createId: () => string = randomUUID
  ) {}

  serialize(value: unknown, appVersion: string): string {
    const automation = automationMacro(value, 'automation export')
    const document: AutomationDocument = { schemaVersion: 1, kind: 'scrcpy-gui-automation', appVersion, automation }
    return `${JSON.stringify(document, null, 2)}\n`
  }

  preview(contents: string): AutomationImportPreview {
    this.prune()
    if (Buffer.byteLength(contents) > MAX_IMPORT_BYTES) throw new TypeError('Automation file exceeds the 2 MiB limit.')
    let raw: unknown
    try { raw = JSON.parse(contents) } catch { throw new TypeError('Automation file is not valid JSON.') }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Automation document must be an object.')
    const document = raw as Partial<AutomationDocument>
    if (document.schemaVersion !== 1 || document.kind !== 'scrcpy-gui-automation') {
      throw new TypeError('Automation document schema or kind is not supported.')
    }
    const automation = automationMacro(document.automation, 'automation import')
    const dangerousStepCount = automation.steps.filter((step) =>
      step.type === 'tap' || step.type === 'swipe' || step.type === 'text'
    ).length
    const warnings: string[] = []
    if (dangerousStepCount) warnings.push(`${dangerousStepCount} tap, swipe, or text steps require explicit confirmation before batch execution.`)
    if (automation.design.orientation === 'any' && automation.steps.some((step) => step.type === 'tap' || step.type === 'swipe')) {
      warnings.push('Normalized coordinates have no design orientation; inspect target geometry before running.')
    }
    const token = this.createId()
    this.pending.set(token, { automation: structuredClone(automation), expiresAt: this.now().getTime() + IMPORT_TTL_MS })
    return { token, automation: structuredClone(automation), warnings, dangerousStepCount, trusted: false }
  }

  commit(token: string): AutomationMacro {
    this.prune()
    const pending = this.pending.get(token)
    if (!pending) throw new Error('Automation import preview is missing or expired.')
    this.pending.delete(token)
    return structuredClone(pending.automation)
  }

  private prune(): void {
    const now = this.now().getTime()
    for (const [token, pending] of this.pending) {
      if (pending.expiresAt <= now) this.pending.delete(token)
    }
  }
}

export const automationTransferService = new AutomationTransferService()
