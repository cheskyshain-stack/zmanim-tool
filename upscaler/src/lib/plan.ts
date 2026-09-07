// Chooses how many AI passes to run and at what scale. This is the brain behind the
// "Maximum Print Quality" button, and the manual controls go through it too so the two
// can never disagree.
//
// The rule: reach or just exceed the enlargement the print needs, never wildly exceed
// it, and let the final Lanczos step land on the exact pixel count. Overshooting a
// little and resizing back down is deliberate. Coming down from 32,768 to 28,800 packs
// slightly more than one upscaled pixel into every printed pixel, which reads as crisp.
// Coming up to 28,800 from below would be the AI's guesses stretched further by a
// resize, which reads as soft.

import type { FamilyId, Mode, ModelScale } from './models'

export interface Pass {
  family: FamilyId
  scale: ModelScale
}

export interface UpscalePlan {
  passes: Pass[]
  /** Product of the pass scales. 1 when no AI pass is needed. */
  factor: number
  /** Enlargement the print actually asked for. */
  required: number
  /** Pixels the AI has to generate in total, which is what the time estimate uses. */
  aiPixels: number
  /** Final Lanczos step, as a multiplier. Below 1 means a slight downscale. */
  finalResize: number
  intermediateWidth: number
  intermediateHeight: number
  notes: string[]
}

export const MAX_PASSES = 4

/**
 * Every chain of allowed scales up to MAX_PASSES long, cheapest first. Small enough to
 * enumerate outright: four passes over three scales is 120 chains.
 */
function chains(scales: ModelScale[]): Pass[][] {
  const out: ModelScale[][] = [[]]
  let frontier: ModelScale[][] = [[]]
  for (let depth = 0; depth < MAX_PASSES; depth++) {
    const next: ModelScale[][] = []
    for (const chain of frontier) {
      for (const scale of scales) {
        const extended = [...chain, scale]
        next.push(extended)
        out.push(extended)
      }
    }
    frontier = next
  }
  return out.map((c) => c.map((scale) => ({ scale }) as Pass))
}

export interface PlanInput {
  cropWidth: number
  cropHeight: number
  targetWidth: number
  targetHeight: number
  mode: Mode
  /** Cap on AI work, used to keep a phone from accepting a job it cannot finish. */
  maxAiPixels?: number
}

export function planUpscale(input: PlanInput): UpscalePlan {
  const { cropWidth, cropHeight, targetWidth, targetHeight, mode } = input
  const required = Math.max(targetWidth / cropWidth, targetHeight / cropHeight)
  const notes: string[] = []

  const build = (passes: Pass[]): UpscalePlan => {
    const factor = passes.reduce((n, p) => n * p.scale, 1)
    let width = cropWidth
    let height = cropHeight
    let aiPixels = 0
    for (const pass of passes) {
      width *= pass.scale
      height *= pass.scale
      aiPixels += width * height
    }
    return {
      passes,
      factor,
      required,
      aiPixels,
      finalResize: targetWidth / width,
      intermediateWidth: width,
      intermediateHeight: height,
      notes,
    }
  }

  if (required <= 1) {
    notes.push(
      'The image already has more pixels than this print needs, so no AI upscaling ' +
        'runs. It is resized down with Lanczos, which keeps every bit of detail it has.',
    )
    return build([])
  }

  const candidates = chains(mode.preferredScales)
    .map((passes) => ({
      passes: passes.map((p) => ({ ...p, family: mode.family })),
      factor: passes.reduce((n, p) => n * p.scale, 1),
    }))
    .filter((c) => c.factor >= required - 1e-9)

  if (candidates.length === 0) {
    // Nothing in reach: take the largest chain available and say so plainly rather than
    // pretending the result will hit the target sharpness.
    const largest = chains(mode.preferredScales).reduce((best, passes) => {
      const factor = passes.reduce((n, p) => n * p.scale, 1)
      const bestFactor = best.reduce((n, p) => n * p.scale, 1)
      return factor > bestFactor ? passes : best
    })
    const plan = build(largest.map((p) => ({ ...p, family: mode.family })))
    notes.push(
      `This print needs ${required.toFixed(1)}x enlargement, which is more than ` +
        `${MAX_PASSES} AI passes can reach (${plan.factor}x). The rest is done with ` +
        'Lanczos, so the result will be softer than the DPI suggests. Consider a lower ' +
        'DPI, which for a banner this size is usually invisible from viewing distance.',
    )
    return plan
  }

  const rank = new Map(mode.preferredScales.map((s, i) => [s, i]))
  candidates.sort((a, b) => {
    // Smallest sufficient enlargement first: that is the "avoid unnecessary
    // enlargement" rule, and it is also the fastest option that still hits the target.
    if (a.factor !== b.factor) return a.factor - b.factor
    const prefA = a.passes.reduce((n, p) => n + (rank.get(p.scale) ?? 9), 0)
    const prefB = b.passes.reduce((n, p) => n + (rank.get(p.scale) ?? 9), 0)
    if (prefA !== prefB) return prefA - prefB
    return a.passes.length - b.passes.length
  })

  let chosen = candidates[0]
  const budget = input.maxAiPixels
  if (budget) {
    const affordable = candidates.find((c) => build(c.passes).aiPixels <= budget)
    if (affordable && affordable !== chosen) {
      chosen = affordable
      notes.push('Pass count reduced to stay inside this device’s memory budget.')
    }
  }

  const plan = build(chosen.passes)
  if (plan.finalResize < 1) {
    notes.push(
      `Upscaled to ${plan.intermediateWidth.toLocaleString()} x ` +
        `${plan.intermediateHeight.toLocaleString()}, then resized down to the exact ` +
        'print size. The slight downscale is what makes it look sharp up close.',
    )
  } else if (plan.finalResize > 1.001) {
    notes.push(
      `The AI reaches ${plan.factor}x and Lanczos covers the last ` +
        `${plan.finalResize.toFixed(2)}x.`,
    )
  }
  return plan
}

export function describePasses(plan: UpscalePlan): string {
  if (plan.passes.length === 0) return 'No AI pass needed'
  return plan.passes.map((p) => `${p.scale}x`).join(' then ')
}
