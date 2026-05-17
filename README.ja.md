![](./frame-script.gif)

FrameScript.vue は Vue SFC + CSS で動画を記述できる FrameScript の fork です。

<a href="https://discord.gg/Gpjvht3BqM" data-size="large">
  <img alt="Discord" src="https://img.shields.io/discord/1454040226594033728.svg?label=Discord&logo=Discord&colorB=7289da&style=for-the-badge">
</a>

## FrameScript の特徴

- Vue SFC + CSS に代表される Web のフロントエンド技術を用いて動画を構築
- フレーム値を使った Vue の `computed` による細かなアニメーション制御
- Rust によって構築された効率的なレンダリングシステム

## Vue SFC で動画を構成

`project/project.vue` を編集します。

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

## アニメーション API

Vue SFC ではフレーム値を reactive に読み、`computed` と scoped CSS でアニメーションを書けます。

```vue
<script setup lang="ts">
import { computed } from "vue"
import { BEZIER_SMOOTH } from "../src/lib/animation/functions"
import { Clip, FillFrame, seconds, useCurrentFrame } from "../src/lib/vue"

const frame = useCurrentFrame()
const duration = seconds(2)
const circleVars = computed(() => {
  const t = BEZIER_SMOOTH(Math.min(1, frame.value / duration))
  return {
    "--circle-opacity": String(t),
    "--circle-x": `${-300 + 540 * t}px`,
  }
})
</script>

<template>
  <Clip label="Circle" :duration="duration">
    <FillFrame class="scene" :style="circleVars">
      <div class="circle" />
    </FillFrame>
  </Clip>
</template>

<style scoped>
.scene {
  align-items: center;
  justify-content: center;

  & .circle {
    width: 120px;
    height: 120px;
    border-radius: 999px;
    background: #38bdf8;
    opacity: var(--circle-opacity);
    transform: translateX(var(--circle-x));
    box-shadow: 0 20px 60px rgb(56 189 248 / 0.35);
  }
}
</style>
```

<img src="circle.gif" alt="circle_move" loop=infinite>

## QuickStart

(実行には Node.js が必要です)

```bash
npm init @frame-script/latest
cd <project-path>
npm run start
```

## ドキュメント

- [FrameScript Docs](https://frame-script.github.io/FrameScript/ja)
