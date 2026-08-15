import type { Device, DeviceState, LaunchConfig } from '../shared/types'

const HOST_LABEL = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/

export function isSupportedScrcpyVersion(version: string): boolean {
  const match = version.match(/\bscrcpy\s+(\d+)(?:\.|\b)/i)
  return Boolean(match && Number(match[1]) >= 4)
}

export function parseAdbDevices(output: string): Device[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial = '', stateValue = 'unknown', ...metadata] = line.split(/\s+/)
      const values = Object.fromEntries(
        metadata
          .map((entry) => entry.split(/:(.*)/s).slice(0, 2))
          .filter(([key, value]) => key && value)
      )
      const knownStates: DeviceState[] = ['device', 'offline', 'unauthorized', 'recovery']
      const state = knownStates.includes(stateValue as DeviceState)
        ? (stateValue as DeviceState)
        : 'unknown'

      return {
        serial,
        state,
        model: (values.model || serial).replaceAll('_', ' '),
        product: values.product || '',
        device: values.device || '',
        transportId: values.transport_id,
        connection: serial.includes(':') ? 'wireless' : 'usb'
      }
    })
}

function validPort(value: string): boolean {
  if (!/^\d{1,5}$/.test(value)) return false
  const port = Number(value)
  return port >= 1 && port <= 65535
}

function validIpv4(value: string): boolean {
  const octets = value.split('.')
  return octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
}

function validHostname(value: string): boolean {
  return value.length <= 253 && value.split('.').every((label) => HOST_LABEL.test(label))
}

export function validateDeviceAddress(value: string, requirePort = false): boolean {
  const target = value.trim()
  if (!target || /\s/.test(target)) return false

  if (target.startsWith('[')) {
    const match = target.match(/^\[([0-9a-fA-F:]+)](?::(\d{1,5}))?$/)
    if (!match || !match[1].includes(':')) return false
    return requirePort ? Boolean(match[2] && validPort(match[2])) : !match[2] || validPort(match[2])
  }

  const colonCount = (target.match(/:/g) || []).length
  if (colonCount > 1) return false
  const [host, port] = target.split(':')
  if (/^[\d.]+$/.test(host) && !validIpv4(host)) return false
  if (!validIpv4(host) && !validHostname(host)) return false
  if (requirePort) return Boolean(port && validPort(port))
  return !port || validPort(port)
}

export function splitExtraArgs(value: string): string[] {
  const args = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)

  if (args.some((arg) => arg === '-s' || arg.startsWith('--serial'))) {
    throw new Error('Device serial is managed by Scrcpy GUI and cannot be overridden in extra arguments.')
  }
  if (args.some((arg) => arg.includes('\0'))) throw new Error('Additional arguments may not contain null bytes.')
  return args
}

export function validatePortRange(value: string): boolean {
  const ports = value.trim().split(':')
  if (ports.length < 1 || ports.length > 2 || ports.some((port) => !validPort(port))) return false
  return ports.length === 1 || Number(ports[0]) <= Number(ports[1])
}

function validatePair(name: string, width: number, height: number): void {
  const hasWidth = width > 0
  const hasHeight = height > 0
  if (hasWidth !== hasHeight) {
    throw new Error(`${name} width and height must either both be zero or both be greater than zero.`)
  }
}

export function buildScrcpyArgs(config: LaunchConfig, serial: string): string[] {
  if (!serial.trim()) throw new Error('A device serial is required.')
  validatePair('Crop', config.crop.width, config.crop.height)
  validatePair('Window', config.window.width, config.window.height)
  if (config.recordEnabled && !config.recordPath.trim()) {
    throw new Error('Choose a recording file before starting scrcpy.')
  }

  const args: string[] = [`--serial=${serial}`]

  if (config.windowTitle.trim()) args.push(`--window-title=${config.windowTitle.trim()}`)
  if (config.shortcutModifier !== 'default') args.push(`--shortcut-mod=${config.shortcutModifier}`)
  if (config.keyboardMode !== 'default') args.push(`--keyboard=${config.keyboardMode}`)
  if (config.mouseMode !== 'default') args.push(`--mouse=${config.mouseMode}`)
  if (config.gamepadMode !== 'default') args.push(`--gamepad=${config.gamepadMode}`)
  if (config.videoCodec !== 'default') args.push(`--video-codec=${config.videoCodec}`)
  if (config.videoBitRate > 0 && config.videoBitRate !== 8) args.push(`--video-bit-rate=${config.videoBitRate}M`)
  if (config.videoBuffer > 0) args.push(`--video-buffer=${Math.trunc(config.videoBuffer)}`)
  if (config.audioBuffer > 0) args.push(`--audio-buffer=${Math.trunc(config.audioBuffer)}`)
  if (config.maxSize > 0) args.push(`--max-size=${Math.trunc(config.maxSize)}`)
  if (config.maxFps > 0) args.push(`--max-fps=${Math.trunc(config.maxFps)}`)
  if (config.displayId > 0) args.push(`--display-id=${Math.trunc(config.displayId)}`)
  if (config.orientation !== '0') args.push(`--orientation=${config.orientation}`)

  if (config.recordEnabled) {
    args.push(`--record=${config.recordPath.trim()}`)
    if (config.noPlayback) args.push('--no-playback', '--no-window')
  }
  if (config.alwaysOnTop) args.push('--always-on-top')
  if (!config.control) args.push('--no-control')
  if (!config.audio) args.push('--no-audio')
  if (config.turnScreenOff) args.push('--turn-screen-off')
  if (config.stayAwake) args.push('--stay-awake')
  if (config.showTouches) args.push('--show-touches')
  if (config.fullscreen) args.push('--fullscreen')
  if (config.borderless) args.push('--window-borderless')
  if (!config.windowAspectRatioLock) args.push('--no-window-aspect-ratio-lock')
  if (config.pushTarget.trim()) {
    if (config.pushTarget.includes('\0')) throw new Error('Push target may not contain null bytes.')
    args.push(`--push-target=${config.pushTarget.trim()}`)
  }
  if (config.tunnelPort.trim()) {
    if (!validatePortRange(config.tunnelPort)) throw new Error('Tunnel port must be a port or ascending port range from 1 to 65535.')
    args.push(`--port=${config.tunnelPort.trim()}`)
  }

  if (config.crop.width > 0) {
    args.push(`--crop=${Math.trunc(config.crop.width)}:${Math.trunc(config.crop.height)}:${Math.trunc(config.crop.x)}:${Math.trunc(config.crop.y)}`)
  }
  if (config.window.x !== 0) args.push(`--window-x=${Math.trunc(config.window.x)}`)
  if (config.window.y !== 0) args.push(`--window-y=${Math.trunc(config.window.y)}`)
  if (config.window.width > 0) {
    args.push(`--window-width=${Math.trunc(config.window.width)}`)
    args.push(`--window-height=${Math.trunc(config.window.height)}`)
  }

  return [...args, ...splitExtraArgs(config.extraArgs)]
}
