---
title: Basic
sidebar_position: 2
---

## Basic structure

Write your video in `project/project.vue`.
`project/project.tsx` is only a compatibility wrapper that mounts the SFC into FrameScript Studio and the renderer.

```vue
<script setup lang="ts">
import { Clip, Project, TimeLine, Video } from "../src/lib/vue"
</script>

<template>
  <Project>
    <TimeLine>
      <Clip label="Clip Name">
        <Video video="~/Videos/example.mp4" />
      </Clip>
    </TimeLine>
  </Project>
</template>
```

Project settings still live in `project/project.tsx` because FrameScript core modules read them at build time.

```tsx
import { VueProjectRoot } from "../src/lib/vue"
import type { ProjectSettings } from "../src/lib/project"
import ProjectVue from "./project.vue"

export const PROJECT_SETTINGS: ProjectSettings = {
  name: "framescript-vue-template",
  width: 1920,
  height: 1080,
  fps: 60,
}

export const PROJECT = () => {
  return (
    <VueProjectRoot component={ProjectVue} projectSettings={PROJECT_SETTINGS} />
  )
}
```
