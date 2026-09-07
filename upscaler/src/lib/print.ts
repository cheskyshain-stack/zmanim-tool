// Print size maths. Everything the calculator screen shows comes from here, and the
// planner and the pipeline read the same numbers, so a value on screen is never a
// separate calculation from the one that actually runs.

export type Unit = 'in' | 'ft'

export const DPI_CHOICES = [100, 150, 200, 250, 300] as const
export type Dpi = (typeof DPI_CHOICES)[number]

export function toInches(value: number, unit: Unit): number {
  return unit === 'ft' ? value * 12 : value
}

export interface PrintSize {
  /** As typed by the user, in `unit`. */
  width: number
  height: number
  unit: Unit
  dpi: number
}

export interface PrintTarget {
  widthIn: number
  heightIn: number
  dpi: number
  /** Pixels needed to hit `dpi` across the whole print. */
  pxWidth: number
  pxHeight: number
  megapixels: number
}

export function resolveTarget(size: PrintSize): PrintTarget {
  const widthIn = toInches(size.width, size.unit)
  const heightIn = toInches(size.height, size.unit)
  // Round rather than floor: 36in at 300dpi is exactly 10800, and floor() on a value
  // that lands at 10799.999999 because of binary floating point would quietly ship a
  // file one pixel short of the size printed on the summary screen.
  const pxWidth = Math.round(widthIn * size.dpi)
  const pxHeight = Math.round(heightIn * size.dpi)
  return {
    widthIn,
    heightIn,
    dpi: size.dpi,
    pxWidth,
    pxHeight,
    megapixels: (pxWidth * pxHeight) / 1e6,
  }
}

/** Every DPI choice for one print size, which is what the preset screen lists. */
export function dpiTable(widthIn: number, heightIn: number) {
  return DPI_CHOICES.map((dpi) => ({
    dpi,
    pxWidth: Math.round(widthIn * dpi),
    pxHeight: Math.round(heightIn * dpi),
  }))
}

export type Grade = 'low' | 'acceptable' | 'good' | 'excellent'

export const GRADE_LABEL: Record<Grade, string> = {
  low: 'Too low resolution',
  acceptable: 'Acceptable',
  good: 'Good',
  excellent: 'Excellent',
}

/**
 * Grades the pixels you actually have against the print you actually want.
 *
 * The bands are the large format trade's usual ones. Under 60 effective DPI a banner
 * looks soft even from across a room; 100 is the common floor for wide format work;
 * 150 holds up when somebody walks right up to it; 300 is photographic. The user's
 * stated goal is sharpness from close up, so the wording is deliberately not generous.
 */
export function gradeDpi(effectiveDpi: number): Grade {
  if (effectiveDpi >= 150) return 'excellent'
  if (effectiveDpi >= 100) return 'good'
  if (effectiveDpi >= 60) return 'acceptable'
  return 'low'
}

export interface SourceAssessment {
  /** DPI the source would print at if stretched over the print with no upscaling. */
  effectiveDpi: number
  grade: Grade
  /** Linear enlargement needed to reach the target pixel count. */
  enlargement: number
  /** True when the source already has at least the pixels the target asks for. */
  alreadyEnough: boolean
}

export function assessSource(
  srcWidth: number,
  srcHeight: number,
  target: PrintTarget,
): SourceAssessment {
  // Use the tighter of the two axes. A source that covers the width but not the height
  // is limited by the height, and reporting the looser axis would flatter the image.
  const effectiveDpi = Math.min(
    srcWidth / target.widthIn,
    srcHeight / target.heightIn,
  )
  const enlargement = Math.max(
    target.pxWidth / srcWidth,
    target.pxHeight / srcHeight,
  )
  return {
    effectiveDpi,
    grade: gradeDpi(effectiveDpi),
    enlargement,
    alreadyEnough: enlargement <= 1,
  }
}

export interface Preset {
  id: string
  label: string
  widthIn: number
  heightIn: number
  /** Shown with a star on the picker. */
  featured?: boolean
  note?: string
}

export const PRESETS: Preset[] = [
  { id: '18x36', label: '18" x 36"', widthIn: 18, heightIn: 36 },
  { id: '24x48', label: '24" x 48"', widthIn: 24, heightIn: 48 },
  { id: '24x72', label: '24" x 72"', widthIn: 24, heightIn: 72 },
  { id: '24x96', label: '24" x 96"', widthIn: 24, heightIn: 96 },
  { id: '36x48', label: '36" x 48"', widthIn: 36, heightIn: 48 },
  { id: '36x72', label: '36" x 72"', widthIn: 36, heightIn: 72 },
  {
    id: '36x96',
    label: '36" x 96"',
    widthIn: 36,
    heightIn: 96,
    featured: true,
    note: '3 ft x 8 ft banner',
  },
]

/**
 * Presets are listed portrait (18 x 36 reads "eighteen by thirty six"), but a banner is
 * hung landscape. This returns the pair the right way round for the orientation asked
 * for, so 36 x 96 becomes 96 wide by 36 high on a landscape print.
 */
export function orientPreset(
  preset: Preset,
  orientation: 'landscape' | 'portrait',
): { widthIn: number; heightIn: number } {
  const long = Math.max(preset.widthIn, preset.heightIn)
  const short = Math.min(preset.widthIn, preset.heightIn)
  return orientation === 'landscape'
    ? { widthIn: long, heightIn: short }
    : { widthIn: short, heightIn: long }
}
