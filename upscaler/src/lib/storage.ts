// Everything the user chose, kept on the device.
//
// One localStorage key holds the lot. There is no account and no server: the images
// never leave the phone, so there is nothing to sync and nothing to sign in to.

import type { FitMode } from './aspect'
import type { SharpenLevel } from './enhance'
import type { FamilyId, ModeId } from './models'
import type { Unit } from './print'
import type { ExportFormat } from '../worker/protocol'

const KEY = 'print-upscaler-settings-v1'

export interface Settings {
  presetId: string | null
  orientation: 'landscape' | 'portrait'
  width: number
  height: number
  unit: Unit
  dpi: number
  fit: FitMode
  borderColor: string
  modeId: ModeId
  /** Which network. Chosen separately from the mode: speed against detail. */
  family: FamilyId
  /** Null lets the planner choose. A number forces that total enlargement. */
  forceFactor: number | null
  sharpen: SharpenLevel
  denoise: boolean
  deblock: boolean
  format: ExportFormat
  jpegQuality: number
  theme: 'system' | 'light' | 'dark'
  /** Null means "work it out from the device", which is what almost everyone wants. */
  tileOverride: number | null
  memoryBudgetMb: number | null
}

// The flagship job, ready to go on first launch: 3 ft x 8 ft landscape at 300 DPI.
export const DEFAULTS: Settings = {
  presetId: '36x96',
  orientation: 'landscape',
  width: 96,
  height: 36,
  unit: 'in',
  dpi: 300,
  fit: 'cover',
  borderColor: '#ffffff',
  modeId: 'artwork',
  family: 'esrgan-medium',
  forceFactor: null,
  sharpen: 'light',
  denoise: false,
  deblock: false,
  format: 'png',
  jpegQuality: 95,
  theme: 'system',
  tileOverride: null,
  memoryBudgetMb: null,
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<Settings>
    // Merge rather than replace, so a setting added in a later version appears with its
    // default instead of as undefined on an install that predates it.
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Private browsing, or a full quota. Losing preferences is not worth an error
    // message in the middle of a job.
  }
}

export interface DeviceProfile {
  tile: number
  pad: number
  bandBudget: number
  cacheBudget: number
}

/**
 * Picks working sizes from what the device admits to having. Phones report 4 GB or less
 * and get smaller tiles and a smaller band; a desktop gets bigger ones and runs faster.
 */
export function deviceProfile(settings: Settings): DeviceProfile {
  const memoryGb =
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
  const budgetMb = settings.memoryBudgetMb ?? Math.min(256, Math.max(48, memoryGb * 24))
  const tile = settings.tileOverride ?? (memoryGb <= 4 ? 128 : 256)
  return {
    tile,
    // 20 is the receptive field radius of the deeper of the two networks, measured from
    // its layer stack rather than guessed. Tiles then join with no seam at all, which
    // the test suite checks byte for byte.
    pad: 20,
    bandBudget: budgetMb * 1024 * 1024,
    // In pixels, held as bytes, so three bytes each. The flagship job's first pass
    // produces 8192 x 3072, which is 25 MP and 75 MB: worth holding on anything with
    // 4 GB or more, because recomputing it once per band costs far more than it saves.
    // A smaller device falls back to streaming that pass too, which is slower but is
    // the difference between a slow job and a failed one.
    cacheBudget: Math.floor((budgetMb * 1024 * 1024) / 3),
  }
}
