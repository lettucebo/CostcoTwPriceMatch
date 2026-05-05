import { describe, it, expect } from 'vitest'
import { __test } from '../src/routes/webhook.js'

const { verifyLineSignature, constantTimeEqual } = __test

describe('LINE webhook signature verification', () => {
  const secret = 'test-channel-secret'

  it('accepts a correct HMAC-SHA256 base64 signature', async () => {
    const body = JSON.stringify({ events: [] })
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
    )
    const expected = btoa(String.fromCharCode(...sig))
    await expect(verifyLineSignature(secret, body, expected)).resolves.toBe(true)
  })

  it('rejects a forged signature', async () => {
    const body = JSON.stringify({ events: [] })
    await expect(
      verifyLineSignature(secret, body, 'AAAA-not-a-real-sig'),
    ).resolves.toBe(false)
  })

  it('rejects an empty signature', async () => {
    await expect(verifyLineSignature(secret, 'body', '')).resolves.toBe(false)
  })

  it('rejects a different body with the same signature', async () => {
    const body = JSON.stringify({ events: [] })
    const tampered = JSON.stringify({ events: ['evil'] })
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
    )
    const expected = btoa(String.fromCharCode(...sig))
    await expect(verifyLineSignature(secret, tampered, expected)).resolves.toBe(
      false,
    )
  })
})

describe('constantTimeEqual', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEqual('abc123', 'abc123')).toBe(true)
  })
  it('returns false for different strings', () => {
    expect(constantTimeEqual('abc123', 'abc124')).toBe(false)
  })
  it('returns false for differing lengths (constant time)', () => {
    expect(constantTimeEqual('a', 'aa')).toBe(false)
  })
})
