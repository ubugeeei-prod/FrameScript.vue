import { describe, expect, it } from "vitest"
import { __animationTestUtils, type VariableType } from "./animation"

const { assertCompatibleValue, getKind, lerpForKind, sampleVariable } =
  __animationTestUtils

describe("animation internals", () => {
  it("classifies supported variable shapes", () => {
    expect(getKind(1)).toBe("number")
    expect(getKind({ x: 0, y: 1 })).toBe("vec2")
    expect(getKind({ x: 0, y: 1, z: 2 })).toBe("vec3")
    expect(getKind("#336699")).toBe("color")
    expect(getKind("not-a-color")).toBeNull()
  })

  it("rejects incompatible variable assignments", () => {
    expect(() => assertCompatibleValue("vec2", { x: 1, y: 2 })).not.toThrow()
    expect(() => assertCompatibleValue("vec2", 1)).toThrow(
      /value shape mismatch/,
    )
  })

  it("samples deterministic frame progression across segments", () => {
    const state = {
      initial: 0 as VariableType,
      kind: "number" as const,
      lerp: lerpForKind("number"),
      ownerId: null,
      segments: [
        { start: 10, end: 20, from: 0, to: 100 },
        { start: 21, end: 30, from: 100, to: 200 },
      ],
    }

    expect(sampleVariable(state, 0)).toBe(0)
    expect(sampleVariable(state, 10)).toBe(0)
    expect(sampleVariable(state, 15)).toBe(50)
    expect(sampleVariable(state, 20)).toBe(100)
    expect(sampleVariable(state, 25)).toBeCloseTo(144.444, 3)
    expect(sampleVariable(state, 31)).toBe(200)
  })
})
