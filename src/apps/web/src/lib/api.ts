/**
 * API base URL.
 * - Dev: empty string → uses Vite proxy in vite.config.ts (`/api`, `/auth`).
 * - Prod: must be set to the Workers origin (e.g. `https://costco-tw-price-match-api.workers.dev`)
 *   because Pages serves the SPA on a different eTLD+1 than the API.
 *
 * If unset in a production build the app will call `/api/*` on the Pages origin
 * and get 404s. Fail loud at module-load time so the build/runtime is clearly broken.
 */
const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''
if (import.meta.env.PROD && !RAW_API_BASE) {
  // eslint-disable-next-line no-console
  console.error(
    '[api] VITE_API_BASE_URL is required in production builds. ' +
      'Set it on Cloudflare Pages → Settings → Environment Variables.',
  )
  throw new Error('VITE_API_BASE_URL is not configured for this build')
}
export const API_BASE = RAW_API_BASE

export interface ApiOptions extends RequestInit {
  /** Don't throw on 401 — caller will handle. */
  allow401?: boolean
}

export async function api(path: string, init: ApiOptions = {}): Promise<Response> {
  const { allow401, ...rest } = init
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  const res = await fetch(url, {
    credentials: 'include',
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(rest.headers ?? {}),
    },
  })
  if (!res.ok) {
    if (res.status === 401 && allow401) return res
    let body: unknown = undefined
    try {
      body = await res.clone().json()
    } catch {
      // ignore
    }
    const err = new Error(
      `API ${res.status} ${res.statusText}` +
        (body && typeof body === 'object' && 'message' in body
          ? `: ${(body as { message: string }).message}`
          : ''),
    ) as Error & { status: number; body: unknown }
    err.status = res.status
    err.body = body
    throw err
  }
  return res
}
