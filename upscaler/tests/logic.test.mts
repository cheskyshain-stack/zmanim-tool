// Fast checks for the pure maths: print sizes, crops, pass planning, the resampler and
// the sharpener. No browser and no models, so this runs in under a second and is the
// first thing to run after a change.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  constrainCrop,
  containBox,
  coverCrop,
  borderFraction,
  croppedFraction,
  ratioLabel,
  ratiosMatch,
  snapRect,
} from '../src/lib/aspect'
import {
  assessSource,
  dpiTable,
  orientPreset,
  PRESETS,
  resolveTarget,
} from '../src/lib/print'
import { planUpscale } from '../src/lib/plan'
import { modeById } from '../src/lib/models'
import { buildTaps, resampleImage, sourceSpan, CHANNELS } from '../src/lib/lanczos'
import { sharpenInPlace, sharpenMargin } from '../src/lib/enhance'

const BANNER = PRESETS.find((p) => p.id === '36x96')!

test('the 3ft x 8ft preset produces exactly the advertised pixel counts', () => {
  const { widthIn, heightIn } = orientPreset(BANNER, 'landscape')
  assert.equal(widthIn, 96)
  assert.equal(heightIn, 36)
  assert.deepEqual(
    dpiTable(widthIn, heightIn).map((r) => [r.dpi, r.pxWidth, r.pxHeight]),
    [
      [100, 9600, 3600],
      [150, 14400, 5400],
      [200, 19200, 7200],
      [250, 24000, 9000],
      [300, 28800, 10800],
    ],
  )
})

test('portrait swaps the pair rather than inventing a new size', () => {
  assert.deepEqual(orientPreset(BANNER, 'portrait'), { widthIn: 36, heightIn: 96 })
})

test('a 2048 x 768 source needs 14.06x for the flagship print', () => {
  const target = resolveTarget({ width: 96, height: 36, unit: 'in', dpi: 300 })
  assert.equal(target.pxWidth, 28800)
  assert.equal(target.pxHeight, 10800)
  const assessment = assessSource(2048, 768, target)
  assert.equal(assessment.enlargement.toFixed(2), '14.06')
  assert.equal(assessment.grade, 'low')
  assert.equal(assessment.alreadyEnough, false)
})

test('feet convert to inches', () => {
  const target = resolveTarget({ width: 8, height: 3, unit: 'ft', dpi: 300 })
  assert.equal(target.pxWidth, 28800)
  assert.equal(target.pxHeight, 10800)
})

test('an image with more pixels than the print needs runs no AI pass', () => {
  const target = resolveTarget({ width: 6, height: 4, unit: 'in', dpi: 150 })
  const assessment = assessSource(4000, 3000, target)
  assert.equal(assessment.alreadyEnough, true)
  const plan = planUpscale({
    cropWidth: 4000,
    cropHeight: 3000,
    targetWidth: target.pxWidth,
    targetHeight: target.pxHeight,
    mode: modeById('natural'),
  })
  assert.equal(plan.passes.length, 0)
  assert.equal(plan.factor, 1)
})

test('the planner reaches 14.06x with 16x and then resizes back down', () => {
  for (const modeId of ['natural', 'high-detail', 'artwork'] as const) {
    const plan = planUpscale({
      cropWidth: 2048,
      cropHeight: 768,
      targetWidth: 28800,
      targetHeight: 10800,
      mode: modeById(modeId),
    })
    assert.equal(plan.factor, 16, modeId)
    assert.equal(plan.intermediateWidth, 32768, modeId)
    assert.equal(plan.intermediateHeight, 12288, modeId)
    // Overshoot then come back down. This is the whole trick, so assert it explicitly.
    assert.ok(plan.finalResize < 1 && plan.finalResize > 0.87, modeId)
    assert.ok(plan.passes.length >= 2 && plan.passes.length <= 4, modeId)
    assert.equal(
      plan.passes.reduce((n, p) => n * p.scale, 1),
      16,
      modeId,
    )
  }
})

test('modes differ in how they get to the same factor', () => {
  const input = {
    cropWidth: 2048,
    cropHeight: 768,
    targetWidth: 28800,
    targetHeight: 10800,
  }
  // Artwork prefers many small steps, so one guess never gets hardened by the next.
  const artwork = planUpscale({ ...input, mode: modeById('artwork') })
  assert.deepEqual(
    artwork.passes.map((p) => p.scale),
    [2, 2, 2, 2],
  )
  // High Detail prefers the fewest, biggest jumps.
  const detail = planUpscale({ ...input, mode: modeById('high-detail') })
  assert.deepEqual(
    detail.passes.map((p) => p.scale),
    [4, 4],
  )
})

test('the network is chosen separately from the mode', () => {
  const input = {
    cropWidth: 2048,
    cropHeight: 768,
    targetWidth: 28800,
    targetHeight: 10800,
    mode: modeById('artwork'),
  }
  assert.ok(planUpscale(input).passes.every((p) => p.family === 'esrgan-medium'))
  const fast = planUpscale({ ...input, family: 'esrgan-slim' })
  assert.ok(fast.passes.every((p) => p.family === 'esrgan-slim'))
  // Swapping the network must not change the plan's shape, only which weights run.
  assert.equal(fast.factor, 16)
  assert.deepEqual(
    fast.passes.map((p) => p.scale),
    [2, 2, 2, 2],
  )
})

test('the planner takes the smallest chain that is big enough', () => {
  // 4.69x: 6 is the smallest product of 2, 3 and 4 that reaches it, not 8.
  const plan = planUpscale({
    cropWidth: 256,
    cropHeight: 96,
    targetWidth: 1200,
    targetHeight: 450,
    mode: modeById('natural'),
  })
  assert.equal(plan.factor, 6)
})

test('a forced factor overrides the planner and says what it cost', () => {
  const plan = planUpscale({
    cropWidth: 256,
    cropHeight: 96,
    targetWidth: 1200,
    targetHeight: 450,
    mode: modeById('natural'),
    forceFactor: 16,
  })
  assert.equal(plan.factor, 16)
  assert.ok(plan.notes.some((n) => n.includes('more work than the print needs')))
})

test('an enlargement beyond reach is reported rather than hidden', () => {
  const plan = planUpscale({
    cropWidth: 100,
    cropHeight: 100,
    targetWidth: 100_000,
    targetHeight: 100_000,
    mode: modeById('natural'),
  })
  assert.ok(plan.factor < 1000)
  assert.ok(plan.notes.some((n) => n.includes('more than')))
})

test('ratios read the way a person would say them', () => {
  assert.equal(ratioLabel(2048, 768), '8 : 3')
  assert.equal(ratioLabel(28800, 10800), '8 : 3')
  assert.equal(ratioLabel(4000, 3000), '4 : 3')
  // Nothing useful reduces here, so it falls back to a decimal.
  assert.match(ratioLabel(1349, 500), /^2\.698 : 1$/)
})

test('matching ratios are not reported as needing a crop', () => {
  assert.ok(ratiosMatch(2048, 768, 28800, 10800))
  assert.ok(!ratiosMatch(4000, 3000, 28800, 10800))
})

test('cover crop keeps the print ratio and stays inside the image', () => {
  const crop = coverCrop(4000, 3000, 28800, 10800)
  assert.ok(Math.abs(crop.width / crop.height - 28800 / 10800) < 1e-9)
  assert.equal(crop.width, 4000)
  assert.ok(crop.height < 3000)
  assert.ok(crop.y > 0 && crop.y + crop.height <= 3000)
  assert.ok(croppedFraction(crop, 4000, 3000) > 0.4)
})

test('fit whole image adds border and crops nothing', () => {
  const box = containBox(4000, 3000, 28800, 10800)
  assert.ok(Math.abs(box.width / box.height - 4000 / 3000) < 1e-9)
  assert.ok(box.height === 10800 || box.width === 28800)
  assert.ok(borderFraction(4000, 3000, 28800, 10800) > 0.4)
})

test('a dragged crop is locked to the print ratio and cannot leave the image', () => {
  const wild = { x: -900, y: -900, width: 99999, height: 10 }
  const crop = snapRect(constrainCrop(wild, 4000, 3000, 28800, 10800), 4000, 3000)
  assert.ok(crop.x >= 0 && crop.y >= 0)
  assert.ok(crop.x + crop.width <= 4000)
  assert.ok(crop.y + crop.height <= 3000)
  // Within a pixel of the target ratio, which is as close as whole pixels allow.
  assert.ok(Math.abs(crop.width / crop.height - 28800 / 10800) < 0.01)
})

test('Lanczos weights sum to one on every output sample', () => {
  for (const [from, to] of [
    [100, 400],
    [400, 100],
    [32768, 28800],
    [7, 7],
  ]) {
    const taps = buildTaps(from, to)
    for (let i = 0; i < to; i++) {
      let sum = 0
      for (let j = 0; j < taps.counts[i]; j++) sum += taps.weights[i * taps.stride + j]
      assert.ok(Math.abs(sum - 1) < 1e-5, `${from}->${to} sample ${i} summed to ${sum}`)
    }
  }
})

test('resampling a flat image leaves it flat, including at the edges', () => {
  // This is what normalising the weights buys: without it the border darkens.
  const size = 16
  const flat = new Float32Array(size * size * CHANNELS).fill(200)
  for (const out of [7, 16, 64]) {
    const result = resampleImage(flat, size, size, out, out)
    for (let i = 0; i < result.length; i++) {
      assert.ok(Math.abs(result[i] - 200) < 1e-3, `at ${out}px, index ${i}`)
    }
  }
})

test('sourceSpan covers exactly the rows a band reads', () => {
  const taps = buildTaps(1000, 250)
  const span = sourceSpan(taps, 10, 20)
  for (let i = 10; i < 20; i++) {
    assert.ok(taps.starts[i] >= span.from)
    assert.ok(taps.starts[i] + taps.counts[i] <= span.to)
  }
  // And nothing wider than it needs: the row before the band starts earlier.
  assert.equal(span.from, taps.starts[10])
})

test('sharpening a hard edge does not produce a halo', () => {
  const width = 32
  const height = 8
  const make = () => {
    const buf = new Float32Array(width * height * CHANNELS)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = x < width / 2 ? 40 : 210
        const p = (y * width + x) * CHANNELS
        buf[p] = buf[p + 1] = buf[p + 2] = v
      }
    }
    return buf
  }
  for (const level of ['light', 'medium', 'strong'] as const) {
    const buf = make()
    sharpenInPlace(buf, width, height, level)
    for (let i = 0; i < buf.length; i++) {
      // The guard allows a small overshoot past the local range and no more. Without it
      // a strong unsharp mask on this edge would swing well past both sides.
      assert.ok(buf[i] >= 40 - 45, `${level}: dark side undershot to ${buf[i]}`)
      assert.ok(buf[i] <= 210 + 45, `${level}: light side overshot to ${buf[i]}`)
    }
  }
})

test('sharpen margin covers the blur it actually uses', () => {
  assert.equal(sharpenMargin('none'), 0)
  assert.ok(sharpenMargin('light') >= 4)
  assert.ok(sharpenMargin('strong') >= sharpenMargin('light'))
})
