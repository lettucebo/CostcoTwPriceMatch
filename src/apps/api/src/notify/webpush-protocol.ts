/**
 * Web Push (RFC 8030) for Cloudflare Workers — pure Web Crypto API.
 * - VAPID JWT (ES256)
 * - aes128gcm content encoding (RFC 8188)
 *
 * No Node.js dependencies, no `node:crypto`.
 */

export interface PushSubscriptionKeys {
  endpoint: string
  p256dh: string // base64url
  auth: string // base64url
}

export interface VapidConfig {
  publicKey: string // base64url uncompressed P-256
  privateKey: string // base64url 32 bytes
  subject: string // mailto:... or https URL
}

export interface SendPushOptions {
  ttl?: number
  urgency?: 'very-low' | 'low' | 'normal' | 'high'
  topic?: string
}

export class PushSendError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`web-push send failed: ${status} ${body.slice(0, 200)}`)
    this.name = 'PushSendError'
  }
}

const ENCODER = new TextEncoder()
const DECODER = new TextDecoder()

export async function sendPush(
  sub: PushSubscriptionKeys,
  payload: string | Uint8Array,
  vapid: VapidConfig,
  opts: SendPushOptions = {},
): Promise<void> {
  const url = new URL(sub.endpoint)
  const audience = `${url.protocol}//${url.host}`
  const jwt = await signVapidJwt(audience, vapid)

  const body = await encryptPayload(
    typeof payload === 'string' ? ENCODER.encode(payload) : payload,
    base64UrlToBytes(sub.p256dh),
    base64UrlToBytes(sub.auth),
  )

  const headers: Record<string, string> = {
    Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl ?? 86400),
  }
  if (opts.urgency) headers.Urgency = opts.urgency
  if (opts.topic) headers.Topic = opts.topic

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers,
    body: bytesToArrayBuffer(body),
  })
  if (!res.ok) {
    throw new PushSendError(res.status, await res.text().catch(() => ''))
  }
}

// ---------- VAPID JWT (ES256) ----------

async function signVapidJwt(
  audience: string,
  vapid: VapidConfig,
): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    aud: audience,
    exp: now + 12 * 60 * 60,
    sub: vapid.subject,
  }
  const headerB64 = bytesToBase64Url(ENCODER.encode(JSON.stringify(header)))
  const payloadB64 = bytesToBase64Url(ENCODER.encode(JSON.stringify(payload)))
  const signingInput = `${headerB64}.${payloadB64}`
  const key = await importVapidPrivateKey(vapid)
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    ENCODER.encode(signingInput),
  )
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(sig))}`
}

async function importVapidPrivateKey(v: VapidConfig): Promise<CryptoKey> {
  // d || pub (uncompressed) -> JWK form
  const d = base64UrlToBytes(v.privateKey)
  const pub = base64UrlToBytes(v.publicKey)
  // pub is 65 bytes: 0x04 || x(32) || y(32)
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error('VAPID public key must be uncompressed (65 bytes, 0x04|x|y)')
  }
  const x = pub.slice(1, 33)
  const y = pub.slice(33, 65)
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: bytesToBase64Url(d),
    x: bytesToBase64Url(x),
    y: bytesToBase64Url(y),
    ext: true,
  }
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

// ---------- aes128gcm payload encryption (RFC 8188 + RFC 8291) ----------

async function encryptPayload(
  payload: Uint8Array,
  uaPublicRaw: Uint8Array,
  authSecret: Uint8Array,
): Promise<Uint8Array> {
  // 1) Generate ephemeral ECDH key pair
  const eph = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )) as CryptoKeyPair
  const ephPubRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', eph.publicKey),
  )
  const uaPub = await crypto.subtle.importKey(
    'raw',
    bytesToArrayBuffer(uaPublicRaw),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaPub },
      eph.privateKey,
      256,
    ),
  )

  // 2) PRK = HKDF(sharedSecret, salt=auth, info="WebPush: info\0" || uaPub || ephPub) length 32
  const keyInfo = concat(
    ENCODER.encode('WebPush: info\0'),
    uaPublicRaw,
    ephPubRaw,
  )
  const prk = await hkdf(authSecret, sharedSecret, keyInfo, 32)

  // 3) salt (random 16 bytes) for content encryption
  const salt = crypto.getRandomValues(new Uint8Array(16))

  // 4) CEK = HKDF(prk, salt, "Content-Encoding: aes128gcm\0", 16)
  const cek = await hkdf(salt, prk, ENCODER.encode('Content-Encoding: aes128gcm\0'), 16)
  // 5) NONCE = HKDF(prk, salt, "Content-Encoding: nonce\0", 12)
  const nonce = await hkdf(salt, prk, ENCODER.encode('Content-Encoding: nonce\0'), 12)

  // 6) plaintext = payload || 0x02
  const padded = new Uint8Array(payload.length + 1)
  padded.set(payload, 0)
  padded[payload.length] = 0x02

  const aesKey = await crypto.subtle.importKey(
    'raw',
    bytesToArrayBuffer(cek),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: bytesToArrayBuffer(nonce) },
      aesKey,
      bytesToArrayBuffer(padded),
    ),
  )

  // 7) Header: salt(16) | rs(4 BE) | idlen(1) | keyid(idlen) | ciphertext
  const rs = 4096 // record size; doesn't matter for single-record
  const header = new Uint8Array(16 + 4 + 1 + ephPubRaw.length)
  header.set(salt, 0)
  // rs as big-endian uint32
  new DataView(header.buffer, header.byteOffset).setUint32(16, rs, false)
  header[20] = ephPubRaw.length
  header.set(ephPubRaw, 21)

  return concat(header, ciphertext)
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    bytesToArrayBuffer(ikm),
    'HKDF',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: bytesToArrayBuffer(salt),
      info: bytesToArrayBuffer(info),
    },
    key,
    length * 8,
  )
  return new Uint8Array(bits)
}

// ---------- helpers ----------

function bytesToArrayBuffer(b: Uint8Array): ArrayBuffer {
  // Always copy into a fresh, plain ArrayBuffer
  const out = new ArrayBuffer(b.byteLength)
  new Uint8Array(out).set(b)
  return out
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrs) {
    out.set(a, off)
    off += a.length
  }
  return out
}

export function base64UrlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (padded.length % 4)) % 4)
  const raw = atob(padded + padding)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function bytesToBase64Url(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
