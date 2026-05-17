<script setup lang="ts">
import { computed } from "vue"
import {
  Clip,
  FillFrame,
  Project,
  TimeLine,
  seconds,
  useCurrentFrame,
} from "../src/lib/vue"
import { BEZIER_SMOOTH, cubicBezier } from "../src/lib/animation/functions"

const frame = useCurrentFrame()
const introDuration = seconds(4)
const outroDuration = seconds(1.5)
const titleEase = BEZIER_SMOOTH
const sweepEase = cubicBezier(0.2, 0.9, 0.2, 1)

const sceneVars = computed(() => {
  const t = Math.min(1, frame.value / introDuration)
  const titleProgress = titleEase(t)
  const sweepProgress = sweepEase(t)
  return {
    "--title-opacity": String(Math.min(1, titleProgress * 1.4)),
    "--title-y": `${(1 - titleProgress) * 52}px`,
    "--accent-x": `${(sweepProgress - 1) * 780}px`,
    "--ring-scale": String(0.72 + titleProgress * 0.34),
  }
})
</script>

<template>
  <Project>
    <TimeLine>
      <Clip label="Vue SFC Intro" :duration="introDuration">
        <FillFrame class="scene" :style="sceneVars">
          <div class="halo" />
          <main class="title-stack">
            <p class="eyebrow">FrameScript.vue</p>
            <h1>Vue SFC video editing</h1>
            <p class="lead">
              Write scenes in template, script, and scoped CSS.
            </p>
          </main>
          <div class="accent" />
        </FillFrame>
      </Clip>

      <Clip label="Hold" :start="introDuration" :duration="outroDuration">
        <FillFrame class="scene scene-hold">
          <p class="hold-label">Rendered from project/project.vue</p>
        </FillFrame>
      </Clip>
    </TimeLine>
  </Project>
</template>

<style scoped>
.scene {
  --color-bg: #09111f;
  --color-text: #eef6ff;
  --color-muted: #9fb3c9;
  --color-cyan: #63e6d5;
  --color-rose: #ff6b9d;
  --title-opacity: 1;
  --title-y: 0px;
  --accent-x: 0px;
  --ring-scale: 1;

  align-items: center;
  justify-content: center;
  isolation: isolate;
  overflow: hidden;
  background:
    radial-gradient(circle at 68% 28%, rgb(99 230 213 / 0.22), transparent 30%),
    radial-gradient(
      circle at 28% 70%,
      rgb(255 107 157 / 0.18),
      transparent 34%
    ),
    linear-gradient(135deg, #09111f 0%, #101826 55%, #06131a 100%);
  color: var(--color-text);

  & .halo {
    position: absolute;
    width: 520px;
    aspect-ratio: 1;
    border: 2px solid rgb(99 230 213 / 0.32);
    border-radius: 50%;
    transform: scale(var(--ring-scale));
    box-shadow:
      0 0 100px rgb(99 230 213 / 0.2),
      inset 0 0 80px rgb(255 107 157 / 0.12);
  }

  & .title-stack {
    position: relative;
    z-index: 1;
    display: grid;
    gap: 22px;
    max-width: 1120px;
    padding: 0 80px;
    text-align: center;
    opacity: var(--title-opacity);
    transform: translateY(var(--title-y));
  }

  & .eyebrow,
  & .lead,
  & .hold-label {
    margin: 0;
    color: var(--color-muted);
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  }

  & .eyebrow {
    color: var(--color-cyan);
    font-size: 34px;
    font-weight: 700;
  }

  & h1 {
    margin: 0;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    font-size: 116px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: 0;
  }

  & .lead {
    font-size: 34px;
  }

  & .accent {
    position: absolute;
    bottom: 180px;
    left: 50%;
    width: 560px;
    height: 5px;
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      transparent,
      var(--color-rose),
      var(--color-cyan),
      transparent
    );
    transform: translateX(var(--accent-x));
  }

  & .hold-label {
    position: relative;
    z-index: 1;
    font-size: 44px;
    font-weight: 700;
  }
}

.scene-hold {
  background:
    radial-gradient(circle at 50% 50%, rgb(99 230 213 / 0.18), transparent 28%),
    #09111f;
}
</style>
