---
title: Production Runbook
sidebar_position: 6
---

This runbook covers production-style builds, local rendering, packaged artifact layout, and first-response checks for render failures.

## Supported toolchain

- Node.js `^20.19.0 || >=22.12.0`
- npm `>=10`
- Rust stable toolchain with Cargo
- macOS, Linux x64, or Windows x64 for the bundled `backend` and `render` binaries

Use `npm ci` from a clean checkout. Docs have their own lockfile, so use `npm --prefix docs ci` before docs builds.

## Development startup

`npm run start` launches source/dev mode:

- Vite Studio on `http://localhost:5173`
- Vite render page on `http://localhost:5174/render`
- Electron in source mode, which starts the Rust backend with `cargo run`

This path does not require prebuilt files under `bin/`.

## Production-style local run

Use:

```bash
npm run start:bin
```

It runs the full web build, builds Rust binaries, and starts Electron in binary mode. The default production build creates:

- `dist/` for the Studio app
- `dist-render/` for the headless render page
- `dist-electron/` for Electron main/preload code
- `bin/<platform>/backend` and `bin/<platform>/render`

`npm run start:bin:skip-build` starts from existing outputs only.

## Packaged artifact layout

Packaged apps should keep the same runtime contract:

- Electron main/preload JavaScript in `dist-electron/`
- Studio assets in `dist/`
- render page assets in `dist-render/`
- Rust binaries in `resources/bin/<platform>/backend` and `resources/bin/<platform>/render`
- third-party binary notices shipped next to app license notices

Electron also checks `process.resourcesPath/bin/<platform>/` and explicit environment overrides:

- `FRAMESCRIPT_BACKEND_BIN`
- `FRAMESCRIPT_RENDER_BIN`
- `FRAMESCRIPT_FFMPEG_PATH`
- `FRAMESCRIPT_FFPROBE_PATH`
- `FRAMESCRIPT_CHROMIUM_PATH`

The render settings preload currently runs with `sandbox: false` so it can use Electron IPC through `contextBridge`. Renderer pages keep `nodeIntegration: false` and `contextIsolation: true`.

## Backend security configuration

The Electron app generates `FRAMESCRIPT_BACKEND_TOKEN` per app session and passes it to backend/render child processes. Browser-origin requests are restricted to trusted origins.

Useful overrides:

- `FRAMESCRIPT_BACKEND_URL`, default `http://127.0.0.1:3000`
- `FRAMESCRIPT_BACKEND_ADDR`, default `127.0.0.1:3000`
- `FRAMESCRIPT_ALLOWED_ORIGINS`, comma-separated
- `FRAMESCRIPT_MEDIA_ROOTS`, path-delimited allowed file roots. When unset, FrameScript defaults to the project working directory plus any of `~/Videos`, `~/Movies`, `~/Music`, `~/Pictures`, `~/Documents` that exist — the full `$HOME` is **not** included by default. Pass an explicit value to broaden or narrow the scope.
- `FRAMESCRIPT_PROJECT_ROOT`, base for relative media paths

## Render outputs

The render binary writes intermediate segments into a per-render temp directory. The final output is promoted to `FRAMESCRIPT_OUTPUT_PATH` or `output.mp4` only after concat and audio mux succeed. Canceled renders keep partial files out of the final output path.

## Smoke checks

Run:

```bash
npm run typecheck
npm run test
npm run smoke:backend
cargo check --manifest-path backend/Cargo.toml
cargo check --manifest-path render/Cargo.toml
```

`smoke:backend` starts the backend on an alternate port, verifies `/healthz`, and checks that mutation APIs reject missing session tokens.

## Failure triage

- Backend does not start: verify Rust is installed, `FRAMESCRIPT_BACKEND_ADDR` is free, and the backend binary exists in binary mode.
- Render exits before frames: verify `dist-render/render.html`, Chromium path, and render page URL.
- Media fails to load: verify the path is inside `FRAMESCRIPT_MEDIA_ROOTS` and the request origin is trusted.
- ffmpeg mismatch: check logs for the selected `FRAMESCRIPT_FFMPEG_PATH` / `FRAMESCRIPT_FFPROBE_PATH`.
- Canceled render left no output: expected. Re-run render after the backend reset at the start of the next render.
