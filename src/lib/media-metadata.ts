import { registerFrameScriptApi } from "./frame-script-bridge"

let pending = 0
const waiters = new Set<() => void>()
let installed = false

const notifyIfReady = () => {
  if (pending !== 0) return
  for (const resolve of Array.from(waiters)) {
    resolve()
  }
  waiters.clear()
}

const waitForStableTick = () =>
  new Promise<void>((resolve) => {
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      setTimeout(resolve, 0)
      return
    }
    window.requestAnimationFrame(() => resolve())
  })

export const installMediaMetadataApi = () => {
  if (installed || typeof window === "undefined") return
  installed = true
  registerFrameScriptApi({
    waitMediaMetadataReady: async () => {
      while (true) {
        if (pending === 0) {
          await waitForStableTick()
          if (pending === 0) return
        }
        await new Promise<void>((resolve) => waiters.add(resolve))
      }
    },
    getMediaMetadataPending: () => pending,
  })
}

export const trackMediaMetadataPromise = <T>(promise: Promise<T>) => {
  installMediaMetadataApi()
  pending += 1
  return promise.finally(() => {
    pending = Math.max(0, pending - 1)
    notifyIfReady()
  })
}
