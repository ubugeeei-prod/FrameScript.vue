/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue"
  const component: DefineComponent<Record<string, never>, Record<string, never>>
  export default component
}

type RenderStartPayload = {
  width: number
  height: number
  fps: number
  totalFrames: number
  workers: number
  encode: "H264" | "H265"
  preset: string
  ffmpegThreads: number
  ffmpegLowMemory: boolean
}

interface Window {
  renderAPI?: {
    getPlatform: () => Promise<{
      platform: string
      binPath: string
      binName: string
      isDev?: boolean
    }>
    getOutputPath: () => Promise<{ path: string; displayPath?: string }>
    startRender: (
      payload: RenderStartPayload,
    ) => Promise<{ cmd: string; pid: number | undefined }>
    openProgress: () => Promise<void>
  }
}
