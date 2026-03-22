const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "")

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL
  ? trimTrailingSlash(import.meta.env.VITE_API_BASE_URL)
  : ""

export const apiUrl = (path: string) => {
  if (!path.startsWith("/")) {
    throw new Error(`apiUrl path must start with '/': ${path}`)
  }
  return configuredBaseUrl ? `${configuredBaseUrl}${path}` : path
}
