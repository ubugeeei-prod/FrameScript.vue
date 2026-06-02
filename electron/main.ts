import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron"
import { spawn, ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import * as os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { pathToFileURL } from "node:url"
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg"
import ffprobeInstaller from "@ffprobe-installer/ffprobe"
import puppeteer from "puppeteer"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const useDevServer = process.env.VITE_DEV_SERVER_URL !== undefined
const runMode =
  process.env.FRAMESCRIPT_RUN_MODE ?? (useDevServer ? "dev" : "bin")
const useBinaries = runMode !== "dev"
const APP_NAME = "FrameScript"
const backendToken =
  process.env.FRAMESCRIPT_BACKEND_TOKEN ?? randomBytes(32).toString("hex")

if (app.name !== APP_NAME) {
  app.setName(APP_NAME)
}

const resolveBundledBinaryPath = (installer: unknown) => {
  const candidate =
    (installer as { path?: string; default?: { path?: string } } | undefined)
      ?.path ??
    (installer as { default?: { path?: string } } | undefined)?.default?.path
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate
  }
  return null
}

const resolvePuppeteerExecutablePath = () => {
  try {
    if (typeof puppeteer?.executablePath === "function") {
      return puppeteer.executablePath()
    }
  } catch {
    // ignore
  }
  return null
}

function getBackendBaseUrl() {
  const value = process.env.FRAMESCRIPT_BACKEND_URL?.trim()
  if (value) return value.replace(/\/+$/, "")
  return "http://127.0.0.1:3000"
}

function getBackendEndpoint(pathname: string) {
  return `${getBackendBaseUrl()}/${pathname.replace(/^\/+/, "")}`
}

function getMediaRoots() {
  const configured = process.env.FRAMESCRIPT_MEDIA_ROOTS
  if (configured?.trim()) return configured
  return [process.cwd(), os.homedir()].join(path.delimiter)
}

function getTrustedOrigins() {
  const configured = process.env.FRAMESCRIPT_ALLOWED_ORIGINS
  if (configured?.trim()) {
    return configured
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "file://",
    "null",
  ]
}

function getBackendRuntimeEnv(): NodeJS.ProcessEnv {
  return {
    FRAMESCRIPT_BACKEND_TOKEN: backendToken,
    FRAMESCRIPT_BACKEND_URL: getBackendBaseUrl(),
    FRAMESCRIPT_ALLOWED_ORIGINS: getTrustedOrigins().join(","),
    FRAMESCRIPT_PROJECT_ROOT: process.cwd(),
    FRAMESCRIPT_MEDIA_ROOTS: getMediaRoots(),
  }
}

function assertTrustedUrl(rawUrl: string, label: string) {
  const parsed = new URL(rawUrl)
  if (parsed.protocol === "file:") return
  const trusted = getTrustedOrigins()
  if (!trusted.includes(parsed.origin)) {
    throw new Error(`${label} is not a trusted FrameScript origin: ${rawUrl}`)
  }
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent) {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL()
  if (!senderUrl) {
    throw new Error("render IPC sender URL is unavailable")
  }
  assertTrustedUrl(senderUrl, "render IPC sender")
}

function getBundledBinaryEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  const ffmpegPath =
    process.env.FRAMESCRIPT_FFMPEG_PATH ??
    resolveBundledBinaryPath(ffmpegInstaller)
  const ffprobePath =
    process.env.FRAMESCRIPT_FFPROBE_PATH ??
    resolveBundledBinaryPath(ffprobeInstaller)
  const chromiumPath =
    process.env.FRAMESCRIPT_CHROMIUM_PATH ??
    process.env.PUPPETEER_EXECUTABLE_PATH ??
    resolvePuppeteerExecutablePath()
  if (ffmpegPath) {
    env.FRAMESCRIPT_FFMPEG_PATH = ffmpegPath
  }
  if (ffprobePath) {
    env.FRAMESCRIPT_FFPROBE_PATH = ffprobePath
  }
  if (chromiumPath) {
    env.FRAMESCRIPT_CHROMIUM_PATH = chromiumPath
  }
  return env
}

let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null
let backendHealthyPromise: Promise<void> | null = null
let renderSettingsWindow: BrowserWindow | null = null
let renderProgressWindow: BrowserWindow | null = null
let renderChild: ChildProcess | null = null

type RenderStartPayload = {
  width: number
  height: number
  fps: number
  totalFrames: number
  workers: number
  encode: "H264" | "H265"
  preset: string
  ffmpegThreads: number
  ffmpegLowMemory: boolean
}

const RENDER_PRESETS = new Set([
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow",
])
const MAX_RENDER_WIDTH = 7680
const MAX_RENDER_HEIGHT = 4320
const MAX_RENDER_FPS = 240
const MAX_RENDER_FRAMES = 1_000_000

const getMaxParallelism = () =>
  Math.max(1, Math.min(32, os.availableParallelism?.() ?? os.cpus().length))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

function readBoundedInteger(
  payload: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
) {
  const raw = Number(payload[key])
  if (!Number.isFinite(raw)) {
    throw new Error(`Invalid render payload: ${key} must be a finite number`)
  }
  const value = Math.round(raw)
  if (value < min || value > max) {
    throw new Error(
      `Invalid render payload: ${key} must be between ${min} and ${max}`,
    )
  }
  return value
}

function readBoundedNumber(
  payload: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
) {
  const value = Number(payload[key])
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(
      `Invalid render payload: ${key} must be between ${min} and ${max}`,
    )
  }
  return value
}

function validateRenderStartPayload(payload: unknown): RenderStartPayload {
  if (!isRecord(payload)) {
    throw new Error("Invalid render payload")
  }

  const maxParallelism = getMaxParallelism()
  const width = readBoundedInteger(payload, "width", 1, MAX_RENDER_WIDTH)
  const height = readBoundedInteger(payload, "height", 1, MAX_RENDER_HEIGHT)
  const fps = readBoundedNumber(payload, "fps", 1, MAX_RENDER_FPS)
  const totalFrames = readBoundedInteger(
    payload,
    "totalFrames",
    1,
    MAX_RENDER_FRAMES,
  )
  const workers = readBoundedInteger(payload, "workers", 1, maxParallelism)
  const ffmpegThreads = readBoundedInteger(
    payload,
    "ffmpegThreads",
    1,
    maxParallelism,
  )
  const encode = payload.encode
  if (encode !== "H264" && encode !== "H265") {
    throw new Error("Invalid render payload: encode must be H264 or H265")
  }

  const preset = typeof payload.preset === "string" ? payload.preset : ""
  if (!RENDER_PRESETS.has(preset)) {
    throw new Error("Invalid render payload: unsupported ffmpeg preset")
  }

  return {
    width,
    height,
    fps,
    totalFrames,
    workers,
    encode,
    preset,
    ffmpegThreads,
    ffmpegLowMemory: Boolean(payload.ffmpegLowMemory),
  }
}

function clearBackendHealth() {
  backendHealthyPromise = null
}

function getPlatformKey() {
  if (process.platform === "linux" && process.arch === "x64")
    return "linux-x86_64"
  if (process.platform === "win32" && process.arch === "x64")
    return "win32-x86_64"
  if (process.platform === "darwin" && process.arch === "arm64")
    return "macos-arm64"
  return `${process.platform}-${process.arch}`
}

function getBackendBinaryPath() {
  const platformKey = getPlatformKey()
  const binName = process.platform === "win32" ? "backend.exe" : "backend"

  const candidates = [
    process.env.FRAMESCRIPT_BACKEND_BIN,
    path.join(process.cwd(), "bin", platformKey, binName),
    path.join(process.resourcesPath, "bin", platformKey, binName),
    path.join(process.resourcesPath, "backend", binName),
  ].filter(Boolean) as string[]

  const found = candidates.find((p) => fs.existsSync(p))
  return { platformKey, binName, candidates, path: found ?? candidates[0] }
}

function getRenderPageUrl() {
  if (process.env.RENDER_PAGE_URL) {
    assertTrustedUrl(process.env.RENDER_PAGE_URL, "RENDER_PAGE_URL")
    return process.env.RENDER_PAGE_URL
  }
  if (useDevServer) {
    const renderUrl =
      process.env.RENDER_DEV_SERVER_URL ?? "http://localhost:5174/render"
    assertTrustedUrl(renderUrl, "RENDER_DEV_SERVER_URL")
    return renderUrl
  }
  const htmlPath = path.join(process.cwd(), "dist-render", "render.html")
  return pathToFileURL(htmlPath).toString()
}

function getRenderOutputPath() {
  return (
    process.env.FRAMESCRIPT_OUTPUT_PATH ??
    path.join(process.cwd(), "output.mp4")
  )
}

function getRenderOutputDisplayPath() {
  const absolute = getRenderOutputPath()
  const relative = path.relative(process.cwd(), absolute)
  const display = relative || absolute
  return display.split(path.sep).join("/")
}

function startBackend(): Promise<void> {
  if (backendProcess) {
    return Promise.resolve()
  }

  if (!useBinaries) {
    const backendCwd = path.join(process.cwd(), "backend")

    backendProcess = spawn("cargo", ["run"], {
      cwd: backendCwd,
      stdio: "pipe",
      env: {
        ...process.env,
        ...getBundledBinaryEnv(),
        ...getBackendRuntimeEnv(),
      },
    })

    console.log("[backend] spawn: cargo run (dev)")
  } else {
    const info = getBackendBinaryPath()
    if (!fs.existsSync(info.path)) {
      throw new Error(
        `Backend binary not found for platform "${info.platformKey}". Tried:\n` +
          info.candidates.map((p) => `- ${p}`).join("\n"),
      )
    }

    backendProcess = spawn(info.path, [], {
      stdio: "pipe",
      env: {
        ...process.env,
        ...getBundledBinaryEnv(),
        ...getBackendRuntimeEnv(),
      },
    })

    console.log("[backend] spawn:", info.path)
  }

  backendProcess.stdout?.on("data", (data) => {
    console.log("[backend stdout]", data.toString())
  })

  backendProcess.stderr?.on("data", (data) => {
    console.error("[backend stderr]", data.toString())
  })

  backendProcess.on("error", (error) => {
    console.error("[backend error]", error)
    clearBackendHealth()
  })

  backendProcess.on("exit", (code, signal) => {
    console.log(`[backend exited] code=${code} signal=${signal}`)
    backendProcess = null
    clearBackendHealth()
  })

  return Promise.resolve()
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    console.log("[backend] kill")
    backendProcess.kill()
  }
}

async function waitForHealthz(): Promise<void> {
  if (backendHealthyPromise) return backendHealthyPromise

  const healthUrl = getBackendEndpoint("healthz")
  backendHealthyPromise = new Promise((resolve, reject) => {
    const started = Date.now()
    const timeoutMs = 15_000
    const intervalMs = 300
    const timer: NodeJS.Timeout = setInterval(() => {
      fetch(healthUrl)
        .then((res) => {
          if (res.ok) {
            clearInterval(timer)
            resolve()
          }
        })
        .catch(() => {
          // ignore and retry
        })

      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        clearBackendHealth()
        reject(new Error("healthz timeout"))
      }
    }, intervalMs)
  })

  return backendHealthyPromise
}

function resolveRenderSettingsUrl() {
  if (useDevServer && process.env.VITE_DEV_SERVER_URL) {
    assertTrustedUrl(process.env.VITE_DEV_SERVER_URL, "VITE_DEV_SERVER_URL")
    return `${process.env.VITE_DEV_SERVER_URL}/#/render-settings`
  }

  const indexPath = path.join(__dirname, "../dist/index.html")
  return { file: indexPath, hash: "render-settings" } as const
}

function resolveRenderProgressUrl() {
  const outputParam = encodeURIComponent(getRenderOutputDisplayPath())
  if (useDevServer && process.env.VITE_DEV_SERVER_URL) {
    assertTrustedUrl(process.env.VITE_DEV_SERVER_URL, "VITE_DEV_SERVER_URL")
    return `${process.env.VITE_DEV_SERVER_URL}/#/render-progress?output=${outputParam}`
  }

  const indexPath = path.join(__dirname, "../dist/index.html")
  return {
    file: indexPath,
    hash: `render-progress?output=${outputParam}`,
  } as const
}

function resolveRenderPreloadPath() {
  const candidates = [
    path.join(__dirname, "render-settings-preload.js"),
    path.join(process.cwd(), "dist-electron", "render-settings-preload.js"),
    path.join(process.cwd(), "render-settings-preload.js"),
  ]
  const found = candidates.find((p) => fs.existsSync(p))
  if (!found) {
    console.warn("[render preload] file not found. Tried:", candidates)
    return candidates[0]
  }
  return found
}

function getRenderBinaryInfo() {
  const platformKey = getPlatformKey()
  const binName = process.platform === "win32" ? "render.exe" : "render"
  const candidates = [
    process.env.FRAMESCRIPT_RENDER_BIN,
    path.join(process.cwd(), "bin", platformKey, binName),
    path.join(process.resourcesPath, "bin", platformKey, binName),
    path.join(process.resourcesPath, "render", binName),
  ].filter(Boolean) as string[]
  const binPath = candidates.find((p) => fs.existsSync(p)) ?? candidates[0]
  return { platformKey, binName, binPath, candidates }
}

function startRenderProcess(payload: RenderStartPayload) {
  const lowMemoryFlag = payload.ffmpegLowMemory ? 1 : 0
  const argsString = `${payload.width}:${payload.height}:${payload.fps}:${payload.totalFrames}:${payload.workers}:${payload.encode}:${payload.preset}:${payload.ffmpegThreads}:${lowMemoryFlag}`

  if (renderChild && !renderChild.killed) {
    console.log("[render] terminating previous render process")
    renderChild.kill()
    renderChild = null
  }

  if (!useBinaries) {
    const renderCwd = path.join(process.cwd(), "render")
    try {
      renderChild = spawn("cargo", ["run", "--", argsString], {
        cwd: renderCwd,
        env: {
          ...process.env,
          ...getBundledBinaryEnv(),
          ...getBackendRuntimeEnv(),
          RENDER_PAGE_URL: getRenderPageUrl(),
          RENDER_OUTPUT_PATH: getRenderOutputPath(),
        },
        stdio: "inherit",
      })
    } catch (error) {
      console.error("[render] failed to spawn cargo run", error)
      throw error
    }
    renderChild.on("error", (error) => {
      console.error("[render] process error", error)
    })
    renderChild.on("exit", (code, signal) => {
      console.log(`[render] exited code=${code} signal=${signal}`)
      renderChild = null
    })
    console.log(
      "[render] spawn (dev): cargo run --",
      argsString,
      "cwd=",
      renderCwd,
    )
    return { cmd: `render (cargo run) -- ${argsString}`, pid: renderChild?.pid }
  } else {
    const { binPath, platformKey } = getRenderBinaryInfo()

    if (!fs.existsSync(binPath)) {
      const info = getRenderBinaryInfo()
      throw new Error(
        `Render binary not found for platform "${platformKey}". Tried:\n` +
          info.candidates.map((p) => `- ${p}`).join("\n"),
      )
    }

    try {
      renderChild = spawn(binPath, [argsString], {
        env: {
          ...process.env,
          ...getBundledBinaryEnv(),
          ...getBackendRuntimeEnv(),
          RENDER_PAGE_URL: getRenderPageUrl(),
          RENDER_OUTPUT_PATH: getRenderOutputPath(),
        },
        stdio: "inherit",
      })
    } catch (error) {
      console.error("[render] failed to spawn render binary", error)
      throw error
    }

    renderChild.on("error", (error) => {
      console.error("[render] process error", error)
    })

    renderChild.on("exit", (code, signal) => {
      console.log(`[render] exited code=${code} signal=${signal}`)
      renderChild = null
    })

    console.log("[render] spawn:", binPath, argsString)
    return { cmd: `${binPath} ${argsString}`, pid: renderChild.pid }
  }

  // unreachable
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: "#0b1221",
    webPreferences: {
      // preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (useDevServer && process.env.VITE_DEV_SERVER_URL) {
    assertTrustedUrl(process.env.VITE_DEV_SERVER_URL, "VITE_DEV_SERVER_URL")
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    //mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, "../dist/index.html")
    await mainWindow.loadFile(indexPath)
  }

  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

function createRenderSettingsWindow() {
  if (renderSettingsWindow && !renderSettingsWindow.isDestroyed()) {
    renderSettingsWindow.focus()
    return
  }

  renderSettingsWindow = new BrowserWindow({
    width: 640,
    height: 800,
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: "#0b1221",
    title: "Render Settings",
    parent: mainWindow ?? undefined,
    modal: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: resolveRenderPreloadPath(),
      sandbox: false,
    },
  })
  renderSettingsWindow.setMenu(null)
  renderSettingsWindow.setMenuBarVisibility(false)

  const target = resolveRenderSettingsUrl()
  if (typeof target === "string") {
    void renderSettingsWindow.loadURL(target)
  } else {
    void renderSettingsWindow.loadFile(target.file, { hash: target.hash })
  }

  renderSettingsWindow.on("closed", () => {
    renderSettingsWindow = null
  })
}

function createRenderProgressWindow() {
  if (renderProgressWindow && !renderProgressWindow.isDestroyed()) {
    renderProgressWindow.focus()
    return
  }

  renderProgressWindow = new BrowserWindow({
    width: 420,
    height: 300,
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: "#0b1221",
    title: "Render Progress",
    parent: mainWindow ?? undefined,
    modal: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: resolveRenderPreloadPath(),
    },
  })
  renderProgressWindow.setMenu(null)
  renderProgressWindow.setMenuBarVisibility(false)

  const target = resolveRenderProgressUrl()
  if (typeof target === "string") {
    void renderProgressWindow.loadURL(target)
  } else {
    void renderProgressWindow.loadFile(target.file, { hash: target.hash })
  }

  renderProgressWindow.on("closed", () => {
    renderProgressWindow = null
  })
}

function setupRenderIpc() {
  ipcMain.handle("render:getPlatform", (event) => {
    assertTrustedIpcSender(event)
    if (!useBinaries) {
      const renderDir = path.join(process.cwd(), "render")
      return {
        platform: "dev",
        binPath: renderDir,
        binName: "cargo run",
        isDev: true,
      }
    }
    const info = getRenderBinaryInfo()
    return {
      platform: info.platformKey,
      binPath: info.binPath,
      binName: info.binName,
      isDev: false,
    }
  })

  ipcMain.handle("render:getOutputPath", (event) => {
    assertTrustedIpcSender(event)
    return {
      path: getRenderOutputPath(),
      displayPath: getRenderOutputDisplayPath(),
    }
  })

  ipcMain.handle("render:getBackendConfig", (event) => {
    assertTrustedIpcSender(event)
    return {
      baseUrl: getBackendBaseUrl(),
      token: backendToken,
    }
  })

  ipcMain.handle("render:openProgress", (event) => {
    assertTrustedIpcSender(event)
    createRenderProgressWindow()
  })

  ipcMain.handle("render:start", (event, payload: unknown) => {
    assertTrustedIpcSender(event)
    return startRenderProcess(validateRenderStartPayload(payload))
  })
}

function setupMenu() {
  const template: MenuItemConstructorOptions[] = []

  if (process.platform === "darwin") {
    template.push({
      label: APP_NAME,
      submenu: [
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    })
  }

  template.push(
    {
      label: "File",
      submenu: [
        {
          label: "Render…",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            createRenderSettingsWindow()
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Debug",
      submenu: [
        {
          label: "DevTools",
          accelerator: "CmdOrCtrl+Alt+I",
          click: () => {
            const win = BrowserWindow.getFocusedWindow() ?? mainWindow
            if (!win) return
            win.webContents.openDevTools({ mode: "detach" })
          },
        },
        {
          label: "Toggle DevTools",
          accelerator: "CmdOrCtrl+Shift+I",
          click: () => {
            const win = BrowserWindow.getFocusedWindow() ?? mainWindow
            if (!win) return
            win.webContents.toggleDevTools()
          },
        },
        { type: "separator" },
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            const win = BrowserWindow.getFocusedWindow() ?? mainWindow
            win?.webContents.reload()
          },
        },
        {
          label: "Force Reload",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => {
            const win = BrowserWindow.getFocusedWindow() ?? mainWindow
            win?.webContents.reloadIgnoringCache()
          },
        },
      ],
    },
  )

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

app.commandLine.appendSwitch("enable-unsafe-webgpu")
/*
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-features", "Vulkan");
}
*/

app.whenReady().then(async () => {
  await startBackend()
  await waitForHealthz()
  await createWindow()
  setupRenderIpc()
  setupMenu()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
})

app.on("before-quit", () => {
  stopBackend()
  if (renderChild && !renderChild.killed) {
    renderChild.kill()
  }
})

app.on("window-all-closed", () => {
  // if (process.platform !== "darwin") {
  app.quit()
  // }
})
