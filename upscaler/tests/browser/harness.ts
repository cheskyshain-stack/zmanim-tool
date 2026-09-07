// Test harness page. Playwright loads it and calls window.__run(name). Everything runs
// in a real browser against the real WebGL backend, because the whole point is to check
// what the models and the streaming loop actually do rather than what they should do.
import { benchmark, initBackend, loadModel, upscaleBuffer, currentBackend } from '../../src/worker/engine'
import { runRender, rgbaToFloatRgb } from '../../src/worker/pipeline'
import { resampleImage, CHANNELS } from '../../src/lib/lanczos'
import type { RenderRequest, Tuning } from '../../src/worker/protocol'

const BASE = '/'
const log = (m: string) => {
  document.getElementById('log')!.textContent += '\n' + m
}

const TUNING: Tuning = {
  tile: 128,
  pad: 20,
  bandBudget: 64 << 20,
  cacheBudget: 8_000_000,
  deflateLevel: 4,
  pngFilter: 'up',
}

async function loadPhoto(url: string, width: number, height: number) {
  const blob = await (await fetch(url)).blob()
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

function psnr(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  const mse = sum / a.length
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse)
}


/** Catmull-Rom bicubic, separable, used only to build the test's degraded input. */
function bicubicResize(
  src: Float32Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Float32Array {
  const kernel = (t: number) => {
    const x = Math.abs(t)
    const a = -0.5
    if (x <= 1) return (a + 2) * x * x * x - (a + 3) * x * x + 1
    if (x < 2) return a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a
    return 0
  }
  const axis = (length: number, out: number) => {
    const scale = out / length
    const support = scale < 1 ? 2 / scale : 2
    return Array.from({ length: out }, (_, i) => {
      const centre = (i + 0.5) / scale - 0.5
      const first = Math.max(0, Math.ceil(centre - support))
      const last = Math.min(length - 1, Math.floor(centre + support))
      const taps: Array<[number, number]> = []
      let sum = 0
      for (let j = first; j <= last; j++) {
        const w = kernel(scale < 1 ? (j - centre) * scale : j - centre)
        taps.push([j, w])
        sum += w
      }
      return taps.map(([j, w]) => [j, w / sum] as [number, number])
    })
  }
  const xt = axis(srcWidth, dstWidth)
  const yt = axis(srcHeight, dstHeight)
  const wide = new Float32Array(dstWidth * srcHeight * CHANNELS)
  for (let y = 0; y < srcHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      for (let c = 0; c < CHANNELS; c++) {
        let v = 0
        for (const [j, w] of xt[x]) v += src[(y * srcWidth + j) * CHANNELS + c] * w
        wide[(y * dstWidth + x) * CHANNELS + c] = v
      }
    }
  }
  const out = new Float32Array(dstWidth * dstHeight * CHANNELS)
  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      for (let c = 0; c < CHANNELS; c++) {
        let v = 0
        for (const [j, w] of yt[y]) v += wide[(j * dstWidth + x) * CHANNELS + c] * w
        out[(y * dstWidth + x) * CHANNELS + c] = v
      }
    }
  }
  return out
}

function clampBuffer(buf: Float32Array): Float32Array {
  const out = new Float32Array(buf.length)
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]
    out[i] = v <= 0 ? 0 : v >= 255 ? 255 : v
  }
  return out
}

/** Drops `border` pixels from every edge, so edge handling does not colour the score. */
function inner(buf: Float32Array, width: number, height: number, border: number) {
  const w = width - border * 2
  const h = height - border * 2
  const out = new Float32Array(w * h * CHANNELS)
  for (let y = 0; y < h; y++) {
    const from = ((y + border) * width + border) * CHANNELS
    out.set(buf.subarray(from, from + w * CHANNELS), y * w * CHANNELS)
  }
  return out
}

/**
 * Does the network actually reconstruct detail a resize cannot?
 *
 * Shrink a real photograph by 4, then try to get back to the original two ways. The
 * network has the original to be scored against, so this is a measurement rather than
 * an opinion about which looks nicer.
 */
async function testSuperResolution() {
  await initBackend()
  const truthSize = 512
  const small = truthSize / 4
  const image = await loadPhoto('/tests/tmp/photo.jpg', truthSize, truthSize)
  const truth = rgbaToFloatRgb(image.data, truthSize, truthSize)

  // Degrade with bicubic, not Lanczos. These models were trained on DIV2K downsampled
  // bicubically, so scoring them against a Lanczos degradation would be marking them on
  // a paper they never sat.
  const shrunk = bicubicResize(truth, truthSize, truthSize, small, small)
  const lanczos = clampBuffer(resampleImage(shrunk, small, small, truthSize, truthSize))

  const model = await loadModel(BASE, 'esrgan-medium', 4)
  const ai = clampBuffer(
    await upscaleBuffer(model, 4, shrunk, small, small, { tile: 128, pad: 20 }),
  )

  const b = 8
  const size = truthSize - b * 2
  const t = inner(truth, truthSize, truthSize, b)
  const l = inner(lanczos, truthSize, truthSize, b)
  const a = inner(ai, truthSize, truthSize, b)

  // Peak signal to noise ratio is the wrong yardstick for super resolution and is worth
  // saying plainly, because the numbers look like a tie and are not one. A network that
  // reconstructs a brick edge half a pixel from where it really was is punished by mean
  // squared error exactly as hard as one that left the edge blurred, so a real
  // reconstruction typically scores level with a good resize while looking far better.
  // What separates them is how much edge energy comes back, so measure that.
  return {
    backend: currentBackend(),
    lanczosPsnr: psnr(t, l),
    aiPsnr: psnr(t, a),
    identical: psnr(l, a),
    truthGradient: gradientEnergy(t, size, size),
    lanczosGradient: gradientEnergy(l, size, size),
    aiGradient: gradientEnergy(a, size, size),
  }
}

/** Tiling must not change the answer. */
async function testTileInvariance() {
  await initBackend()
  const size = 160
  const image = await loadPhoto('/tests/tmp/photo.jpg', size, size)
  const src = rgbaToFloatRgb(image.data, size, size)
  const model = await loadModel(BASE, 'esrgan-medium', 2)

  const whole = await upscaleBuffer(model, 2, src, size, size, { tile: 1024, pad: 20 })
  const tiled = await upscaleBuffer(model, 2, src, size, size, { tile: 48, pad: 20 })

  let max = 0
  for (let i = 0; i < whole.length; i++) max = Math.max(max, Math.abs(whole[i] - tiled[i]))
  return { maxDiff: max, psnr: psnr(whole, tiled) }
}

function makeRequest(over: Partial<RenderRequest>): RenderRequest {
  return {
    type: 'render',
    id: 1,
    baseUrl: BASE,
    pixels: new ArrayBuffer(0),
    cropWidth: 0,
    cropHeight: 0,
    targetWidth: 0,
    targetHeight: 0,
    content: { x: 0, y: 0, width: 0, height: 0 },
    borderColor: [255, 255, 255],
    dpi: 300,
    passes: [],
    sharpen: 'light',
    denoise: 0,
    deblock: false,
    format: 'png',
    jpegQuality: 95,
    tuning: TUNING,
    ...over,
  } as RenderRequest
}

async function decode(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  return {
    width: bitmap.width,
    height: bitmap.height,
    data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data,
  }
}

/**
 * The load bearing test. The banded pipeline must produce exactly what a single band
 * would, or every export has faint horizontal lines across it at band boundaries.
 */
async function testBandInvariance() {
  await initBackend()
  const w = 96
  const h = 72
  const image = await loadPhoto('/tests/tmp/photo.jpg', w, h)

  const targetWidth = 300
  const targetHeight = 225
  const base = {
    cropWidth: w,
    cropHeight: h,
    targetWidth,
    targetHeight,
    content: { x: 0, y: 0, width: targetWidth, height: targetHeight },
    passes: [
      { family: 'esrgan-medium' as const, scale: 2 as const },
      { family: 'esrgan-medium' as const, scale: 2 as const },
    ],
    sharpen: 'medium' as const,
  }
  const noop = { onPhase: () => {}, shouldCancel: () => false }

  const single = await runRender(
    makeRequest({
      ...base,
      pixels: image.data.slice().buffer,
      tuning: { ...TUNING, bandBudget: 1 << 30, cacheBudget: 1 },
    }),
    noop,
  )
  const many = await runRender(
    makeRequest({
      ...base,
      pixels: image.data.slice().buffer,
      // A tiny budget forces the minimum band of 8 rows, so ~29 bands and 28 seams.
      tuning: { ...TUNING, bandBudget: 1, cacheBudget: 1 },
    }),
    noop,
  )
  const cachedPrefix = await runRender(
    makeRequest({
      ...base,
      pixels: image.data.slice().buffer,
      // Large cache budget: the first pass runs whole and only the second streams.
      tuning: { ...TUNING, bandBudget: 1, cacheBudget: 8_000_000 },
    }),
    noop,
  )

  const a = await decode(single.blob)
  const b = await decode(many.blob)
  const c = await decode(cachedPrefix.blob)

  // Two different questions, and they need different answers.
  //
  // Band count must change nothing at all: any difference there is a seam, and a seam
  // is a visible line across a printed banner.
  //
  // The cached path is allowed to differ slightly, because it stores the intermediate
  // between passes as bytes rather than floats to keep a phone inside its memory. What
  // must not happen is that difference collecting at band boundaries, so measure how
  // the difference is spread across rows as well as how big it gets.
  const rowMeans: number[] = []
  let maxManyBands = 0
  let maxCached = 0
  let sumCached = 0
  for (let y = 0; y < a.height; y++) {
    let rowSum = 0
    for (let x = 0; x < a.width * 4; x++) {
      const i = y * a.width * 4 + x
      maxManyBands = Math.max(maxManyBands, Math.abs(a.data[i] - b.data[i]))
      const cachedDiff = Math.abs(a.data[i] - c.data[i])
      maxCached = Math.max(maxCached, cachedDiff)
      rowSum += cachedDiff
    }
    rowMeans.push(rowSum / (a.width * 4))
    sumCached += rowSum
  }
  const meanCached = sumCached / (a.width * a.height * 4)
  return {
    size: [a.width, a.height],
    maxManyBands,
    maxCached,
    meanCached,
    worstRowMean: Math.max(...rowMeans),
    bytes: [single.blob.size, many.blob.size, cachedPrefix.blob.size],
  }
}

/** A genuinely large export, streamed, in all three formats. */
async function testLargeExport(format: 'png' | 'tiff' | 'jpeg') {
  await initBackend()
  const w = 512
  const h = 192
  const image = await loadPhoto('/tests/tmp/photo.jpg', w, h)
  const targetWidth = 8192
  const targetHeight = 3072
  const started = performance.now()
  const result = await runRender(
    makeRequest({
      pixels: image.data.slice().buffer,
      cropWidth: w,
      cropHeight: h,
      targetWidth,
      targetHeight,
      content: { x: 0, y: 0, width: targetWidth, height: targetHeight },
      format,
      passes: [
        { family: 'esrgan-slim', scale: 4 },
        { family: 'esrgan-slim', scale: 4 },
      ],
      tuning: { ...TUNING, bandBudget: 24 << 20, cacheBudget: 4_500_000 },
    }),
    { onPhase: () => {}, shouldCancel: () => false },
  )
  return {
    format,
    bytes: result.blob.size,
    megapixels: (targetWidth * targetHeight) / 1e6,
    seconds: (performance.now() - started) / 1000,
    type: result.blob.type,
  }
}

/** Letterbox path: borders must be exactly the requested colour and the right size. */
async function testBorders() {
  await initBackend()
  const w = 64
  const h = 64
  const image = await loadPhoto('/tests/tmp/photo.jpg', w, h)
  const targetWidth = 400
  const targetHeight = 200
  const content = { x: 100, y: 0, width: 200, height: 200 }
  const result = await runRender(
    makeRequest({
      pixels: image.data.slice().buffer,
      cropWidth: w,
      cropHeight: h,
      targetWidth,
      targetHeight,
      content,
      borderColor: [12, 34, 56],
      passes: [{ family: 'esrgan-slim', scale: 4 }],
      sharpen: 'none',
    }),
    { onPhase: () => {}, shouldCancel: () => false },
  )
  const out = await decode(result.blob)
  const at = (x: number, y: number) => {
    const p = (y * out.width + x) * 4
    return [out.data[p], out.data[p + 1], out.data[p + 2]]
  }
  return {
    size: [out.width, out.height],
    topLeft: at(0, 0),
    leftEdge: at(99, 100),
    firstContent: at(100, 100),
    rightEdge: at(300, 100),
    bottomRight: at(399, 199),
  }
}


/**
 * Checks our inference against the model author's own published output for their own
 * fixture image. If this matches, the model is being fed and read correctly; any
 * remaining argument about quality is about the model, not about this code.
 */
async function testReferenceOutput() {
  await initBackend()
  const fixture = await loadPhoto('/tests/tmp/fixture.png', 128, 128)
  const src = rgbaToFloatRgb(fixture.data, 128, 128)
  const out: Record<string, unknown> = { backend: currentBackend() }

  for (const scale of [2, 4] as const) {
    const model = await loadModel(BASE, 'esrgan-medium', scale)
    const ai = await upscaleBuffer(model, scale, src, 128, 128, { tile: 256, pad: 20 })
    const expectedImage = await loadPhoto(
      `/tests/tmp/expected-${scale}x.png`,
      128 * scale,
      128 * scale,
    )
    const expected = rgbaToFloatRgb(expectedImage.data, 128 * scale, 128 * scale)
    const clamped = clampBuffer(ai)
    let max = 0
    for (let i = 0; i < expected.length; i++) {
      max = Math.max(max, Math.abs(clamped[i] - expected[i]))
    }
    out[`x${scale}Psnr`] = psnr(expected, clamped)
    out[`x${scale}MaxDiff`] = max
  }
  return out
}


/**
 * Measures what this machine actually sustains, so the README can quote a number rather
 * than an adjective. Reported in output pixels per second, which is the unit the
 * planner's aiPixels counts in, so the two multiply straight into a time.
 */
async function testThroughput() {
  await initBackend()
  const out: Record<string, unknown> = { backend: currentBackend() }
  for (const family of ['esrgan-slim', 'esrgan-medium'] as const) {
    for (const scale of [2, 4] as const) {
      const model = await loadModel(BASE, family, scale)
      const rate = await benchmark(model, scale, 96)
      out[`${family}-x${scale}`] = Math.round(rate)
    }
  }
  return out
}

const TESTS: Record<string, () => Promise<unknown>> = {
  superResolution: testSuperResolution,
  referenceOutput: testReferenceOutput,
  throughput: testThroughput,
  tileInvariance: testTileInvariance,
  bandInvariance: testBandInvariance,
  borders: testBorders,
  largePng: () => testLargeExport('png'),
  largeTiff: () => testLargeExport('tiff'),
  largeJpeg: () => testLargeExport('jpeg'),
}

;(window as unknown as Record<string, unknown>).__run = async (name: string) => {
  log(`running ${name}`)
  const result = await TESTS[name]()
  log(`${name}: ${JSON.stringify(result)}`)
  return result
}

async function toPng(buf: Float32Array, width: number, height: number): Promise<string> {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0, p = 0, q = 0; i < width * height; i++, p += 4, q += CHANNELS) {
    rgba[p] = buf[q]; rgba[p + 1] = buf[q + 1]; rgba[p + 2] = buf[q + 2]; rgba[p + 3] = 255
  }
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function gradientEnergy(buf: Float32Array, width: number, height: number): number {
  let sum = 0
  for (let y = 1; y < height; y++) {
    for (let x = 1; x < width; x++) {
      for (let c = 0; c < CHANNELS; c++) {
        const p = (y * width + x) * CHANNELS + c
        const dx = buf[p] - buf[p - CHANNELS]
        const dy = buf[p] - buf[p - width * CHANNELS]
        sum += dx * dx + dy * dy
      }
    }
  }
  return Math.sqrt(sum / (width * height * CHANNELS))
}

function mean(buf: Float32Array): number {
  let s = 0
  for (let i = 0; i < buf.length; i++) s += buf[i]
  return s / buf.length
}

;(window as unknown as Record<string, unknown>).__diag = async () => {
  await initBackend()
  const T = 512, S = 128
  const image = await loadPhoto('/tests/tmp/photo.jpg', T, T)
  const truth = rgbaToFloatRgb(image.data, T, T)
  const shrunk = bicubicResize(truth, T, T, S, S)
  const lanczos = clampBuffer(resampleImage(shrunk, S, S, T, T))
  const model = await loadModel(BASE, 'esrgan-medium', 4)
  const ai = clampBuffer(await upscaleBuffer(model, 4, shrunk, S, S, { tile: 256, pad: 20 }))
  const crop = (b: Float32Array) => inner(b, T, T, 160)
  return {
    stats: {
      meanTruth: mean(truth), meanLanczos: mean(lanczos), meanAi: mean(ai),
      gradTruth: gradientEnergy(truth, T, T),
      gradLanczos: gradientEnergy(lanczos, T, T),
      gradAi: gradientEnergy(ai, T, T),
      psnrLanczos: psnr(truth, lanczos), psnrAi: psnr(truth, ai),
    },
    images: {
      truth: await toPng(crop(truth), 192, 192),
      lanczos: await toPng(crop(lanczos), 192, 192),
      ai: await toPng(crop(ai), 192, 192),
      shrunk: await toPng(shrunk, S, S),
    },
  }
}

;(window as unknown as Record<string, unknown>).__ready = true
