---
title: Vue SFC
sidebar_position: 3
---

FrameScript.vue は [`ubugeeei/style-guide.vue`](https://github.com/ubugeeei/style-guide.vue) の書き味に寄せています。
SFC、TypeScript、明示 import、`<script setup lang="ts">`、scoped CSS を基本にします。

## コンポーネント

Vue 向けの FrameScript primitive は `../src/lib/vue` から import します。

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

- `<Project>` はプロジェクトのルートです。
- `<TimeLine>` はクリップをまとめます。
- `<Clip>` はタイムライン上の区間を登録します。メディアから長さを報告できない場合は `duration` を渡します。
- `<Video>` は動画と音声をタイムラインに配置します。
- `<FillFrame>` はフレーム全体を覆う絶対配置レイヤーです。

## Reactive なフレーム値

`useCurrentFrame()` で現在クリップから見たフレームを読み、`computed` で見た目を派生させます。

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

## 補足

React ベースの FrameScript core は `src/` 配下に残っています。
Vue プロジェクトでは `project/project.vue` を編集し、`src/lib/vue` から import してください。
