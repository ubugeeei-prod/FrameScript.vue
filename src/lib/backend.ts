const DEFAULT_BACKEND_URL = "http://127.0.0.1:3000"

const readEnv = (key: string) => {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env
  return env?.[key]?.trim() ?? ""
}

export const getBackendBaseUrl = () => {
  const configured = readEnv("VITE_FRAMESCRIPT_BACKEND_URL")
  return (configured || DEFAULT_BACKEND_URL).replace(/\/+$/, "")
}

export const getBackendToken = () => readEnv("VITE_FRAMESCRIPT_BACKEND_TOKEN")

export const backendUrl = (path: string) =>
  `${getBackendBaseUrl()}/${path.replace(/^\/+/, "")}`

export const buildBackendUrl = (
  path: string,
  params?: Record<string, string>,
) => {
  const url = new URL(backendUrl(path))
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

export const backendHeaders = () => {
  const token = getBackendToken()
  return token ? { "x-framescript-token": token } : undefined
}

export const backendFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  const token = getBackendToken()
  if (token && !headers.has("x-framescript-token")) {
    headers.set("x-framescript-token", token)
  }
  return fetch(input, { ...init, headers })
}

export const backendWebSocketUrl = (path: string) => {
  const url = new URL(backendUrl(path))
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}
