import React from "react"
import { AudioPlanProvider } from "./audio-plan"
import { TimelineStoreProvider } from "./timeline"

/**
 * Project settings applied to rendering and timeline.
 *
 * レンダーやタイムラインに適用されるプロジェクト設定。
 *
 * @example
 * ```ts
 * const settings: ProjectSettings = { name: "demo", width: 1920, height: 1080, fps: 60 }
 * ```
 */
export type ProjectSettings = {
  name: string
  width: number
  height: number
  fps: number
}

type ProjectProps = {
  children: React.ReactNode
}

/**
 * Root container for the project render tree.
 *
 * プロジェクト描画ツリーのルートコンテナ。
 *
 * @example
 * ```tsx
 * <Project>
 *   <TimeLine>...</TimeLine>
 * </Project>
 * ```
 */
export const Project = ({ children }: ProjectProps) => {
  return (
    <TimelineStoreProvider>
      <AudioPlanProvider>
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            overflow: "hidden",
          }}
        >
          {children}
        </div>
      </AudioPlanProvider>
    </TimelineStoreProvider>
  )
}
