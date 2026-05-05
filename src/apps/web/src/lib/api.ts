/** API base URL: dev uses Vite proxy, prod uses VITE_API_BASE_URL or same origin. */
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

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
