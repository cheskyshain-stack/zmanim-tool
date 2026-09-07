import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Rect } from '../lib/aspect'
import { extractRegion, type DecodedImage } from '../lib/image'
import type { RenderWorker } from '../state/worker-client'
import type { PassSpec, Tuning } from '../worker/protocol'
import type { SharpenLevel } from '../lib/enhance'
import { Card, Label, Segmented } from './primitives'

/**
 * Before and after at print resolution.
 *
 * The "after" side is not a mock up: it runs the exact same passes, the same final
 * Lanczos step and the same sharpening as the export, over the small window you are
 * looking at. The "before" side is the same window resized the ordinary way, which is
 * the honest comparison: it is what you would get without any of this.
 */
export function CompareViewer({
  source,
  crop,
  passes,
  sharpen,
  denoise,
  deblock,
  printScale,
  worker,
  tuning,
  baseUrl,
}: {
  source: DecodedImage
  crop: Rect
  passes: PassSpec[]
  sharpen: SharpenLevel
  denoise: boolean
  deblock: boolean
  /** Print pixels per source pixel, which is what makes 100% mean 100%. */
  printScale: number
  worker: RenderWorker
  tuning: Tuning
  baseUrl: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const beforeCanvas = useRef<HTMLCanvasElement>(null)
  const afterCanvas = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [split, setSplit] = useState(50)
  const [centre, setCentre] = useState({ x: 0.5, y: 0.5 })
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [view, setView] = useState(512)
  const jobRef = useRef(0)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth
      if (width > 0) {
        // Backing pixels, not CSS pixels, so "100%" really is one print pixel per
        // device pixel on a phone with a 3x screen.
        setView(Math.min(1400, Math.round(width * (window.devicePixelRatio || 1))))
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const window_ = useMemo(() => {
    const wanted = view / (zoom * printScale)
    const width = Math.max(8, Math.min(Math.round(wanted), Math.round(crop.width)))
    const height = Math.max(8, Math.min(Math.round(wanted), Math.round(crop.height)))
    const x = Math.round(
      Math.min(Math.max(crop.x + centre.x * crop.width - width / 2, crop.x), crop.x + crop.width - width),
    )
    const y = Math.round(
      Math.min(Math.max(crop.y + centre.y * crop.height - height / 2, crop.y), crop.y + crop.height - height),
    )
    return { x, y, width, height }
  }, [view, zoom, printScale, crop, centre])

  const run = useCallback(async () => {
    const token = ++jobRef.current
    setStatus('working')
    setMessage('Rendering this patch at print resolution')
    try {
      const region = extractRegion(
        source.bitmap,
        window_.x,
        window_.y,
        window_.width,
        window_.height,
      )

      // Before: the same pixels enlarged the ordinary way.
      const before = beforeCanvas.current
      if (before) {
        before.width = view
        before.height = view
        const ctx = before.getContext('2d')
        if (ctx) {
          const temp = document.createElement('canvas')
          temp.width = window_.width
          temp.height = window_.height
          temp.getContext('2d')?.putImageData(region, 0, 0)
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(temp, 0, 0, view, view)
        }
      }

      const { result } = worker.preview({
        type: 'preview',
        baseUrl,
        pixels: region.data.buffer as ArrayBuffer,
        width: window_.width,
        height: window_.height,
        passes,
        sharpen,
        denoise: denoise ? 1 : 0,
        deblock,
        outWidth: view,
        outHeight: view,
        tuning,
      })
      const done = await result
      if (token !== jobRef.current) return

      const after = afterCanvas.current
      if (after) {
        after.width = done.width
        after.height = done.height
        after
          .getContext('2d')
          ?.putImageData(
            new ImageData(new Uint8ClampedArray(done.pixels), done.width, done.height),
            0,
            0,
          )
      }
      setStatus('idle')
    } catch (error) {
      if (token !== jobRef.current) return
      setStatus('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [source, window_, view, passes, sharpen, denoise, deblock, worker, tuning, baseUrl])

  useEffect(() => {
    void run()
  }, [run])

  return (
    <Card>
      <Label>Before and after, at print resolution</Label>
      <div
        ref={container}
        className="checkerboard relative w-full select-none overflow-hidden rounded-xl"
        style={{ aspectRatio: '1 / 1' }}
        onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          setSplit(
            Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100)),
          )
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 1) return
          const bounds = event.currentTarget.getBoundingClientRect()
          setSplit(
            Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100)),
          )
        }}
      >
        <canvas
          ref={beforeCanvas}
          className="absolute inset-0 h-full w-full"
          style={{ imageRendering: 'pixelated' }}
        />
        <div
          className="absolute inset-y-0 left-0 overflow-hidden"
          style={{ width: `${split}%` }}
        >
          <canvas
            ref={afterCanvas}
            className="absolute inset-y-0 left-0 h-full"
            style={{
              width: container.current?.clientWidth ?? '100%',
              imageRendering: 'pixelated',
            }}
          />
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow"
          style={{ left: `${split}%` }}
        />
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-xs font-bold text-white">
          Upscaled
        </span>
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/70 px-2 py-1 text-xs font-bold text-white">
          Original
        </span>
        {status === 'working' && (
          <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs text-white">
            {message}
          </span>
        )}
        {status === 'error' && (
          <span className="absolute bottom-2 left-2 rounded bg-bad-500 px-2 py-1 text-xs text-white">
            {message}
          </span>
        )}
      </div>

      <p className="mt-2 text-sm text-ink-600 dark:text-paper-300">
        Drag across the picture to move the divider. Tap the small preview below to
        inspect a different part of the image.
      </p>

      <div className="mt-3">
        <Segmented
          label="Zoom"
          value={zoom}
          onChange={setZoom}
          options={[
            { value: 0.5, label: '50%' },
            { value: 1, label: '100%', hint: 'print pixels' },
            { value: 2, label: '200%' },
          ]}
        />
      </div>

      <PickPoint
        source={source}
        crop={crop}
        window_={window_}
        centre={centre}
        onPick={setCentre}
      />
    </Card>
  )
}

function PickPoint({
  source,
  crop,
  window_,
  centre,
  onPick,
}: {
  source: DecodedImage
  crop: Rect
  window_: { x: number; y: number; width: number; height: number }
  centre: { x: number; y: number }
  onPick: (point: { x: number; y: number }) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const width = 320
    const height = Math.max(1, Math.round((width * crop.height) / crop.width))
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(
      source.bitmap,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      width,
      height,
    )
  }, [source, crop])

  const boxLeft = ((window_.x - crop.x) / crop.width) * 100
  const boxTop = ((window_.y - crop.y) / crop.height) * 100
  const boxWidth = (window_.width / crop.width) * 100
  const boxHeight = (window_.height / crop.height) * 100

  return (
    <div className="mt-3">
      <Label>Where you are looking</Label>
      <div
        className="relative overflow-hidden rounded-xl"
        onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          onPick({
            x: (event.clientX - bounds.left) / bounds.width,
            y: (event.clientY - bounds.top) / bounds.height,
          })
        }}
      >
        <canvas ref={ref} className="block w-full" />
        <div
          className="pointer-events-none absolute border-2 border-brand-400 bg-brand-400/20"
          style={{
            left: `${boxLeft}%`,
            top: `${boxTop}%`,
            width: `${Math.max(boxWidth, 1)}%`,
            height: `${Math.max(boxHeight, 1)}%`,
          }}
          aria-hidden
        />
        <span className="sr-only">
          Inspection point at {Math.round(centre.x * 100)} percent across and{' '}
          {Math.round(centre.y * 100)} percent down
        </span>
      </div>
    </div>
  )
}
