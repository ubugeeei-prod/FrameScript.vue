# Third-Party Binary Notices

FrameScript.vue is MIT licensed, but release artifacts may include third-party binaries with separate redistribution terms.

## Bundled Runtime Components

- Electron: includes Chromium and Node.js runtime components. Preserve Electron/Chromium notices in packaged app artifacts.
- Puppeteer Chromium: if `FRAMESCRIPT_CHROMIUM_PATH` or Puppeteer-managed Chromium is bundled, include Chromium notices.
- `@ffmpeg-installer/ffmpeg`: provides ffmpeg binaries. Include the license and source/redistribution notes shipped by the package.
- `@ffprobe-installer/ffprobe`: provides ffprobe binaries. Include the license and source/redistribution notes shipped by the package.

## Release Checklist

- Include this file and `LICENSE` in packaged artifacts.
- Include the license/notice files from bundled binary packages.
- Record exact binary versions used for ffmpeg, ffprobe, Electron, and Chromium.
- Verify platform-specific artifacts contain `backend`, `render`, `dist/`, `dist-render/`, and `dist-electron/`.
- Re-check redistribution obligations whenever binary package versions change.

This file is a release engineering checklist, not legal advice.
