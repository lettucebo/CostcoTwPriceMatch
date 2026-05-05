#!/usr/bin/env node
// Generate placeholder solid-color PNGs at the sizes referenced by the PWA manifest.
//
// Why does this exist instead of `pwa-assets-generator`?
//   - `@vite-pwa/assets-generator` requires `sharp`, which currently fails to
//     load on Windows + Node 24 in this repo's environment.
//   - These placeholders satisfy the manifest so the install card / Lighthouse
//     audit no longer 404s. When you have a working `sharp` (Linux CI or a
//     Mac), run `pnpm --filter @costco/web run assets:pwa` to overwrite them
//     with the real icon rendered from `public/pwa-icon.svg`.
//
// PNG encoding uses only Node stdlib (zlib + Buffer), no native deps.

import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = resolve(__dirname, '../public')
mkdirSync(PUBLIC_DIR, { recursive: true })

// Theme colour from manifest.background_color.
const BG = { r: 0x1a, g: 0x1a, b: 0x2e, a: 0xff }

/** Build a solid-color RGBA raster of given dimensions. */
function rasterize(w, h) {
  // Each row: 1 filter-byte (0 = None) + w * 4 bytes RGBA.
  const stride = 1 + w * 4
  const buf = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) {
    let off = y * stride
    buf[off++] = 0 // filter type
    for (let x = 0; x < w; x++) {
      buf[off++] = BG.r
      buf[off++] = BG.g
      buf[off++] = BG.b
      buf[off++] = BG.a
    }
  }
  return buf
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function makePng(width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  // IHDR
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8) // bit depth
  ihdr.writeUInt8(6, 9) // color type RGBA
  ihdr.writeUInt8(0, 10)
  ihdr.writeUInt8(0, 11)
  ihdr.writeUInt8(0, 12)
  // IDAT
  const idat = deflateSync(rasterize(width, height))
  // IEND
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const targets = [
  { name: 'pwa-192x192.png', w: 192, h: 192 },
  { name: 'pwa-512x512.png', w: 512, h: 512 },
  { name: 'pwa-512x512-maskable.png', w: 512, h: 512 },
  { name: 'apple-touch-icon.png', w: 180, h: 180 },
]
for (const t of targets) {
  const out = resolve(PUBLIC_DIR, t.name)
  writeFileSync(out, makePng(t.w, t.h))
  console.log(`wrote ${t.name} (${t.w}x${t.h})`)
}
console.log(
  '\nNote: these are SOLID-COLOUR placeholders so the PWA manifest is valid.',
)
console.log(
  'Run `pnpm --filter @costco/web run assets:pwa` on Linux/macOS to regenerate',
)
console.log('proper icons rendered from public/pwa-icon.svg.')
