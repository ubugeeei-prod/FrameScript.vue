import { spawn } from "node:child_process"

const addr = process.env.FRAMESCRIPT_BACKEND_ADDR ?? "127.0.0.1:3010"
const baseUrl = process.env.FRAMESCRIPT_BACKEND_URL ?? `http://${addr}`
const token = process.env.FRAMESCRIPT_BACKEND_TOKEN ?? "smoke-token"

const backend = spawn(
  "cargo",
  ["run", "--manifest-path", "backend/Cargo.toml"],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      FRAMESCRIPT_BACKEND_ADDR: addr,
      FRAMESCRIPT_BACKEND_URL: baseUrl,
      FRAMESCRIPT_BACKEND_TOKEN: token,
      FRAMESCRIPT_ALLOWED_ORIGINS: "http://localhost:5173",
      FRAMESCRIPT_MEDIA_ROOTS: process.cwd(),
      FRAMESCRIPT_PROJECT_ROOT: process.cwd(),
    },
  },
)

let output = ""
backend.stdout.on("data", (chunk) => {
  output += chunk.toString()
})
backend.stderr.on("data", (chunk) => {
  output += chunk.toString()
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForHealthz() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/healthz`, {
        headers: { Origin: "http://localhost:5173" },
      })
      if (res.ok) return
    } catch {
      // retry
    }
    await sleep(300)
  }
  throw new Error(`backend healthz timeout\n${output}`)
}

try {
  await waitForHealthz()

  const unauthorized = await fetch(`${baseUrl}/reset`, {
    method: "POST",
    headers: { Origin: "http://localhost:5173" },
  })
  if (unauthorized.status !== 401) {
    throw new Error(
      `expected unauthenticated reset to return 401, got ${unauthorized.status}`,
    )
  }

  const reset = await fetch(`${baseUrl}/reset`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:5173",
      "x-framescript-token": token,
    },
  })
  if (!reset.ok) {
    throw new Error(`authenticated reset failed: ${reset.status}`)
  }
} finally {
  backend.kill()
}
