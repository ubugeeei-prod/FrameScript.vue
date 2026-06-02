---
title: 基本
sidebar_position: 2
---

## 基本構成

動画は `project/project.vue` に記述します。
`project/project.tsx` は FrameScript Studio とレンダラへ SFC を渡すための互換ラッパーです。

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

プロジェクト設定は、FrameScript のコアモジュールがビルド時に読むため `project/project.tsx` に残します。

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
