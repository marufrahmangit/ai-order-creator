/**
 * Just enough PNG to build the app's icons from the logo, with no
 * dependencies - this toolchain has none beyond Vite, and an image library for
 * a handful of files run once per logo change would be a poor trade.
 *
 * Decodes 8-bit RGB and RGBA, non-interlaced (what logo.png is); encodes RGB
 * or RGBA. Anything else is refused loudly rather than misread.
 *
 * Shared by scripts/make-icons.mjs, which writes the icons, and
 * test/icons.test.mjs, which regenerates them in memory and compares.
 */

import zlib from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * @param {Buffer} file
 * @returns {{width: number, height: number, channels: 3|4, hasAlpha: boolean, data: Uint8Array}}
 *   data is always RGBA, 4 bytes per pixel; hasAlpha says whether the file had any.
 */
export function decodePng(file) {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG')

  let offset = 8
  let header = null
  const idat = []
  let transparencyChunk = false

  while (offset < file.length) {
    const length = file.readUInt32BE(offset)
    const type = file.toString('latin1', offset + 4, offset + 8)
    const body = file.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colourType: body[9],
        interlace: body[12],
      }
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'tRNS') {
      transparencyChunk = true
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  if (!header) throw new Error('PNG has no IHDR')
  const { width, height, bitDepth, colourType, interlace } = header
  if (bitDepth !== 8 || interlace !== 0 || (colourType !== 2 && colourType !== 6)) {
    throw new Error(`unsupported PNG: bit depth ${bitDepth}, colour type ${colourType}, interlace ${interlace}`)
  }
  if (transparencyChunk) throw new Error('PNG uses a tRNS chunk, which this decoder does not apply')

  const channels = colourType === 6 ? 4 : 3
  const stride = width * channels
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const pixels = new Uint8Array(stride * height)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null

    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= channels ? prev[x - channels] : 0
      let value
      switch (filter) {
        case 0: value = line[x]; break
        case 1: value = line[x] + a; break
        case 2: value = line[x] + b; break
        case 3: value = line[x] + ((a + b) >> 1); break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          value = line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default: throw new Error(`bad PNG filter ${filter} on row ${y}`)
      }
      out[x] = value & 0xff
    }
  }

  const data = new Uint8Array(width * height * 4)
  let hasAlpha = false
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    data[i * 4] = pixels[j]
    data[i * 4 + 1] = pixels[j + 1]
    data[i * 4 + 2] = pixels[j + 2]
    data[i * 4 + 3] = channels === 4 ? pixels[j + 3] : 255
    if (data[i * 4 + 3] !== 255) hasAlpha = true
  }

  return { width, height, channels, hasAlpha, data }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, body) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, crc])
}

/**
 * @param {{width: number, height: number, data: Uint8Array}} image RGBA.
 * @param {{alpha?: boolean}} [options] Write an alpha channel; default false (opaque RGB).
 * @returns {Buffer} Deterministic for the same pixels, so regenerating an
 *   unchanged icon produces identical bytes.
 */
export function encodePng({ width, height, data }, { alpha = false } = {}) {
  const channels = alpha ? 4 : 3
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)

  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4
      const to = y * (stride + 1) + 1 + x * channels
      raw[to] = data[from]
      raw[to + 1] = data[from + 1]
      raw[to + 2] = data[from + 2]
      if (alpha) raw[to + 3] = data[from + 3]
    }
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = alpha ? 6 : 2
  header[10] = 0
  header[11] = 0
  header[12] = 0

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Width and height from a PNG's header, without decoding it. */
export function pngSize(file) {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG')
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) }
}
