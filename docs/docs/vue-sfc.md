---
title: Vue SFC
sidebar_position: 3
---

FrameScript.vue follows the shape of [`ubugeeei/style-guide.vue`](https://github.com/ubugeeei/style-guide.vue): use SFC, TypeScript, explicit imports, `<script setup lang="ts">`, and scoped CSS.

## Components

Import Vue-facing FrameScript primitives from `../src/lib/vue`.

```vue
<script setup lang="ts">
import {
  Clip,
  FillFrame,
  Project,
  TimeLine,
  Video,
  seconds,
} from "../src/lib/vue"
</script>
```

- `<Project>` creates the project root.
- `<TimeLine>` groups clips.
- `<Clip>` registers a timeline segment. Pass `duration` when the clip has no media that can report duration.
- `<Video>` places video and its audio on the timeline.
- `<FillFrame>` creates a full-frame absolute layer.

## Reactive frame values

Use `useCurrentFrame()` for the frame relative to the current clip, and derive visual state with `computed`.

```vue
<script setup lang="ts">
import { computed } from "vue"
import { BEZIER_SMOOTH } from "../src/lib/animation/functions"
import { Clip, FillFrame, seconds, useCurrentFrame } from "../src/lib/vue"

const frame = useCurrentFrame()
const duration = seconds(2)
const vars = computed(() => {
  const progress = BEZIER_SMOOTH(Math.min(1, frame.value / duration))
  return {
    "--opacity": String(progress),
    "--x": `${240 * progress}px`,
  }
})
</script>

<template>
  <Clip label="Move" :duration="duration">
    <FillFrame class="scene" :style="vars">
      <div class="box" />
    </FillFrame>
  </Clip>
</template>

<style scoped>
.scene {
  align-items: center;
  justify-content: center;

  & .box {
    width: 160px;
    height: 160px;
    background: #63e6d5;
    opacity: var(--opacity);
    transform: translateX(var(--x));
  }
}
</style>
```

## Notes

The React-based FrameScript core still exists under `src/`.
For Vue projects, prefer editing `project/project.vue` and importing from `src/lib/vue`.
