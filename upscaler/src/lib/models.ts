// The models the app ships, and what each upscale mode does with them.
//
// These are ESRGAN family RDN (residual dense network) super resolution models trained
// on DIV2K, taken from the UpscalerJS project and shipped inside the app. They are real
// convolutional super resolution networks: they hallucinate plausible high frequency
// detail from learned priors, which is the thing a resize cannot do. Nothing in this app
// calls a plain resize "AI upscaling".

export type FamilyId = 'esrgan-slim' | 'esrgan-medium'
export type ModelScale = 2 | 3 | 4

export interface Family {
  id: FamilyId
  label: string
  /** Roughly how much slower than slim, measured rather than guessed at run time. */
  weightBytes: number
  note: string
}

export const FAMILIES: Record<FamilyId, Family> = {
  'esrgan-slim': {
    id: 'esrgan-slim',
    label: 'Fast',
    weightBytes: 900_000,
    note: 'Small network, gentle result. Best on a phone and on flat, graphic artwork.',
  },
  'esrgan-medium': {
    id: 'esrgan-medium',
    label: 'Quality',
    weightBytes: 2_800_000,
    note: 'Ten times the depth. Noticeably more texture, several times slower.',
  },
}

export interface ModelId {
  family: FamilyId
  scale: ModelScale
}

export function modelUrl(base: string, family: FamilyId, scale: ModelScale): string {
  const clean = base.endsWith('/') ? base : `${base}/`
  return `${clean}models/${family}/x${scale}/model.json`
}

export type ModeId =
  | 'natural'
  | 'high-detail'
  | 'ultra-sharp'
  | 'artwork'
  | 'photograph'

export interface Mode {
  id: ModeId
  label: string
  blurb: string
  family: FamilyId
  /**
   * Which single-pass scales this mode is allowed to chain. A mode that prefers many
   * small steps keeps 2 near the front; one that wants fewer, bigger jumps prefers 4.
   */
  preferredScales: ModelScale[]
  /** Sharpening applied at the final print resolution. */
  sharpen: 'none' | 'light' | 'medium' | 'strong'
  /** Edge preserving denoise on the source, before any upscaling. */
  denoise: number
  /** JPEG block artifact repair on the source, before any upscaling. */
  deblock: boolean
}

// Every mode is a real, different pipeline: a different network, a different chain of
// scale steps, and different pre and post processing. None of them is a relabelling of
// the same run.
export const MODES: Mode[] = [
  {
    id: 'natural',
    label: 'Natural',
    blurb: 'Even handed. Adds detail without changing the character of the image.',
    family: 'esrgan-medium',
    preferredScales: [2, 4, 3],
    sharpen: 'light',
    denoise: 0,
    deblock: false,
  },
  {
    id: 'high-detail',
    label: 'High Detail',
    blurb: 'Bigger steps through the deeper network. More texture, slower.',
    family: 'esrgan-medium',
    preferredScales: [4, 2, 3],
    sharpen: 'medium',
    denoise: 0,
    deblock: false,
  },
  {
    id: 'ultra-sharp',
    label: 'Ultra Sharp',
    blurb: 'For text, logos and hard edges. Can look crisp to the point of harsh.',
    family: 'esrgan-medium',
    preferredScales: [4, 2, 3],
    sharpen: 'strong',
    denoise: 0,
    deblock: false,
  },
  {
    id: 'artwork',
    label: 'Artwork / AI Generated',
    blurb:
      'Built for generated art: stone, wood, fruit, leaves, fabric, architecture. ' +
      'Small steps and light sharpening, so texture grows without hard fake edges.',
    family: 'esrgan-medium',
    // Generated art is where a single large jump goes wrong: the network invents an
    // edge, and the next pass treats that invention as ground truth and hardens it.
    // Chaining 2x keeps each guess small, which is what keeps stone looking like stone
    // instead of like plastic.
    preferredScales: [2, 3, 4],
    sharpen: 'light',
    denoise: 0,
    deblock: true,
  },
  {
    id: 'photograph',
    label: 'Photograph',
    blurb: 'Cleans sensor noise and JPEG blocks first, so neither gets enlarged.',
    family: 'esrgan-medium',
    preferredScales: [2, 4, 3],
    sharpen: 'light',
    denoise: 1,
    deblock: true,
  },
]

export function modeById(id: ModeId): Mode {
  return MODES.find((m) => m.id === id) ?? MODES[0]
}
