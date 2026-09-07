// CRC-32 (the PNG/zip polynomial), as a running value so a chunk can be checksummed
// while it is being produced rather than held whole.

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array, seed = 0xffffffff): number {
  let c = seed
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return c >>> 0
}

export function crc32Final(running: number): number {
  return (running ^ 0xffffffff) >>> 0
}
