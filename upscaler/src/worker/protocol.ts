// Messages between the UI and the worker. Kept in its own file so both sides import the
// same types and a change to one cannot silently drift from the other.

import type { Rect } from '../lib/aspect'
import type { SharpenLevel } from '../lib/enhance'
import type { FamilyId, ModelScale } from '../lib/models'

export type ExportFormat = 'png' | 'tiff' | 'jpeg'

export type Phase =
  | 'preparing'
  | 'loading-model'
  | 'upscaling'
  | 'enhancing'
  | 'resizing'
  | 'exporting'
  | 'done'

export const PHASE_LABEL: Record<Phase, string> = {
  preparing: 'Preparing',
  'loading-model': 'Loading model',
  upscaling: 'Upscaling',
  enhancing: 'Enhancing',
  resizing: 'Resizing',
  exporting: 'Exporting',
  done: 'Done',
}

export interface PassSpec {
  family: FamilyId
  scale: ModelScale
}

export interface Tuning {
  /** Tile edge in source pixels for model inference. */
  tile: number
  /** Context kept around each tile. */
  pad: number
  /** Working memory the band loop may use, in bytes. */
  bandBudget: number
  /** Pixels of intermediate the job may hold whole between passes. */
  cacheBudget: number
  deflateLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  pngFilter: 'adaptive' | 'up'
}

export interface RenderRequest {
  type: 'render'
  id: number
  baseUrl: string
  /** Cropped source pixels, RGBA, already oriented. */
  pixels: ArrayBuffer
  cropWidth: number
  cropHeight: number
  /** Full print size in pixels, borders included. */
  targetWidth: number
  targetHeight: number
  /** Where the image sits inside the print. Equal to the whole print unless fitting. */
  content: Rect
  borderColor: [number, number, number]
  dpi: number
  passes: PassSpec[]
  sharpen: SharpenLevel
  denoise: number
  deblock: boolean
  format: ExportFormat
  jpegQuality: number
  tuning: Tuning
}

export interface PreviewRequest {
  type: 'preview'
  id: number
  baseUrl: string
  /** A small window of source pixels, RGBA. */
  pixels: ArrayBuffer
  width: number
  height: number
  passes: PassSpec[]
  sharpen: SharpenLevel
  denoise: number
  deblock: boolean
  /** Scale the preview is displayed at, so the result lands at the right size. */
  outWidth: number
  outHeight: number
  tuning: Tuning
}

export interface BenchmarkRequest {
  type: 'benchmark'
  id: number
  baseUrl: string
  passes: PassSpec[]
}

export interface CancelRequest {
  type: 'cancel'
  id: number
}

export type WorkerRequest =
  | RenderRequest
  | PreviewRequest
  | BenchmarkRequest
  | CancelRequest

export interface ProgressMessage {
  type: 'progress'
  id: number
  phase: Phase
  /** 0 to 1 across the whole job. */
  progress: number
  detail: string
}

export interface RenderDoneMessage {
  type: 'render-done'
  id: number
  blob: Blob
  width: number
  height: number
  backend: string
  elapsedMs: number
}

export interface PreviewDoneMessage {
  type: 'preview-done'
  id: number
  /** RGBA at outWidth x outHeight. */
  pixels: ArrayBuffer
  width: number
  height: number
}

export interface BenchmarkDoneMessage {
  type: 'benchmark-done'
  id: number
  backend: string
  /** Output pixels per second the device sustains on this model chain. */
  pixelsPerSecond: number
}

export interface ErrorMessage {
  type: 'error'
  id: number
  message: string
  cancelled: boolean
}

export type WorkerResponse =
  | ProgressMessage
  | RenderDoneMessage
  | PreviewDoneMessage
  | BenchmarkDoneMessage
  | ErrorMessage
