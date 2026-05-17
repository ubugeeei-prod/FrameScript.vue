type CanvasFrameWaiter = (frame: number) => Promise<void> | void

const callbacks = new Map<string, CanvasFrameWaiter>()

const updateGlobalWaitCanvasFrame = () => {
  if (typeof window === "undefined") return
  const api = ((window as any).__frameScript ||= {})
  api.waitCanvasFrame = async (frame: number) => {
    const waiters = Array.from(callbacks.values())
    if (waiters.length === 0) return
    await Promise.all(waiters.map((callback) => callback(frame)))
  }
}

export const registerCanvasFrameWaiter = (
  id: string,
  callback: CanvasFrameWaiter,
) => {
  callbacks.set(id, callback)
  updateGlobalWaitCanvasFrame()

  return () => {
    callbacks.delete(id)
    updateGlobalWaitCanvasFrame()
  }
}
