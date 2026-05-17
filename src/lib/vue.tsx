import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"
import {
  computed,
  createApp,
  defineComponent,
  h,
  inject,
  onBeforeUnmount,
  onMounted,
  provide as provideVue,
  reactive,
  readonly,
  ref,
  shallowRef,
  toValue,
  watch,
  watchEffect,
} from "vue"
import type {
  App,
  Component,
  InjectionKey,
  MaybeRefOrGetter,
  Plugin,
  PropType,
} from "vue"
import type { ProjectSettings } from "./project"
import {
  useClipActive as useReactClipActive,
  useClipId as useReactClipId,
  useClipRange as useReactClipRange,
  useClipStart as useReactClipStart,
  useProvideClipDuration as useReactProvideClipDuration,
} from "./clip"
import {
  useCurrentFrame as useReactCurrentFrame,
  useGlobalCurrentFrame as useReactGlobalCurrentFrame,
} from "./frame"
import {
  getTimelineHiddenSnapshot,
  registerClipGlobal,
  subscribeTimelineGlobal,
  unregisterClipGlobal,
} from "./timeline"
import {
  registerAudioSegmentGlobal,
  unregisterAudioSegmentGlobal,
} from "./audio-plan"
import { useIsPlaying, useIsRender } from "./studio-state"
import { resolveTrimFrames } from "./trim"
import type { Trim } from "./trim"
import { createManualPromise } from "../util/promise"
import type { ManualPromise } from "../util/promise"
import { registerCanvasFrameWaiter } from "./video/canvas-frame-registry"

export { seconds } from "./frame"

type ClipRange = { start: number; end: number }
type DurationReporter = {
  reportDuration: (id: string, frames: number) => void
  removeDuration: (id: string) => void
}

export type FrameScriptVueContext = DurationReporter & {
  currentFrame: number
  globalFrame: number
  clipStart: number | null
  clipRange: ClipRange | null
  clipId: string | null
  clipDepth: number
  clipActive: boolean
  isPlaying: boolean
  isRender: boolean
  projectSettings: ProjectSettings
}

export const FrameScriptVueContextKey: InjectionKey<FrameScriptVueContext> =
  Symbol("FrameScriptVueContext")

let nextVueId = 1
const createVueId = (prefix: string) => `${prefix}-${nextVueId++}`

const noopDurationReporter: DurationReporter = {
  reportDuration: () => {},
  removeDuration: () => {},
}

const createRuntimeContext = (
  settings: ProjectSettings,
): FrameScriptVueContext =>
  reactive({
    currentFrame: 0,
    globalFrame: 0,
    clipStart: null,
    clipRange: null,
    clipId: null,
    clipDepth: -1,
    clipActive: true,
    isPlaying: false,
    isRender: false,
    projectSettings: settings,
    ...noopDurationReporter,
  }) as FrameScriptVueContext

const assignRuntime = (
  runtime: FrameScriptVueContext,
  next: Partial<FrameScriptVueContext>,
) => {
  Object.assign(runtime, next)
}

const mergeVueStyle = (base: CSSProperties, style: unknown) => {
  if (!style) return base
  return [base, style]
}

const cssObject = (style: CSSProperties | undefined): CSSProperties =>
  style ?? {}

export const useFrameScript = () => {
  const context = inject(FrameScriptVueContextKey)
  if (!context) {
    throw new Error(
      "useFrameScript must be used inside <VueProjectRoot>, <Project>, or <VueScene>",
    )
  }
  return context
}

export const useCurrentFrame = () => {
  const context = useFrameScript()
  return computed(() => context.currentFrame)
}

export const useGlobalFrame = () => {
  const context = useFrameScript()
  return computed(() => context.globalFrame)
}

export const useClipActive = () => {
  const context = useFrameScript()
  return computed(() => context.clipActive)
}

export const useProjectSettings = () => {
  const context = useFrameScript()
  return computed(() => context.projectSettings)
}

export const useProvideClipDuration = (
  frames: MaybeRefOrGetter<number | null | undefined>,
) => {
  const context = useFrameScript()
  const id = createVueId("vue-duration")

  watchEffect(() => {
    const value = toValue(frames)
    if (value == null) {
      context.removeDuration(id)
      return
    }
    context.reportDuration(id, Math.max(0, value))
  })

  onBeforeUnmount(() => {
    context.removeDuration(id)
  })
}

type MountedVueComponentProps<Props extends Record<string, unknown>> = {
  component: Component<Props>
  props?: Props
  plugins?: Plugin[]
  provide?: Record<string | symbol, unknown>
  runtime: FrameScriptVueContext
}

const useMountedVueComponent = <Props extends Record<string, unknown>>({
  component,
  props,
  plugins,
  provide,
  runtime,
}: MountedVueComponentProps<Props>) => {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const appRef = useRef<App<Element> | null>(null)
  const propsRef = useRef<ReturnType<
    typeof shallowRef<Record<string, unknown>>
  > | null>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const componentProps = shallowRef<Record<string, unknown>>(
      (props ?? {}) as Record<string, unknown>,
    )
    propsRef.current = componentProps

    const Root = defineComponent({
      name: "FrameScriptVueMount",
      setup: () => () => h(component as Component, componentProps.value),
    })

    const app = createApp(Root)
    app.provide(
      FrameScriptVueContextKey,
      readonly(runtime) as FrameScriptVueContext,
    )

    for (const plugin of plugins ?? []) {
      app.use(plugin)
    }

    if (provide) {
      const values = provide as Record<PropertyKey, unknown>
      for (const key of Reflect.ownKeys(values)) {
        app.provide(key as string | symbol, values[key])
      }
    }

    app.mount(mount)
    appRef.current = app

    return () => {
      app.unmount()
      appRef.current = null
      propsRef.current = null
      mount.innerHTML = ""
    }
  }, [component, plugins, provide, runtime])

  useEffect(() => {
    if (propsRef.current) {
      propsRef.current.value = (props ?? {}) as Record<string, unknown>
    }
  }, [props])

  return mountRef
}

export type VueProjectRootProps<
  Props extends Record<string, unknown> = Record<string, unknown>,
> = {
  component: Component<Props>
  projectSettings: ProjectSettings
  props?: Props
  plugins?: Plugin[]
  provide?: Record<string | symbol, unknown>
  style?: CSSProperties
  className?: string
}

export function VueProjectRoot<
  Props extends Record<string, unknown> = Record<string, unknown>,
>({
  component,
  projectSettings,
  props,
  plugins,
  provide,
  style,
  className,
}: VueProjectRootProps<Props>) {
  const currentFrame = useReactCurrentFrame()
  const globalFrame = useReactGlobalCurrentFrame()
  const isPlaying = useIsPlaying()
  const isRender = useIsRender()
  const runtimeRef = useRef<FrameScriptVueContext | null>(null)

  if (!runtimeRef.current) {
    runtimeRef.current = createRuntimeContext(projectSettings)
  }

  const runtime = runtimeRef.current

  useEffect(() => {
    assignRuntime(runtime, {
      currentFrame,
      globalFrame,
      clipStart: null,
      clipRange: null,
      clipId: null,
      clipDepth: -1,
      clipActive: true,
      isPlaying,
      isRender,
      projectSettings,
      ...noopDurationReporter,
    })
  }, [currentFrame, globalFrame, isPlaying, isRender, projectSettings, runtime])

  const mountRef = useMountedVueComponent({
    component,
    props,
    plugins,
    provide,
    runtime,
  })

  return (
    <div
      ref={mountRef}
      className={className}
      style={{ display: "contents", ...style }}
    />
  )
}

export type VueSceneProps<
  Props extends Record<string, unknown> = Record<string, unknown>,
> = {
  component: Component<Props>
  props?: Props
  duration?: number
  projectSettings: ProjectSettings
  plugins?: Plugin[]
  provide?: Record<string | symbol, unknown>
  style?: CSSProperties
  className?: string
}

export function VueScene<
  Props extends Record<string, unknown> = Record<string, unknown>,
>({
  component,
  props,
  duration,
  projectSettings,
  plugins,
  provide,
  style,
  className,
}: VueSceneProps<Props>) {
  const currentFrame = useReactCurrentFrame()
  const globalFrame = useReactGlobalCurrentFrame()
  const clipStart = useReactClipStart()
  const clipRange = useReactClipRange()
  const clipId = useReactClipId()
  const clipActive = useReactClipActive()
  const isPlaying = useIsPlaying()
  const isRender = useIsRender()
  const durationReportsRef = useRef<Map<string, number>>(new Map())
  const [reportedDuration, setReportedDuration] = useState(0)
  const runtimeRef = useRef<FrameScriptVueContext | null>(null)

  const resolveReportedDuration = useCallback(() => {
    let max = 0
    for (const value of durationReportsRef.current.values()) {
      if (value > max) max = value
    }
    setReportedDuration(max)
  }, [])

  const durationReporter = useMemo<DurationReporter>(
    () => ({
      reportDuration: (id, frames) => {
        durationReportsRef.current.set(id, Math.max(0, frames))
        resolveReportedDuration()
      },
      removeDuration: (id) => {
        if (!durationReportsRef.current.has(id)) return
        durationReportsRef.current.delete(id)
        resolveReportedDuration()
      },
    }),
    [resolveReportedDuration],
  )

  if (!runtimeRef.current) {
    runtimeRef.current = createRuntimeContext(projectSettings)
  }

  const runtime = runtimeRef.current
  useReactProvideClipDuration(duration ?? reportedDuration)

  useEffect(() => {
    assignRuntime(runtime, {
      currentFrame,
      globalFrame,
      clipStart,
      clipRange,
      clipId,
      clipDepth: clipRange ? 0 : -1,
      clipActive,
      isPlaying,
      isRender,
      projectSettings,
      ...durationReporter,
    })
  }, [
    clipActive,
    clipId,
    clipRange,
    clipStart,
    currentFrame,
    durationReporter,
    globalFrame,
    isPlaying,
    isRender,
    projectSettings,
    runtime,
  ])

  const mountRef = useMountedVueComponent({
    component,
    props,
    plugins,
    provide,
    runtime,
  })

  return (
    <div
      ref={mountRef}
      className={className}
      style={{ display: "contents", ...style }}
    />
  )
}

const useTimelineHiddenMap = () => {
  const hidden = ref(getTimelineHiddenSnapshot())
  let unsubscribe: (() => void) | null = null

  onMounted(() => {
    unsubscribe = subscribeTimelineGlobal(() => {
      hidden.value = getTimelineHiddenSnapshot()
    })
  })

  onBeforeUnmount(() => {
    unsubscribe?.()
    unsubscribe = null
  })

  return hidden
}

export const Project = defineComponent({
  name: "FrameScriptProject",
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    const base: CSSProperties = {
      position: "relative",
      width: "100%",
      height: "100%",
      overflow: "hidden",
    }

    return () =>
      h(
        "div",
        {
          ...attrs,
          style: mergeVueStyle(base, attrs.style),
        },
        slots.default?.(),
      )
  },
})

export const TimeLine = defineComponent({
  name: "FrameScriptTimeLine",
  setup(_props, { slots }) {
    return () => slots.default?.()
  },
})

export const FillFrame = defineComponent({
  name: "FrameScriptFillFrame",
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    const base: CSSProperties = {
      position: "absolute",
      inset: 0,
      display: "flex",
      flexDirection: "column",
    }

    return () =>
      h(
        "div",
        {
          ...attrs,
          style: mergeVueStyle(base, attrs.style),
        },
        slots.default?.(),
      )
  },
})

export const Clip = defineComponent({
  name: "FrameScriptClip",
  props: {
    start: { type: Number, default: 0 },
    duration: { type: Number, default: undefined },
    label: { type: String, default: undefined },
    laneId: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const parent = useFrameScript()
    const id = createVueId("vue-clip")
    const rootRef = ref<HTMLElement | null>(null)
    const hiddenMap = useTimelineHiddenMap()
    const durationReports = new Map<string, number>()
    const reportedDuration = ref(0)
    let animations: Animation[] = []
    let dirtyAnimations = true

    const resolveReportedDuration = () => {
      let max = 0
      for (const value of durationReports.values()) {
        if (value > max) max = value
      }
      reportedDuration.value = max
    }

    const ownDurationReporter: DurationReporter = {
      reportDuration: (durationId, frames) => {
        durationReports.set(durationId, Math.max(0, frames))
        resolveReportedDuration()
      },
      removeDuration: (durationId) => {
        if (!durationReports.has(durationId)) return
        durationReports.delete(durationId)
        resolveReportedDuration()
      },
    }

    const frames = computed(() =>
      props.duration == null
        ? Math.max(0, reportedDuration.value)
        : Math.max(0, props.duration),
    )
    const parentStart = computed(() => parent.clipRange?.start ?? 0)
    const parentEnd = computed(
      () => parent.clipRange?.end ?? Number.POSITIVE_INFINITY,
    )
    const depth = computed(() => parent.clipDepth + 1)
    const absoluteStart = computed(() => parentStart.value + props.start)
    const absoluteEnd = computed(
      () => absoluteStart.value + Math.max(0, frames.value) - 1,
    )
    const clampedStart = computed(() =>
      Math.max(absoluteStart.value, parentStart.value),
    )
    const clampedEnd = computed(() =>
      Math.min(
        absoluteEnd.value < absoluteStart.value
          ? absoluteStart.value
          : absoluteEnd.value,
        parentEnd.value,
      ),
    )
    const hasSpan = computed(() => clampedEnd.value >= clampedStart.value)
    const ownVisible = computed(() => !hiddenMap.value[id])
    const active = computed(
      () =>
        parent.clipActive &&
        ownVisible.value &&
        hasSpan.value &&
        parent.globalFrame >= clampedStart.value &&
        parent.globalFrame <= clampedEnd.value,
    )
    const childContext = reactive({
      currentFrame: 0,
      globalFrame: parent.globalFrame,
      clipStart: clampedStart.value,
      clipRange: { start: clampedStart.value, end: clampedEnd.value },
      clipId: id,
      clipDepth: depth.value,
      clipActive: active.value,
      isPlaying: parent.isPlaying,
      isRender: parent.isRender,
      projectSettings: parent.projectSettings,
      ...ownDurationReporter,
    }) as FrameScriptVueContext

    useProvideClipDuration(frames)

    watchEffect(() => {
      assignRuntime(childContext, {
        currentFrame: Math.max(parent.globalFrame - clampedStart.value, 0),
        globalFrame: parent.globalFrame,
        clipStart: clampedStart.value,
        clipRange: { start: clampedStart.value, end: clampedEnd.value },
        clipId: id,
        clipDepth: depth.value,
        clipActive: active.value,
        isPlaying: parent.isPlaying,
        isRender: parent.isRender,
        projectSettings: parent.projectSettings,
        ...ownDurationReporter,
      })
    })

    provideVue(FrameScriptVueContextKey, readonly(childContext))

    watchEffect((onCleanup) => {
      if (!hasSpan.value) return
      registerClipGlobal({
        id,
        start: clampedStart.value,
        end: clampedEnd.value,
        label: props.label,
        depth: depth.value,
        parentId: parent.clipId,
        laneId: props.laneId,
      })
      onCleanup(() => unregisterClipGlobal(id))
    })

    const collectAnimations = () => {
      const root = rootRef.value
      if (!root) {
        animations = []
        dirtyAnimations = false
        return
      }

      const next: Animation[] = []
      const attr = "data-framescript-clip-root"
      const stack: Element[] = [root]
      while (stack.length > 0) {
        const element = stack.pop()!
        next.push(...element.getAnimations())
        for (const child of Array.from(element.children)) {
          if (child !== root && child.hasAttribute(attr)) continue
          stack.push(child)
        }
      }

      animations = next
      dirtyAnimations = false
    }

    watchEffect(
      (onCleanup) => {
        if (!active.value) {
          animations = []
          dirtyAnimations = true
          return
        }

        const root = rootRef.value
        if (!root) return
        dirtyAnimations = true
        const observer = new MutationObserver(() => {
          dirtyAnimations = true
        })
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "style"],
        })
        onCleanup(() => observer.disconnect())
      },
      { flush: "post" },
    )

    watch(
      [() => childContext.currentFrame, active],
      () => {
        if (!active.value) return
        const fps = childContext.projectSettings.fps
        if (fps <= 0) return
        if (dirtyAnimations) collectAnimations()

        const timeMs = (childContext.currentFrame / fps) * 1000
        const next: Animation[] = []
        for (const animation of animations) {
          try {
            if (animation.playState !== "paused") animation.pause()
            animation.currentTime = timeMs
            next.push(animation)
          } catch {
            // Drop detached animations.
          }
        }
        animations = next
      },
      { flush: "post" },
    )

    return () =>
      h(
        "div",
        {
          ref: rootRef,
          "data-framescript-clip-root": "1",
          style: { display: active.value ? "contents" : "none" },
        },
        slots.default?.(),
      )
  },
})

export type VideoSource = {
  path: string
}

type VideoMeta = {
  duration_ms: number
  fps: number
  frame_count: number
  width: number
  height: number
}

const videoMetaCache = new Map<string, VideoMeta>()
const pendingFramePromises = new Set<Promise<void>>()

export const normalizeVideo = (video: VideoSource | string): VideoSource => {
  if (typeof video === "string") return { path: video }
  return video
}

const normalizeRequiredVideo = (
  video: VideoSource | string | undefined,
): VideoSource => normalizeVideo(video ?? "")

const buildVideoUrl = (video: VideoSource) => {
  const url = new URL("http://localhost:3000/video")
  url.searchParams.set("path", video.path)
  return url.toString()
}

const buildVideoMetaUrl = (video: VideoSource) => {
  const url = new URL("http://localhost:3000/video/meta")
  url.searchParams.set("path", video.path)
  return url.toString()
}

const fetchVideoMetaSync = (video: VideoSource): VideoMeta => {
  const cached = videoMetaCache.get(video.path)
  if (cached) return cached

  const fallback: VideoMeta = {
    duration_ms: 0,
    fps: 0,
    frame_count: 0,
    width: 0,
    height: 0,
  }

  try {
    const xhr = new XMLHttpRequest()
    xhr.open("GET", buildVideoMetaUrl(video), false)
    xhr.send()

    if (xhr.status >= 200 && xhr.status < 300) {
      const payload = JSON.parse(xhr.responseText) as Partial<VideoMeta>
      const meta: VideoMeta = {
        duration_ms:
          typeof payload.duration_ms === "number"
            ? Math.max(0, payload.duration_ms)
            : 0,
        fps: typeof payload.fps === "number" ? payload.fps : 0,
        frame_count:
          typeof payload.frame_count === "number"
            ? Math.max(0, Math.round(payload.frame_count))
            : 0,
        width:
          typeof payload.width === "number"
            ? Math.max(0, Math.round(payload.width))
            : 0,
        height:
          typeof payload.height === "number"
            ? Math.max(0, Math.round(payload.height))
            : 0,
      }
      videoMetaCache.set(video.path, meta)
      return meta
    }
  } catch (error) {
    console.error("fetchVideoMetaSync(): failed to fetch metadata", error)
  }

  videoMetaCache.set(video.path, fallback)
  return fallback
}

const videoLength = (video: VideoSource | string, projectFps: number) => {
  const resolved = normalizeVideo(video)
  const meta = fetchVideoMetaSync(resolved)
  if (meta.frame_count > 0 && meta.fps > 0) {
    return Math.round((meta.frame_count * projectFps) / meta.fps)
  }
  const seconds = meta.duration_ms > 0 ? meta.duration_ms / 1000 : 0
  return Math.round(seconds * projectFps)
}

export const video_fps = (video: VideoSource | string) => {
  const resolved = normalizeVideo(video)
  return fetchVideoMetaSync(resolved).fps
}

export const video_frame_count = (video: VideoSource | string) => {
  const resolved = normalizeVideo(video)
  return fetchVideoMetaSync(resolved).frame_count
}

export const video_dimensions = (video: VideoSource | string) => {
  const resolved = normalizeVideo(video)
  const meta = fetchVideoMetaSync(resolved)
  return { width: meta.width, height: meta.height }
}

const trackPending = (manual: ManualPromise<void>) => {
  pendingFramePromises.add(manual.promise)
  manual.promise.finally(() => pendingFramePromises.delete(manual.promise))
}

const videoProp = {
  type: [String, Object] as PropType<VideoSource | string>,
  required: true,
}

const trimProp = Object as PropType<Trim>
const styleProp = Object as PropType<CSSProperties>

const VideoElement = defineComponent({
  name: "FrameScriptVideoElement",
  inheritAttrs: false,
  props: {
    video: videoProp,
    style: styleProp,
    trimStartFrames: { type: Number, default: 0 },
    trimEndFrames: { type: Number, default: 0 },
  },
  setup(props, { attrs }) {
    const context = useFrameScript()
    const elementRef = ref<HTMLVideoElement | null>(null)
    const playingFlag = ref(false)
    const pendingSeek = ref<number | null>(null)
    const currentFrame = computed(() => context.currentFrame)
    const resolvedVideo = computed(() => normalizeRequiredVideo(props.video))
    const src = computed(() => buildVideoUrl(resolvedVideo.value))

    watch(
      [currentFrame, () => context.isPlaying, () => props.trimStartFrames],
      () => {
        const element = elementRef.value
        if (!element || context.isPlaying) return
        const time =
          (currentFrame.value + props.trimStartFrames) /
          context.projectSettings.fps
        if (element.readyState >= HTMLMediaElement.HAVE_METADATA) {
          element.currentTime = time
          pendingSeek.value = null
        } else {
          pendingSeek.value = time
        }
      },
      { immediate: true },
    )

    watch(
      () => context.clipActive,
      () => {
        const element = elementRef.value
        if (!element || !context.isPlaying) return
        element.currentTime =
          (currentFrame.value + props.trimStartFrames) /
          context.projectSettings.fps
      },
    )

    watch(
      [() => context.isPlaying, () => context.clipActive],
      () => {
        const element = elementRef.value
        if (!element) return
        if (context.isPlaying && context.clipActive) {
          if (!playingFlag.value) {
            void element.play().catch(() => {})
            playingFlag.value = true
          }
        } else {
          element.pause()
          playingFlag.value = false
        }
      },
      { immediate: true },
    )

    const baseStyle: CSSProperties = {
      width: "100%",
      height: "100%",
      backgroundColor: "#000",
    }

    return () =>
      h("video", {
        ...attrs,
        ref: elementRef,
        src: src.value,
        onLoadedmetadata: () => {
          const element = elementRef.value
          if (!element) return
          if (pendingSeek.value != null) {
            element.currentTime = pendingSeek.value
            pendingSeek.value = null
          }
        },
        onEnded: () => elementRef.value?.pause(),
        style: mergeVueStyle(baseStyle, props.style),
      })
  },
})

const VideoCanvasRender = defineComponent({
  name: "FrameScriptVideoCanvasRender",
  inheritAttrs: false,
  props: {
    video: videoProp,
    style: styleProp,
    trimStartFrames: { type: Number, default: 0 },
    trimEndFrames: { type: Number, default: 0 },
  },
  setup(props, { attrs }) {
    const context = useFrameScript()
    const canvasRef = ref<HTMLCanvasElement | null>(null)
    const canvasSize = {
      width: context.projectSettings.width,
      height: context.projectSettings.height,
    }
    const pendingMap = new Map<
      number,
      { manual: ManualPromise<void>; projectFrame: number }
    >()
    const waiters = new Map<number, ManualPromise<void>>()
    const waitCanvasId = createVueId("vue-video")
    let ws: WebSocket | null = null
    let reconnectTimer: number | null = null
    let lastDrawnFrame: number | null = null
    let requestedFrame: number | null = null

    const resolved = computed(() => normalizeRequiredVideo(props.video))
    const fps = computed(() => video_fps(resolved.value))
    const sourceFrameCount = computed(() => video_frame_count(resolved.value))
    const rawDurationFrames = computed(() =>
      videoLength(resolved.value, context.projectSettings.fps),
    )
    const durationFrames = computed(() =>
      Math.max(
        0,
        rawDurationFrames.value - props.trimStartFrames - props.trimEndFrames,
      ),
    )

    const rejectPendingRequests = (reason: unknown) => {
      for (const entry of pendingMap.values()) {
        entry.manual.reject(reason)
      }
      pendingMap.clear()
      for (const waiter of waiters.values()) {
        waiter.reject(reason)
      }
      waiters.clear()
    }

    const createOrGetFramePromise = (target: number) => {
      const existing = waiters.get(target)
      if (existing) return existing

      const manual = createManualPromise()
      manual.promise.finally(() => {
        waiters.delete(target)
      })
      trackPending(manual)
      waiters.set(target, manual)
      return manual
    }

    const resolveWaiters = (projectFrame: number) => {
      const prev = lastDrawnFrame ?? -Infinity
      if (projectFrame > prev) {
        lastDrawnFrame = projectFrame
      }
      createOrGetFramePromise(projectFrame).resolve()
    }

    const sendPlaybackFrameRequest = (playbackFrame: number) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return

      ws.send(
        JSON.stringify({
          video: resolved.value.path,
          width:
            canvasSize.width > 1
              ? canvasSize.width
              : context.projectSettings.width,
          height:
            canvasSize.height > 1
              ? canvasSize.height
              : context.projectSettings.height,
          frame: playbackFrame,
        }),
      )
    }

    const sendFrameRequest = (frame: number) => {
      const hasDuration = durationFrames.value > 0
      const maxFrame = hasDuration
        ? Math.max(0, durationFrames.value - 1)
        : undefined
      const clampedFrame =
        maxFrame !== undefined
          ? Math.min(Math.max(frame, 0), maxFrame)
          : Math.max(frame, 0)
      const projectFps = context.projectSettings.fps
      const sourceStart =
        fps.value > 0
          ? Math.floor((props.trimStartFrames * fps.value) / projectFps)
          : props.trimStartFrames
      const sourceTrimEnd =
        fps.value > 0
          ? Math.floor((props.trimEndFrames * fps.value) / projectFps)
          : props.trimEndFrames
      const estimatedSourceFrames =
        fps.value > 0
          ? Math.max(
              0,
              Math.round((rawDurationFrames.value * fps.value) / projectFps),
            )
          : rawDurationFrames.value
      const sourceTotalFrames =
        sourceFrameCount.value > 0
          ? sourceFrameCount.value
          : estimatedSourceFrames
      const sourceEnd = Math.max(
        sourceStart,
        sourceTotalFrames - sourceTrimEnd - 1,
      )

      requestedFrame = clampedFrame

      const playbackFrameRaw =
        fps.value > 0
          ? Math.floor(
              ((clampedFrame + props.trimStartFrames) * fps.value) / projectFps,
            )
          : clampedFrame + props.trimStartFrames
      const playbackFrame = Math.min(
        Math.max(playbackFrameRaw, sourceStart),
        sourceEnd,
      )

      const alreadyDrawn =
        lastDrawnFrame != null && lastDrawnFrame >= clampedFrame
      const existingPending = pendingMap.get(playbackFrame)
      if (alreadyDrawn && !existingPending) return

      if (existingPending) {
        if (existingPending.projectFrame !== clampedFrame) {
          existingPending.projectFrame = clampedFrame
        }
      } else {
        const manual = createManualPromise()
        trackPending(manual)
        pendingMap.set(playbackFrame, {
          manual,
          projectFrame: clampedFrame,
        })
      }

      sendPlaybackFrameRequest(playbackFrame)
    }

    let resizeObserver: ResizeObserver | null = null
    onMounted(() => {
      const canvas = canvasRef.value
      if (!canvas) return

      const resize = () => {
        const rect = canvas.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        const dpr = window.devicePixelRatio || 1
        const nextWidth = Math.max(1, Math.round(rect.width * dpr))
        const nextHeight = Math.max(1, Math.round(rect.height * dpr))
        if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
          canvas.width = nextWidth
          canvas.height = nextHeight
        }
        canvasSize.width = canvas.width
        canvasSize.height = canvas.height
      }

      resize()
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(canvas)
    })

    onBeforeUnmount(() => {
      resizeObserver?.disconnect()
      resizeObserver = null
    })

    watchEffect(
      (onCleanup) => {
        if (!context.clipActive) return

        const canvas = canvasRef.value
        if (!canvas) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        let disposed = false

        const clearReconnectTimer = () => {
          if (reconnectTimer != null) {
            window.clearTimeout(reconnectTimer)
            reconnectTimer = null
          }
        }

        const scheduleReconnect = () => {
          if (disposed || reconnectTimer != null) return
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null
            if (!disposed) connect()
          }, 300)
        }

        const handleDisconnect = (reason: unknown, shouldRetry: boolean) => {
          ws = null
          if (shouldRetry) {
            if (!disposed) scheduleReconnect()
          } else {
            rejectPendingRequests(reason)
          }
        }

        const connect = () => {
          if (ws) return
          const socket = new WebSocket("ws://localhost:3000/ws")
          socket.binaryType = "arraybuffer"
          ws = socket

          socket.onopen = () => {
            if (disposed) return
            clearReconnectTimer()
            for (const frameIndex of Array.from(pendingMap.keys())) {
              sendPlaybackFrameRequest(frameIndex)
            }
            sendFrameRequest(requestedFrame ?? context.currentFrame)
          }

          socket.onmessage = (event) => {
            if (!(event.data instanceof ArrayBuffer)) return
            const buffer = event.data
            const view = new DataView(buffer)
            const width = view.getUint32(0, true)
            const height = view.getUint32(4, true)
            const frameIndex = view.getUint32(8, true)
            const rgba = new Uint8ClampedArray(buffer, 12)

            if (width * height * 4 !== rgba.length) {
              rejectPendingRequests(new Error("frame size mismatch"))
              return
            }

            if (canvas.width !== width || canvas.height !== height) {
              canvas.width = width
              canvas.height = height
            }

            ctx.putImageData(new ImageData(rgba, width, height), 0, 0)

            const pending = pendingMap.get(frameIndex)
            const projectFrame =
              pending?.projectFrame ??
              Math.max(
                0,
                Math.round(
                  (frameIndex * context.projectSettings.fps) /
                    Math.max(1, fps.value || context.projectSettings.fps),
                ) - props.trimStartFrames,
              )

            if (pending) {
              pendingMap.delete(frameIndex)
              pending.manual.resolve()
            }

            resolveWaiters(projectFrame)
          }

          socket.onerror = (event) => {
            if (disposed) return
            handleDisconnect(event, true)
          }

          socket.onclose = () => {
            if (disposed) return
            handleDisconnect(new Error("socket closed"), true)
          }
        }

        connect()

        onCleanup(() => {
          disposed = true
          clearReconnectTimer()
          const socket = ws
          ws = null
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.close()
          }
          rejectPendingRequests(new Error("component unmounted"))
        })
      },
      { flush: "post" },
    )

    watch(
      () => context.clipActive,
      (visible) => {
        if (visible) return
        lastDrawnFrame = null
        requestedFrame = null
      },
    )

    watch(
      () => context.currentFrame,
      (frame) => {
        if (!context.clipActive) return
        sendFrameRequest(frame)
      },
      { immediate: true },
    )

    watchEffect((onCleanup) => {
      if (!context.clipActive) return
      const unregister = registerCanvasFrameWaiter(
        waitCanvasId,
        async (frame) => {
          const startOffset = context.clipStart ?? 0
          const relativeFrame = frame - startOffset
          if (relativeFrame < 0 || durationFrames.value <= 0) return

          const maxFrame = Math.max(0, durationFrames.value - 1)
          const clampedFrame = Math.min(Math.max(relativeFrame, 0), maxFrame)
          if (lastDrawnFrame != null && lastDrawnFrame >= clampedFrame) return

          await createOrGetFramePromise(clampedFrame).promise
        },
      )
      onCleanup(unregister)
    })

    const baseStyle: CSSProperties = {
      width: "100%",
      height: "100%",
      border: "0px",
      backgroundColor: "#000",
      display: "block",
    }

    return () =>
      h("canvas", {
        ...attrs,
        ref: canvasRef,
        width: context.projectSettings.width,
        height: context.projectSettings.height,
        style: mergeVueStyle(baseStyle, props.style),
      })
  },
})

export const Video = defineComponent({
  name: "FrameScriptVideo",
  inheritAttrs: false,
  props: {
    video: videoProp,
    style: styleProp,
    trim: trimProp,
    showWaveform: { type: Boolean, default: false },
  },
  setup(props, { attrs }) {
    const context = useFrameScript()
    const id = createVueId("vue-video-audio")
    const resolvedVideo = computed(() => normalizeRequiredVideo(props.video))
    const rawDurationFrames = computed(() =>
      videoLength(resolvedVideo.value, context.projectSettings.fps),
    )
    const trimFrames = computed(() =>
      resolveTrimFrames({
        rawDurationFrames: rawDurationFrames.value,
        trim: props.trim,
      }),
    )
    const durationFrames = computed(() =>
      Math.max(
        0,
        rawDurationFrames.value -
          trimFrames.value.trimStartFrames -
          trimFrames.value.trimEndFrames,
      ),
    )
    const resolvedStyle = computed(() => {
      const style = cssObject(props.style)
      if (style.aspectRatio != null) return style
      const { width, height } = video_dimensions(resolvedVideo.value)
      if (width <= 0 || height <= 0) return style
      return {
        ...style,
        aspectRatio: `${width} / ${height}`,
      }
    })

    useProvideClipDuration(durationFrames)

    watchEffect((onCleanup) => {
      const clipRange = context.clipRange
      if (!clipRange) return

      const projectStartFrame = clipRange.start
      const clipDurationFrames = Math.max(
        0,
        clipRange.end - clipRange.start + 1,
      )
      const availableFrames = durationFrames.value
      const clampedDuration = Math.min(clipDurationFrames, availableFrames)
      if (clampedDuration <= 0) return

      registerAudioSegmentGlobal({
        id,
        source: { kind: "video", path: resolvedVideo.value.path },
        clipId: context.clipId ?? undefined,
        projectStartFrame,
        sourceStartFrame: trimFrames.value.trimStartFrames,
        durationFrames: clampedDuration,
        showWaveform: props.showWaveform,
      })

      onCleanup(() => unregisterAudioSegmentGlobal(id))
    })

    return () =>
      h(context.isRender ? VideoCanvasRender : VideoElement, {
        ...attrs,
        video: props.video,
        style: resolvedStyle.value,
        trimStartFrames: trimFrames.value.trimStartFrames,
        trimEndFrames: trimFrames.value.trimEndFrames,
      })
  },
})
