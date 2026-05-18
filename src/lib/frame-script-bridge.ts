export type FrameScriptBridge = {
  setFrame?: (frame: number) => void
  getFrame?: () => number
  waitAnimationsReady?: () => Promise<void>
  getAnimationsPending?: () => number
  waitImagesReady?: () => Promise<void>
  getImagesPending?: () => number
  waitAudioWaveformsReady?: () => Promise<void>
  getAudioWaveformsPending?: () => number
  waitPsdReady?: () => Promise<void>
  waitPsdFrame?: (frame: number) => Promise<void>
  getPsdPending?: () => number
  waitWebGLReady?: () => Promise<void>
  waitWebGLFrame?: (frame: number) => Promise<void>
  getWebGLPending?: () => number
  waitDrawTextReady?: () => Promise<void>
  getDrawTextPending?: () => number
  waitMediaMetadataReady?: () => Promise<void>
  getMediaMetadataPending?: () => number
}

declare global {
  interface Window {
    __frameScript?: FrameScriptBridge
  }
}

export const getFrameScriptBridge = () => {
  if (typeof window === "undefined") return null
  window.__frameScript ??= {}
  return window.__frameScript
}

export const registerFrameScriptApi = (api: Partial<FrameScriptBridge>) => {
  const bridge = getFrameScriptBridge()
  if (!bridge) return () => {}

  const previous = new Map<keyof FrameScriptBridge, unknown>()
  for (const key of Object.keys(api) as (keyof FrameScriptBridge)[]) {
    previous.set(key, bridge[key])
    ;(bridge as Record<keyof FrameScriptBridge, unknown>)[key] = api[key]
  }

  return () => {
    const current = getFrameScriptBridge()
    if (!current) return
    for (const key of Object.keys(api) as (keyof FrameScriptBridge)[]) {
      const value = previous.get(key)
      if (value === undefined) {
        delete current[key]
      } else {
        ;(current as Record<keyof FrameScriptBridge, unknown>)[key] = value
      }
    }
  }
}
