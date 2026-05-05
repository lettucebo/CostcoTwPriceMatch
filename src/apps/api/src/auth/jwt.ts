import { SignJWT, jwtVerify, decodeJwt, createRemoteJWKSet, jwtVerify as joseJwtVerify } from 'jose'
import type { JwtPayload } from '@costco/shared'

const ISSUER = 'costco-tw-price-match'
const AUDIENCE = 'costco-tw-price-match'

/** Sign an HS256 JWT for our session cookie. */
export async function signSessionJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSec = 60 * 60 * 24 * 7,
): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSec}s`)
    .sign(key)
}

/** Verify our HS256 session JWT. */
export async function verifySessionJwt(
  token: string,
  secret: string,
): Promise<JwtPayload> {
  const key = new TextEncoder().encode(secret)
  const { payload } = await jwtVerify(token, key, {
    issuer: ISSUER,
    audience: AUDIENCE,
  })
  return payload as unknown as JwtPayload
}

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
)

export interface GoogleIdToken {
  iss: string
  aud: string
  sub: string
  email: string
  email_verified: boolean
  name?: string
  picture?: string
  nonce?: string
  iat: number
  exp: number
}

/** Verify Google's id_token via JWKS. */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  expectedNonce?: string,
): Promise<GoogleIdToken> {
  const { payload } = await joseJwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: clientId,
  })
  const p = payload as unknown as GoogleIdToken
  if (!p.email_verified) {
    throw new Error('Google email not verified')
  }
  if (expectedNonce && p.nonce !== expectedNonce) {
    throw new Error('OAuth nonce mismatch')
  }
  return p
}

/** Best-effort decode without verification (for logging). */
export function decode(token: string): unknown {
  try {
    return decodeJwt(token)
  } catch {
    return null
  }
}
