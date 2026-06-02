import React, { useContext, useMemo, useRef, useSyncExternalStore } from "react"

type TimeLineProps = {
  children?: React.ReactNode
}

/**
 * Timeline clip descriptor registered by <Clip> components.
 *
 * <Clip> が登録するタイムライン情報。
 *
 * @example
 * ```ts
 * const clip: TimelineClip = { id: "intro", start: 0, end: 120 }
 * ```
 */
export type TimelineClip = {
  id: string
  start: number
  end: number
  label?: string
  depth?: number
  parentId?: string | null
  laneId?: string
}

type TimelineContextValue = {
  clips: TimelineClip[]
  registerClip: (clip: TimelineClip) => void
  unregisterClip: (id: string) => void
  setClipVisibility: (id: string, visible: boolean) => void
}

const TimelineContext = React.createContext<TimelineContextValue | null>(null)

type Listener = () => void

type TimelineStore = {
  getClips: () => TimelineClip[]
  getHidden: () => Record<string, boolean>
  subscribe: (listener: Listener) => () => void
  registerClip: (clip: TimelineClip) => void
  unregisterClip: (id: string) => void
  setClipVisibility: (id: string, visible: boolean) => void
  clear: () => void
}

const createTimelineStore = (): TimelineStore => {
  let clips: TimelineClip[] = []
  let hidden: Record<string, boolean> = {}
  const listeners = new Set<Listener>()

  const notify = () => {
    listeners.forEach((listener) => listener())
  }

  return {
    getClips: () => clips,
    getHidden: () => hidden,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    registerClip: (clip) => {
      clips = [...clips.filter((item) => item.id !== clip.id), clip]
      notify()
    },
    unregisterClip: (id) => {
      clips = clips.filter((clip) => clip.id !== id)
      if (hidden[id]) {
        const { [id]: _removed, ...rest } = hidden
        hidden = rest
      }
      notify()
    },
    setClipVisibility: (id, visible) => {
      if (visible) {
        const { [id]: _removed, ...rest } = hidden
        hidden = rest
      } else {
        hidden = { ...hidden, [id]: true }
      }
      notify()
    },
    clear: () => {
      clips = []
      hidden = {}
      notify()
    },
  }
}

const defaultTimelineStore = createTimelineStore()
const TimelineStoreContext = React.createContext<TimelineStore | null>(null)

export const TimelineStoreProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const existing = useContext(TimelineStoreContext)
  const storeRef = useRef<TimelineStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createTimelineStore()
  }
  const store = storeRef.current

  React.useEffect(() => () => store.clear(), [store])

  if (existing) return <>{children}</>

  return (
    <TimelineStoreContext.Provider value={store}>
      {children}
    </TimelineStoreContext.Provider>
  )
}

const useTimelineStore = () =>
  useContext(TimelineStoreContext) ?? defaultTimelineStore

export const subscribeTimelineGlobal = defaultTimelineStore.subscribe

export const getTimelineClipsSnapshot = defaultTimelineStore.getClips

/**
 * Registers a clip in the global timeline store.
 *
 * クリップをグローバルのタイムラインストアに登録します。
 *
 * @example
 * ```ts
 * registerClipGlobal({ id: "intro", start: 0, end: 120 })
 * ```
 */
export const registerClipGlobal = (clip: TimelineClip) => {
  defaultTimelineStore.registerClip(clip)
}

/**
 * Unregisters a clip from the global timeline store.
 *
 * グローバルのタイムラインストアからクリップを削除します。
 *
 * @example
 * ```ts
 * unregisterClipGlobal("intro")
 * ```
 */
export const unregisterClipGlobal = (id: string) => {
  defaultTimelineStore.unregisterClip(id)
}

/**
 * Sets visibility for a clip (and its descendants) in the global store.
 *
 * グローバルストアでクリップの表示/非表示を切り替えます。
 *
 * @example
 * ```ts
 * setClipVisibilityGlobal("intro", false)
 * ```
 */
export const setClipVisibilityGlobal = (id: string, visible: boolean) => {
  defaultTimelineStore.setClipVisibility(id, visible)
}

export const getTimelineHiddenSnapshot = defaultTimelineStore.getHidden

/**
 * Provides timeline registration context for clips.
 *
 * クリップ登録のためのタイムラインコンテキストを提供します。
 *
 * @example
 * ```tsx
 * <TimeLine>
 *   <Clip label="Intro">...</Clip>
 * </TimeLine>
 * ```
 */
export const TimeLine = ({ children }: TimeLineProps) => {
  const store = useTimelineStore()
  const clips = useSyncExternalStore(store.subscribe, store.getClips)
  const value = useMemo(
    () => ({
      clips,
      registerClip: store.registerClip,
      unregisterClip: store.unregisterClip,
      setClipVisibility: store.setClipVisibility,
    }),
    [clips, store],
  )

  return (
    <TimelineContext.Provider value={value}>
      {children}
    </TimelineContext.Provider>
  )
}

/**
 * Returns the current list of timeline clips.
 *
 * タイムラインに登録されているクリップ一覧を返します。
 *
 * @example
 * ```ts
 * const clips = useTimelineClips()
 * ```
 */
export const useTimelineClips = () => {
  const context = useContext(TimelineContext)
  const store = useTimelineStore()
  const clips = useSyncExternalStore(store.subscribe, store.getClips)
  if (context) {
    return context.clips
  }
  return clips
}

/**
 * Returns the timeline registration context (if available).
 *
 * クリップ登録用のコンテキストを返します。
 *
 * @example
 * ```ts
 * const timeline = useTimelineRegistration()
 * ```
 */
export const useTimelineRegistration = () => {
  const context = useContext(TimelineContext)
  const store = useTimelineStore()
  return useMemo(
    () =>
      context ?? {
        clips: store.getClips(),
        registerClip: store.registerClip,
        unregisterClip: store.unregisterClip,
        setClipVisibility: store.setClipVisibility,
      },
    [context, store],
  )
}

/**
 * Returns visibility state and setter for clips.
 *
 * クリップの表示状態と setter を返します。
 *
 * @example
 * ```ts
 * const { hiddenMap, setClipVisibility } = useClipVisibilityState()
 * ```
 */
export const useClipVisibilityState = () => {
  const context = useContext(TimelineContext)
  const store = useTimelineStore()
  const hidden = useSyncExternalStore(store.subscribe, store.getHidden)

  if (context) {
    return {
      hiddenMap: hidden,
      setClipVisibility: context.setClipVisibility,
    }
  }

  return {
    hiddenMap: hidden,
    setClipVisibility: store.setClipVisibility,
  }
}

/**
 * Returns true if the clip and its parents are visible.
 *
 * クリップと親クリップが表示されている場合に true を返します。
 *
 * @example
 * ```ts
 * const visible = useClipVisibility("intro")
 * ```
 */
export const useClipVisibility = (id: string) => {
  const { hiddenMap } = useClipVisibilityState()
  const clips = useTimelineClips()
  const parentMap = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const clip of clips) {
      map.set(clip.id, clip.parentId ?? null)
    }
    return map
  }, [clips])

  return useMemo(() => {
    let cursor: string | null = id
    while (cursor) {
      if (hiddenMap[cursor]) return false
      cursor = parentMap.get(cursor) ?? null
    }
    return true
  }, [hiddenMap, id, parentMap])
}
