import type { Context } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import type { AppContext, Env } from '../env.js'
import { signSessionJwt, verifyGoogleIdToken } from './jwt.js'

const COOKIE_NAME = 'costco_session'
const STATE_COOKIE = 'costco_oauth_state'
const STATE_TTL_SEC = 60 * 10 // 10 minutes
const SESSION_TTL_SEC = 60 * 60 * 24 * 7 // 7 days
const ALLOWED_NEXT_RE = /^\/[^/].*$/ // Only allow same-origin paths

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/** GET /auth/google/login — redirect user to Google's consent screen. */
export async function googleLoginRoute(c: Context<AppContext>) {
  const env = c.env
  const next = c.req.query('next') ?? '/'
  const safeNext = ALLOWED_NEXT_RE.test(next) ? next : '/'

  const state = crypto.randomUUID()
  const nonce = crypto.randomUUID()
  await env.KV_CACHE.put(
    `oauth-state:${state}`,
    JSON.stringify({ nonce, next: safeNext }),
    { expirationTtl: STATE_TTL_SEC },
  )

  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    secure: !isLocalDev(env),
    sameSite: 'Lax',
    path: '/auth',
    maxAge: STATE_TTL_SEC,
  })

  const redirectUri = `${env.API_BASE_URL}/auth/google/callback`
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  auth.searchParams.set('client_id', env.GOOGLE_CLIENT_ID)
  auth.searchParams.set('redirect_uri', redirectUri)
  auth.searchParams.set('response_type', 'code')
  auth.searchParams.set('scope', 'openid email profile')
  auth.searchParams.set('access_type', 'online')
  auth.searchParams.set('prompt', 'select_account')
  auth.searchParams.set('state', state)
  auth.searchParams.set('nonce', nonce)
  return c.redirect(auth.toString(), 302)
}

/** GET /auth/google/callback — Google redirects back here with ?code & ?state. */
export async function googleCallbackRoute(c: Context<AppContext>) {
  const env = c.env
  const url = new URL(c.req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) return c.text(`Google OAuth error: ${error}`, 400)
  if (!code || !state) return c.text('Missing code or state', 400)

  const cookieState = getCookie(c, STATE_COOKIE)
  if (cookieState !== state) return c.text('State cookie mismatch', 400)
  const stateRaw = await env.KV_CACHE.get(`oauth-state:${state}`)
  if (!stateRaw) return c.text('State expired or invalid', 400)
  await env.KV_CACHE.delete(`oauth-state:${state}`)
  const { nonce, next } = JSON.parse(stateRaw) as { nonce: string; next: string }
  deleteCookie(c, STATE_COOKIE, { path: '/auth' })

  const redirectUri = `${env.API_BASE_URL}/auth/google/callback`
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) {
    const body = await tokenRes.text()
    console.error('[oauth] token exchange failed', tokenRes.status, body)
    return c.text(`Token exchange failed: ${tokenRes.status}`, 502)
  }
  const tokens = (await tokenRes.json()) as {
    access_token: string
    expires_in: number
    id_token: string
    refresh_token?: string
    scope: string
    token_type: string
  }
  if (!tokens.id_token) return c.text('Missing id_token', 502)

  let id
  try {
    id = await verifyGoogleIdToken(tokens.id_token, env.GOOGLE_CLIENT_ID, nonce)
  } catch (err) {
    console.error('[oauth] id_token verify failed', err)
    return c.text('id_token verification failed', 401)
  }

  const now = new Date().toISOString()
  await env.DB
    .prepare(
      `INSERT INTO users (google_sub, email, name, picture, notification_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (google_sub) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         picture = excluded.picture,
         updated_at = excluded.updated_at`,
    )
    .bind(id.sub, id.email, id.name ?? null, id.picture ?? null, id.email, now, now)
    .run()
  const user = await env.DB
    .prepare('SELECT id, email, name, picture FROM users WHERE google_sub = ?')
    .bind(id.sub)
    .first<{ id: number; email: string; name: string | null; picture: string | null }>()
  if (!user) return c.text('User upsert failed', 500)

  const jwt = await signSessionJwt(
    {
      sub: String(user.id),
      email: user.email,
      name: user.name,
      picture: user.picture,
    },
    env.JWT_SECRET,
    SESSION_TTL_SEC,
  )

  setCookie(c, COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: !isLocalDev(env),
    // SameSite=None is required for cross-site XHR (Pages → Workers) and
    // mandates Secure. In local dev (HTTP via Vite proxy = same-origin) Lax
    // is the correct choice because Secure cookies do not flow over plain HTTP.
    sameSite: isLocalDev(env) ? 'Lax' : 'None',
    path: '/',
    maxAge: SESSION_TTL_SEC,
  })

  return c.redirect(`${env.APP_BASE_URL}${next}`, 302)
}

export async function logoutRoute(c: Context<AppContext>) {
  deleteCookie(c, COOKIE_NAME, { path: '/' })
  return c.json({ ok: true })
}

function isLocalDev(env: Env): boolean {
  return (
    env.API_BASE_URL.startsWith('http://localhost') ||
    env.API_BASE_URL.startsWith('http://127.')
  )
}

export const SESSION_COOKIE = COOKIE_NAME
