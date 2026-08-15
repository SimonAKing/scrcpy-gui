import type { ScrcpyApi } from '../shared/types'

declare global {
  interface Window {
    scrcpy: ScrcpyApi
  }
}

export {}
