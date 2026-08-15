import { describe, expect, it, vi } from 'vitest'
import type { RuntimeConfig } from '../src/shared/types'
import {
  DeviceCapabilityService,
  parseCameraList,
  parseDisplayList,
  parseEncoderList
} from '../src/main/deviceCapabilityService'

const encoders = `[server] INFO: List of video encoders:
    --video-codec=h264 --video-encoder=c2.android.avc.encoder             (sw)
    --video-codec=h264 --video-encoder=OMX.qcom.video.encoder.avc        (hw) [vendor]
[server] INFO: List of audio encoders:
    --audio-codec=opus --audio-encoder=c2.android.opus.encoder           (sw) (alias for OMX.google.opus.encoder)
`

const displays = `[server] INFO: List of displays:
    --display-id=0    (1080x2400)
    --display-id=7    (size unknown)
`

const cameras = `[server] INFO: List of cameras:
    --camera-id=0    (back, 4032x3024, fps={15, 30, 60}, zoom-range=[1, 8])
    --camera-id=1    (front, 1920x1080, fps={30}, zoom-range=[1, 4])
`

const cameraSizes = `[server] INFO: List of cameras:
    --camera-id=0    (back, 4032x3024, fps={15, 30, 60}, zoom-range=[1, 8])
        - 1920x1080
        - 1280x720
      High speed capture (--camera-high-speed):
        - 1920x1080 (fps={120, 240})
    --camera-id=1    (front, 1920x1080, fps={30}, zoom-range=[1, 4])
        - 1280x720
`

describe('scrcpy capability output parsers', () => {
  it('parses encoder implementation, vendor and alias metadata', () => {
    expect(parseEncoderList(encoders)).toEqual([
      { kind: 'video', codec: 'h264', name: 'c2.android.avc.encoder', implementation: 'sw', vendor: false, aliasFor: undefined },
      { kind: 'video', codec: 'h264', name: 'OMX.qcom.video.encoder.avc', implementation: 'hw', vendor: true, aliasFor: undefined },
      { kind: 'audio', codec: 'opus', name: 'c2.android.opus.encoder', implementation: 'sw', vendor: false, aliasFor: 'OMX.google.opus.encoder' }
    ])
  })

  it('parses known and unknown display sizes', () => {
    expect(parseDisplayList(displays)).toEqual([
      { id: 0, width: 1080, height: 2400 }, { id: 7 }
    ])
  })

  it('associates normal and high-speed sizes with their cameras', () => {
    expect(parseCameraList(cameraSizes)).toMatchObject([
      {
        id: '0', facing: 'back', sensorWidth: 4032, sensorHeight: 3024, fps: [15, 30, 60],
        zoomRange: { min: 1, max: 8 },
        sizes: [
          { width: 1920, height: 1080, highSpeed: false, fps: [] },
          { width: 1280, height: 720, highSpeed: false, fps: [] },
          { width: 1920, height: 1080, highSpeed: true, fps: [120, 240] }
        ]
      },
      { id: '1', facing: 'front', sizes: [{ width: 1280, height: 720, highSpeed: false, fps: [] }] }
    ])
  })
})

describe('DeviceCapabilityService', () => {
  it('runs bounded argv-only probes sequentially, merges results and caches per runtime/device', async () => {
    let time = Date.parse('2026-08-15T13:00:00.000Z')
    const run = vi.fn(async (_file: string, args: string[], _timeout?: number, _maxBuffer?: number) => {
      const output: Record<string, string> = {
        '--list-encoders': encoders,
        '--list-displays': displays,
        '--list-cameras': cameras,
        '--list-camera-sizes': cameraSizes
      }
      return { stdout: '', stderr: output[args[1]] || '' }
    })
    const service = new DeviceCapabilityService(
      run,
      async () => '/runtime/scrcpy',
      () => time
    )
    const runtime: RuntimeConfig = { scrcpyPath: '/runtime/scrcpy' }
    const first = await service.probe(runtime, 'SERIAL-1')

    expect(run.mock.calls.map((call) => call[1])).toEqual([
      ['--serial=SERIAL-1', '--list-encoders'],
      ['--serial=SERIAL-1', '--list-displays'],
      ['--serial=SERIAL-1', '--list-cameras'],
      ['--serial=SERIAL-1', '--list-camera-sizes']
    ])
    expect(run.mock.calls.every((call) => call[2] === 20_000 && call[3] === 1024 * 1024)).toBe(true)
    expect(first).toMatchObject({
      serial: 'SERIAL-1', capturedAt: '2026-08-15T13:00:00.000Z', cached: false,
      videoEncoders: [{ name: 'c2.android.avc.encoder' }, { name: 'OMX.qcom.video.encoder.avc' }],
      audioEncoders: [{ name: 'c2.android.opus.encoder' }],
      displays: [{ id: 0, width: 1080, height: 2400 }, { id: 7 }],
      cameras: [{ id: '0', sizes: expect.any(Array) }, { id: '1', sizes: expect.any(Array) }]
    })

    time += 60_000
    expect((await service.probe(runtime, 'SERIAL-1')).cached).toBe(true)
    expect(run).toHaveBeenCalledTimes(4)
    await service.probe(runtime, 'SERIAL-1', true)
    expect(run).toHaveBeenCalledTimes(8)
  })

  it('returns partial data and per-probe errors instead of hiding successful probes', async () => {
    const service = new DeviceCapabilityService(
      async (_file, args) => {
        if (args[1] === '--list-camera-sizes') throw new Error('camera service unavailable')
        if (args[1] === '--list-cameras') return { stdout: '', stderr: 'List of cameras:\n    (access denied)' }
        return { stdout: '', stderr: args[1] === '--list-displays' ? displays : encoders }
      },
      async () => '/runtime/scrcpy'
    )
    const snapshot = await service.probe({ scrcpyPath: '' }, 'SERIAL-2')
    expect(snapshot.displays).toEqual([{ id: 0, width: 1080, height: 2400 }, { id: 7 }])
    expect(snapshot.videoEncoders).toHaveLength(2)
    expect(snapshot.cameras).toEqual([])
    expect(snapshot.errors).toEqual({
      cameras: 'Android denied camera access.',
      cameraSizes: 'camera service unavailable'
    })
  })
})
