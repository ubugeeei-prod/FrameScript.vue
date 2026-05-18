import type { CSSProperties } from "react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useCurrentFrame } from "../frame"
import { PROJECT_SETTINGS } from "../../../project/project"
import { useIsPlaying, useIsRender } from "../studio-state"
import {
  useClipActive,
  useClipId,
  useClipRange,
  useProvideClipDuration,
} from "../clip"
import { useAudioPlanRegistration } from "../audio-plan"
import { VideoCanvasRender } from "./video-render"
import type { Trim } from "../trim"
import { resolveTrimFrames } from "../trim"
import { backendFetch, buildBackendUrl } from "../backend"
import { trackMediaMetadataPromise } from "../media-metadata"

/**
 * Video source descriptor.
 *
 * 動画ソースの記述。
 *
 * @example
 * ```ts
 * const video: Video = { path: "assets/demo.mp4" }
 * ```
 */
export type Video = {
  path: string
}

/**
 * Props for <Video>.
 *
 * <Video> の props。
 *
 * @example
 * ```tsx
 * <Video video="assets/demo.mp4" />
 * ```
 */
export type VideoProps = {
  video: Video | string
  style?: CSSProperties
  trim?: Trim
  showWaveform?: boolean
}

/**
 * Normalizes a video input into a Video object.
 *
 * Video 入力を正規化します。
 *
 * @example
 * ```ts
 * const v = normalizeVideo("assets/demo.mp4")
 * ```
 */
export const normalizeVideo = (video: Video | string): Video => {
  if (typeof video === "string") return { path: video }
  return video
}

const buildVideoUrl = (video: Video) => {
  return buildBackendUrl("video", { path: video.path })
}

const buildMetaUrl = (video: Video) => {
  return buildBackendUrl("video/meta", { path: video.path })
}

type VideoMeta = {
  duration_ms: number
  fps: number
  frame_count: number
  width: number
  height: number
}

const videoMetaCache = new Map<string, VideoMeta>()
const videoMetaPending = new Map<string, Promise<VideoMeta | null>>()

const emptyVideoMeta: VideoMeta = {
  duration_ms: 0,
  fps: 0,
  frame_count: 0,
  width: 0,
  height: 0,
}

const normalizeVideoMeta = (payload: Partial<VideoMeta>): VideoMeta => ({
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
})

export const fetchVideoMetaAsync = async (
  video: Video,
): Promise<VideoMeta | null> => {
  const cached = videoMetaCache.get(video.path)
  if (cached) return cached

  const pending = videoMetaPending.get(video.path)
  if (pending) return pending

  const next = trackMediaMetadataPromise(
    (async () => {
      const res = await backendFetch(buildMetaUrl(video))
      if (!res.ok) return null
      const meta = normalizeVideoMeta((await res.json()) as Partial<VideoMeta>)
      if (meta.duration_ms > 0 || meta.frame_count > 0) {
        videoMetaCache.set(video.path, meta)
      }
      return meta
    })(),
  )
    .catch((error) => {
      console.error("fetchVideoMetaAsync(): failed to fetch metadata", error)
      return null
    })
    .finally(() => {
      videoMetaPending.delete(video.path)
    })

  videoMetaPending.set(video.path, next)
  return next
}

const getCachedVideoMeta = (video: Video): VideoMeta => {
  const cached = videoMetaCache.get(video.path)
  if (cached) return cached
  void fetchVideoMetaAsync(video)
  return emptyVideoMeta
}

const useVideoMeta = (video: Video) => {
  const [meta, setMeta] = useState<VideoMeta>(() => getCachedVideoMeta(video))

  useEffect(() => {
    const cached = videoMetaCache.get(video.path)
    if (cached) {
      setMeta(cached)
      return
    }

    let cancelled = false
    setMeta(emptyVideoMeta)
    void fetchVideoMetaAsync(video).then((next) => {
      if (!cancelled && next) setMeta(next)
    })
    return () => {
      cancelled = true
    }
  }, [video, video.path])

  return meta
}

/**
 * Returns video length in frames (project FPS).
 *
 * 動画の長さをフレーム数で返します。
 *
 * @example
 * ```ts
 * const frames = video_length("assets/demo.mp4")
 * ```
 */
export const video_length = (video: Video | string): number => {
  const resolved = normalizeVideo(video)
  const meta = getCachedVideoMeta(resolved)
  if (meta.frame_count > 0 && meta.fps > 0) {
    return Math.round((meta.frame_count * PROJECT_SETTINGS.fps) / meta.fps)
  }
  const seconds = meta.duration_ms > 0 ? meta.duration_ms / 1000 : 0
  return Math.round(seconds * PROJECT_SETTINGS.fps)
}

/**
 * Returns the source video FPS.
 *
 * 動画ソースの FPS を返します。
 *
 * @example
 * ```ts
 * const fps = video_fps("assets/demo.mp4")
 * ```
 */
export const video_fps = (video: Video | string): number => {
  const resolved = normalizeVideo(video)
  const meta = getCachedVideoMeta(resolved)
  return meta.fps
}

export const video_frame_count = (video: Video | string): number => {
  const resolved = normalizeVideo(video)
  const meta = getCachedVideoMeta(resolved)
  return meta.frame_count
}

export type VideoDimensions = {
  width: number
  height: number
}

export const video_dimensions = (video: Video | string): VideoDimensions => {
  const resolved = normalizeVideo(video)
  const meta = getCachedVideoMeta(resolved)
  return { width: meta.width, height: meta.height }
}

/**
 * Resolved trim values for video rendering.
 *
 * 動画レンダー用のトリム解決結果。
 *
 * @example
 * ```ts
 * const trim: VideoResolvedTrimProps = { trimStartFrames: 0, trimEndFrames: 0 }
 * ```
 */
export type VideoResolvedTrimProps = {
  trimStartFrames: number
  trimEndFrames: number
}

/**
 * Places a video in the timeline (audio included).
 *
 * タイムライン上に動画を配置します（音声付き）。
 *
 * @example
 * ```tsx
 * <Video video="assets/demo.mp4" trim={{ from: 30, duration: 120 }} />
 * ```
 */
export const Video = ({ video, style, trim, showWaveform }: VideoProps) => {
  const isRender = useIsRender()
  const id = useId()
  const { registerAudioSegment, unregisterAudioSegment } =
    useAudioPlanRegistration()
  const clipId = useClipId()
  const clipRange = useClipRange()
  const resolvedVideo = useMemo(() => normalizeVideo(video), [video])
  const videoMeta = useVideoMeta(resolvedVideo)
  const resolvedStyle = useMemo(() => {
    if (style?.aspectRatio != null) {
      return style
    }
    const { width, height } = videoMeta
    if (width <= 0 || height <= 0) {
      return style
    }
    return {
      ...style,
      aspectRatio: `${width} / ${height}`,
    }
  }, [style, videoMeta])
  const rawDurationFrames = useMemo(() => {
    if (videoMeta.frame_count > 0 && videoMeta.fps > 0) {
      return Math.round(
        (videoMeta.frame_count * PROJECT_SETTINGS.fps) / videoMeta.fps,
      )
    }
    const seconds = videoMeta.duration_ms > 0 ? videoMeta.duration_ms / 1000 : 0
    return Math.round(seconds * PROJECT_SETTINGS.fps)
  }, [videoMeta])
  const { trimStartFrames, trimEndFrames } = useMemo(
    () =>
      resolveTrimFrames({
        rawDurationFrames,
        trim,
      }),
    [rawDurationFrames, trim],
  )

  useEffect(() => {
    if (!clipRange) return

    const projectStartFrame = clipRange.start
    const clipDurationFrames = Math.max(0, clipRange.end - clipRange.start + 1)
    const availableFrames = Math.max(
      0,
      rawDurationFrames - trimStartFrames - trimEndFrames,
    )
    const durationFrames = Math.min(clipDurationFrames, availableFrames)
    if (durationFrames <= 0) return

    registerAudioSegment({
      id,
      source: { kind: "video", path: resolvedVideo.path },
      clipId: clipId ?? undefined,
      projectStartFrame,
      sourceStartFrame: trimStartFrames,
      durationFrames,
      showWaveform,
    })

    return () => {
      unregisterAudioSegment(id)
    }
  }, [
    clipId,
    clipRange,
    id,
    rawDurationFrames,
    registerAudioSegment,
    resolvedVideo.path,
    showWaveform,
    trimEndFrames,
    trimStartFrames,
    unregisterAudioSegment,
  ])

  if (isRender) {
    return (
      <VideoCanvasRender
        video={video}
        style={resolvedStyle}
        trimStartFrames={trimStartFrames}
        trimEndFrames={trimEndFrames}
      />
    )
  } else {
    return (
      <VideoCanvas
        video={video}
        style={resolvedStyle}
        trimStartFrames={trimStartFrames}
        trimEndFrames={trimEndFrames}
      />
    )
  }
}

type VideoCanvasProps = Omit<VideoProps, "trim"> & VideoResolvedTrimProps

const VideoCanvas = ({
  video,
  style,
  trimStartFrames = 0,
  trimEndFrames = 0,
}: VideoCanvasProps) => {
  const resolvedVideo = useMemo(() => normalizeVideo(video), [video])
  const elementRef = useRef<HTMLVideoElement | null>(null)
  const currentFrame = useCurrentFrame()
  const isPlaying = useIsPlaying()
  const isVisible = useClipActive()
  const playingFlag = useRef(false)
  const pendingSeek = useRef<number | null>(null)
  const videoMeta = useVideoMeta(resolvedVideo)
  const rawDuration = useMemo(() => {
    if (videoMeta.frame_count > 0 && videoMeta.fps > 0) {
      return Math.round(
        (videoMeta.frame_count * PROJECT_SETTINGS.fps) / videoMeta.fps,
      )
    }
    const seconds = videoMeta.duration_ms > 0 ? videoMeta.duration_ms / 1000 : 0
    return Math.round(seconds * PROJECT_SETTINGS.fps)
  }, [videoMeta])
  const durationFrames = Math.max(
    0,
    rawDuration - trimStartFrames - trimEndFrames,
  )
  useProvideClipDuration(durationFrames)

  useEffect(() => {
    const el = elementRef.current
    if (!el || isPlaying) return

    const time = (currentFrame + trimStartFrames) / PROJECT_SETTINGS.fps
    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
      el.currentTime = time
      pendingSeek.current = null
    } else {
      pendingSeek.current = time
    }
  }, [currentFrame, isPlaying])

  const src = useMemo(() => {
    return buildVideoUrl(resolvedVideo)
  }, [resolvedVideo.path])

  const baseStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    backgroundColor: "#000",
  }

  useEffect(() => {
    if (isPlaying) {
      const time = (currentFrame + trimStartFrames) / PROJECT_SETTINGS.fps
      const element = elementRef.current
      if (element) {
        element.currentTime = time
      }
    }
  }, [isVisible])

  useEffect(() => {
    const el = elementRef.current
    if (!el) return
    if (isPlaying && isVisible) {
      if (!playingFlag.current) {
        el.play()
        playingFlag.current = true
      }
    } else {
      el.pause()
      playingFlag.current = false
    }
  }, [isPlaying, isVisible])

  return (
    <video
      ref={elementRef}
      src={src}
      onLoadedMetadata={() => {
        const el = elementRef.current
        if (!el) return
        if (pendingSeek.current != null) {
          el.currentTime = pendingSeek.current
          pendingSeek.current = null
        }
      }}
      onEnded={() => elementRef.current?.pause()}
      style={style ? { ...baseStyle, ...style } : baseStyle}
    />
  )
}
