import React, { useContext, useMemo, useRef, useSyncExternalStore } from "react"

/**
 * Audio source reference used for timeline audio segments.
 *
 * タイムラインの音声セグメントで使う参照情報。
 *
 * @example
 * ```ts
 * const src: AudioSourceRef = { kind: "video", path: "assets/demo.mp4" }
 * ```
 */
export type AudioSourceRef =
  | { kind: "video"; path: string }
  | { kind: "sound"; path: string } // reserved for future <Sound />

/**
 * Audio segment mapped onto the project timeline.
 *
 * プロジェクトタイムライン上の音声セグメント。
 *
 * @example
 * ```ts
 * const seg: AudioSegment = {
 *   id: "music",
 *   source: { kind: "sound", path: "assets/music.mp3" },
 *   projectStartFrame: 0,
 *   sourceStartFrame: 0,
 *   durationFrames: 300,
 * }
 * ```
 */
export type AudioSegment = {
  id: string
  source: AudioSourceRef
  projectStartFrame: number
  sourceStartFrame: number
  durationFrames: number
  fadeInFrames?: number
  fadeOutFrames?: number
  volume?: number
  clipId?: string
  showWaveform?: boolean
}

type Listener = () => void

type AudioPlanStore = {
  getSegments: () => AudioSegment[]
  subscribe: (listener: Listener) => () => void
  registerSegment: (segment: AudioSegment) => void
  unregisterSegment: (id: string) => void
  clear: () => void
}

const createAudioPlanStore = (): AudioPlanStore => {
  let segments: AudioSegment[] = []
  const listeners = new Set<Listener>()

  const notify = () => {
    listeners.forEach((listener) => listener())
  }

  return {
    getSegments: () => segments,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    registerSegment: (segment) => {
      const existing = segments.find((item) => item.id === segment.id)
      if (
        existing &&
        existing.source.kind === segment.source.kind &&
        ("path" in existing.source ? existing.source.path : "") ===
          ("path" in segment.source ? segment.source.path : "") &&
        existing.projectStartFrame === segment.projectStartFrame &&
        existing.sourceStartFrame === segment.sourceStartFrame &&
        existing.durationFrames === segment.durationFrames &&
        (existing.fadeInFrames ?? 0) === (segment.fadeInFrames ?? 0) &&
        (existing.fadeOutFrames ?? 0) === (segment.fadeOutFrames ?? 0) &&
        (existing.volume ?? 1) === (segment.volume ?? 1) &&
        (existing.clipId ?? null) === (segment.clipId ?? null) &&
        (existing.showWaveform ?? null) === (segment.showWaveform ?? null)
      ) {
        return
      }

      segments = [...segments.filter((item) => item.id !== segment.id), segment]
      notify()
    },
    unregisterSegment: (id) => {
      const next = segments.filter((segment) => segment.id !== id)
      if (next.length === segments.length) return
      segments = next
      notify()
    },
    clear: () => {
      segments = []
      notify()
    },
  }
}

const defaultAudioPlanStore = createAudioPlanStore()
const AudioPlanContext = React.createContext<AudioPlanStore | null>(null)

export const AudioPlanProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const existing = useContext(AudioPlanContext)
  const storeRef = useRef<AudioPlanStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createAudioPlanStore()
  }
  const store = storeRef.current

  React.useEffect(() => () => store.clear(), [store])

  if (existing) return <>{children}</>

  return (
    <AudioPlanContext.Provider value={store}>
      {children}
    </AudioPlanContext.Provider>
  )
}

const useAudioPlanStore = () =>
  useContext(AudioPlanContext) ?? defaultAudioPlanStore

/**
 * Registers an audio segment in the global audio plan store.
 *
 * グローバル音声プランにセグメントを登録します。
 *
 * @example
 * ```ts
 * registerAudioSegmentGlobal(seg)
 * ```
 */
export const registerAudioSegmentGlobal = (segment: AudioSegment) => {
  defaultAudioPlanStore.registerSegment(segment)
}

/**
 * Unregisters an audio segment by id.
 *
 * ID 指定で音声セグメントを削除します。
 *
 * @example
 * ```ts
 * unregisterAudioSegmentGlobal("music")
 * ```
 */
export const unregisterAudioSegmentGlobal = (id: string) => {
  defaultAudioPlanStore.unregisterSegment(id)
}

export const useAudioPlanRegistration = () => {
  const store = useAudioPlanStore()
  return useMemo(
    () => ({
      registerAudioSegment: store.registerSegment,
      unregisterAudioSegment: store.unregisterSegment,
    }),
    [store],
  )
}

/**
 * Returns the current list of audio segments.
 *
 * 現在の音声セグメント一覧を返します。
 *
 * @example
 * ```ts
 * const segments = useAudioSegments()
 * ```
 */
export const useAudioSegments = () => {
  const store = useAudioPlanStore()
  return useSyncExternalStore(store.subscribe, store.getSegments)
}
