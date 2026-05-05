import { describe, it, expect } from 'vitest'
import { signSessionJwt, verifySessionJwt } from '../src/auth/jwt.js'

const SECRET = 'a'.repeat(64)

describe('session jwt', () => {
  it('signs + verifies a valid token round-trip', async () => {
    const token = await signSessionJwt(
      { sub: '42', email: 'a@b.com', name: 'A', picture: null },
      SECRET,
    )
    expect(token.split('.').length).toBe(3)
    const payload = await verifySessionJwt(token, SECRET)
    expect(payload.sub).toBe('42')
    expect(payload.email).toBe('a@b.com')
    expect(payload.exp).toBeGreaterThan(payload.iat)
  })

  it('rejects token signed with different secret', async () => {
    const token = await signSessionJwt(
      { sub: '1', email: 'x', name: null, picture: null },
      SECRET,
    )
    await expect(verifySessionJwt(token, 'b'.repeat(64))).rejects.toThrow()
  })

  it('rejects expired tokens', async () => {
    const token = await signSessionJwt(
      { sub: '1', email: 'x', name: null, picture: null },
      SECRET,
      -1, // already expired
    )
    await expect(verifySessionJwt(token, SECRET)).rejects.toThrow()
  })
})
