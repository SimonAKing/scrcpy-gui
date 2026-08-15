import type { CapabilitySnapshot } from '../shared/types'

export function parseScrcpyHelpFlags(help: string): string[] {
  return [...help.matchAll(/^\s+(?:-[A-Za-z0-9?],\s+)?(--[a-z0-9-]+)/gim)]
    .map((match) => match[1])
    .filter((flag, index, flags) => flags.indexOf(flag) === index)
    .sort()
}

export function buildCapabilitySnapshot(help: string, platform: NodeJS.Platform = process.platform): CapabilitySnapshot {
  const flags = parseScrcpyHelpFlags(help)
  const has = (flag: string): boolean => flags.includes(flag)

  return {
    flags,
    features: {
      screen: has('--video-source'),
      camera: has('--video-source') && has('--camera-id') && has('--list-cameras'),
      virtualDisplay: has('--new-display'),
      recordOnly: has('--record') && has('--no-playback'),
      controlOnly: has('--no-video'),
      otg: has('--otg'),
      v4l2: platform === 'linux' && has('--v4l2-sink'),
      appLaunch: has('--start-app') && has('--list-apps')
    },
    probes: {
      encoders: has('--list-encoders'),
      displays: has('--list-displays'),
      cameras: has('--list-cameras'),
      cameraSizes: has('--list-camera-sizes'),
      apps: has('--list-apps')
    }
  }
}
