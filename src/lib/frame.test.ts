import { describe, expect, it, vi } from "vitest"
import { PROJECT_SETTINGS } from "../../project/project"
import { createFrameStore, seconds } from "./frame"

describe("frame store", () => {
  it("clamps and floors frame updates deterministically", () => {
    const store = createFrameStore(2.9)
    expect(store.get()).toBe(2)

    store.set(12.8)
    expect(store.get()).toBe(12)

    store.set(-4)
    expect(store.get()).toBe(0)
  })

  it("notifies subscribers only when the frame changes", () => {
    const store = createFrameStore(0)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.set(0)
    store.set(1)
    store.set(1.4)
    store.set(2)
    unsubscribe()
    store.set(3)

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("converts seconds using project fps", () => {
    expect(seconds(1.5)).toBe(PROJECT_SETTINGS.fps * 1.5)
  })
})
