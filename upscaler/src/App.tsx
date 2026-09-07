import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  containBox,
  coverCrop,
  snapRect,
  type Rect,
} from './lib/aspect'
import { makeThumbnail, type DecodedImage } from './lib/image'
import { modeById } from './lib/models'
import { planUpscale } from './lib/plan'
import { resolveTarget } from './lib/print'
import {
  DEFAULTS,
  deviceProfile,
  loadSettings,
  saveSettings,
  type Settings,
} from './lib/storage'
import { RenderWorker, CancelledError } from './state/worker-client'
import type { Phase } from './worker/protocol'
import { Button } from './ui/primitives'
import { UploadStep } from './ui/UploadStep'
import { SizeStep } from './ui/SizeStep'
import { CropStep } from './ui/CropStep'
import { EnhanceStep } from './ui/EnhanceStep'
import { RunStep } from './ui/RunStep'
import { ResultStep } from './ui/ResultStep'
import { SettingsSheet } from './ui/SettingsSheet'

const STEPS = ['upload', 'size', 'crop', 'enhance', 'run', 'result'] as const
type Step = (typeof STEPS)[number]

const STEP_LABEL: Record<Step, string> = {
  upload: 'Upload',
  size: 'Print size',
  crop: 'Crop',
  enhance: 'Enhance',
  run: 'Upscaling',
  result: 'Download',
}

interface JobState {
  id: number | null
  phase: Phase
  progress: number
  detail: string
  startedAt: number
  error: string | null
  blob: Blob | null
  elapsedMs: number
  backend: string
}

const IDLE_JOB: JobState = {
  id: null,
  phase: 'preparing',
  progress: 0,
  detail: '',
  startedAt: 0,
  error: null,
  blob: null,
  elapsedMs: 0,
  backend: '',
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [source, setSource] = useState<DecodedImage | null>(null)
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('upload')
  const [customCrop, setCustomCrop] = useState<Rect | null>(null)
  const [job, setJob] = useState<JobState>(IDLE_JOB)
  const [rate, setRate] = useState<number | null>(null)
  const [benchmarking, setBenchmarking] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [now, setNow] = useState(0)

  const workerRef = useRef<RenderWorker | null>(null)
  const baseUrl = import.meta.env.BASE_URL

  const getWorker = useCallback(() => {
    if (!workerRef.current) workerRef.current = new RenderWorker()
    return workerRef.current
  }, [])

  useEffect(() => () => workerRef.current?.terminate(), [])

  // --- theme ---------------------------------------------------------------
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark =
        settings.theme === 'dark' || (settings.theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#070c16' : '#f6f7fb')
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])

  useEffect(() => saveSettings(settings), [settings])

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }))
  }, [])

  // --- derived numbers -----------------------------------------------------
  const target = useMemo(() => resolveTarget(settings), [settings])
  const mode = useMemo(() => modeById(settings.modeId), [settings.modeId])
  const tuning = useMemo(() => {
    const profile = deviceProfile(settings)
    return {
      ...profile,
      deflateLevel: 6 as const,
      pngFilter: 'adaptive' as const,
    }
  }, [settings])

  const crop = useMemo<Rect>(() => {
    if (!source) return { x: 0, y: 0, width: 0, height: 0 }
    if (settings.fit === 'contain') {
      return { x: 0, y: 0, width: source.width, height: source.height }
    }
    if (settings.fit === 'custom' && customCrop) return customCrop
    return snapRect(
      coverCrop(source.width, source.height, target.pxWidth, target.pxHeight),
      source.width,
      source.height,
    )
  }, [source, settings.fit, customCrop, target])

  // Where the image sits inside the print. Only "fit whole image" makes it smaller than
  // the print itself; the rest is border.
  const content = useMemo<Rect>(() => {
    if (!source || settings.fit !== 'contain') {
      return { x: 0, y: 0, width: target.pxWidth, height: target.pxHeight }
    }
    const box = containBox(source.width, source.height, target.pxWidth, target.pxHeight)
    return {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    }
  }, [source, settings.fit, target])

  const plan = useMemo(
    () =>
      planUpscale({
        cropWidth: Math.max(1, Math.round(crop.width)),
        cropHeight: Math.max(1, Math.round(crop.height)),
        targetWidth: content.width,
        targetHeight: content.height,
        mode,
      }),
    [crop, content, mode],
  )

  const estimateSeconds = useMemo(() => {
    if (rate === null || rate <= 0) return null
    // The AI passes dominate, but the encoder, the resize and the sharpen are not free.
    // Measured against real runs, everything after the network costs roughly a fifth
    // again on top, and quoting the network time alone reads as a broken estimate.
    return (plan.aiPixels / rate) * 1.2 + target.megapixels * 0.05
  }, [plan, rate, target])

  // --- previews ------------------------------------------------------------
  useEffect(() => {
    if (!source) {
      setThumbnail(null)
      return
    }
    const canvas = makeThumbnail(source.bitmap, 1400)
    const url = canvas.toDataURL('image/jpeg', 0.9)
    setThumbnail(url)
  }, [source])

  // Ticks the elapsed clock while a job runs, without re-rendering when nothing runs.
  useEffect(() => {
    if (step !== 'run' || job.error) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [step, job.error])

  // --- benchmark -----------------------------------------------------------
  const benchmarkKey = plan.passes.map((p) => `${p.family}x${p.scale}`).join('-')
  useEffect(() => {
    if (step !== 'enhance' || plan.passes.length === 0) return
    let cancelled = false
    setBenchmarking(true)
    getWorker()
      .benchmark({ type: 'benchmark', baseUrl, passes: plan.passes })
      .result.then((message) => {
        if (!cancelled) setRate(message.pixelsPerSecond)
      })
      .catch(() => {
        if (!cancelled) setRate(null)
      })
      .finally(() => {
        if (!cancelled) setBenchmarking(false)
      })
    return () => {
      cancelled = true
    }
    // benchmarkKey stands in for the pass list: only a change of model or scale changes
    // the speed, and the array itself is a new object on every render.
  }, [step, benchmarkKey, baseUrl, getWorker, plan.passes.length])

  // --- running the job -----------------------------------------------------
  const start = useCallback(
    (override?: Partial<Settings>) => {
      if (!source) return
      const effective = { ...settings, ...override }
      const activeTarget = resolveTarget(effective)
      const activeMode = modeById(effective.modeId)
      const activeCrop =
        effective.fit === 'contain'
          ? { x: 0, y: 0, width: source.width, height: source.height }
          : effective.fit === 'custom' && customCrop
            ? customCrop
            : snapRect(
                coverCrop(
                  source.width,
                  source.height,
                  activeTarget.pxWidth,
                  activeTarget.pxHeight,
                ),
                source.width,
                source.height,
              )
      const activeContent =
        effective.fit === 'contain'
          ? (() => {
              const box = containBox(
                source.width,
                source.height,
                activeTarget.pxWidth,
                activeTarget.pxHeight,
              )
              return {
                x: Math.round(box.x),
                y: Math.round(box.y),
                width: Math.round(box.width),
                height: Math.round(box.height),
              }
            })()
          : { x: 0, y: 0, width: activeTarget.pxWidth, height: activeTarget.pxHeight }

      const activePlan = planUpscale({
        cropWidth: Math.max(1, Math.round(activeCrop.width)),
        cropHeight: Math.max(1, Math.round(activeCrop.height)),
        targetWidth: activeContent.width,
        targetHeight: activeContent.height,
        mode: activeMode,
      })

      let pixels: ImageData
      try {
        pixels = extract(source, activeCrop)
      } catch (error) {
        setJob({
          ...IDLE_JOB,
          error:
            error instanceof Error
              ? error.message
              : 'The image could not be read back out of the canvas.',
        })
        setStep('run')
        return
      }

      setStep('run')
      setJob({ ...IDLE_JOB, startedAt: Date.now(), detail: 'Starting' })

      const { id, result } = getWorker().render(
        {
          type: 'render',
          baseUrl,
          pixels: pixels.data.buffer as ArrayBuffer,
          cropWidth: activeCrop.width,
          cropHeight: activeCrop.height,
          targetWidth: activeTarget.pxWidth,
          targetHeight: activeTarget.pxHeight,
          content: activeContent,
          borderColor: hexToRgb(effective.borderColor),
          dpi: activeTarget.dpi,
          passes: activePlan.passes,
          sharpen: effective.sharpen,
          denoise: effective.denoise ? 1 : 0,
          deblock: effective.deblock,
          format: effective.format,
          jpegQuality: effective.jpegQuality,
          tuning: {
            ...deviceProfile(effective),
            deflateLevel: 6,
            pngFilter: 'adaptive',
          },
        },
        (message) => {
          setJob((current) => ({
            ...current,
            phase: message.phase,
            progress: message.progress,
            detail: message.detail,
          }))
        },
      )

      setJob((current) => ({ ...current, id }))
      result
        .then((message) => {
          setJob((current) => ({
            ...current,
            blob: message.blob,
            elapsedMs: message.elapsedMs,
            backend: message.backend,
            progress: 1,
            phase: 'done',
          }))
          setStep('result')
        })
        .catch((error: unknown) => {
          if (error instanceof CancelledError) {
            setJob(IDLE_JOB)
            setStep('enhance')
            return
          }
          setJob((current) => ({
            ...current,
            error: error instanceof Error ? error.message : String(error),
          }))
        })
    },
    [source, settings, customCrop, baseUrl, getWorker],
  )

  const maximumQuality = useCallback(() => {
    // One press: the mode built for detail without hard edges, light sharpening, and a
    // lossless format. The pass count is worked out by the planner from the enlargement
    // the print needs, which is the part that actually matters.
    const override: Partial<Settings> = {
      modeId: 'artwork',
      sharpen: 'light',
      format: 'png',
    }
    update(override)
    start(override)
  }, [start, update])

  const elapsedSeconds = job.startedAt ? (Math.max(now, Date.now()) - job.startedAt) / 1000 : 0

  const index = STEPS.indexOf(step)
  const canGoBack = step !== 'upload' && step !== 'run'

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col">
      <header className="sticky top-0 z-10 border-b border-paper-300 bg-paper-100/95 backdrop-blur dark:border-ink-800 dark:bg-ink-950/95">
        <div className="flex items-center gap-2 px-4 py-3">
          {canGoBack ? (
            <button
              type="button"
              onClick={() => setStep(STEPS[Math.max(0, index - 1)])}
              className="touch -ml-2 flex items-center rounded-xl px-3 text-sm font-semibold"
              aria-label="Go back"
            >
              ‹ Back
            </button>
          ) : (
            <span className="text-base font-black">Print Upscaler</span>
          )}
          <span className="flex-1 text-center text-sm font-bold">{STEP_LABEL[step]}</span>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="touch -mr-2 rounded-xl px-3 text-sm font-semibold"
          >
            Settings
          </button>
        </div>
        <div className="flex gap-1 px-4 pb-2" aria-hidden>
          {STEPS.map((name, i) => (
            <span
              key={name}
              className={`h-1 flex-1 rounded-full ${
                i <= index ? 'bg-brand-500' : 'bg-paper-300 dark:bg-ink-800'
              }`}
            />
          ))}
        </div>
      </header>

      <main className="flex-1 px-4 py-4 pb-[calc(1rem+var(--safe-bottom))]">
        {step === 'upload' && (
          <UploadStep
            source={source}
            thumbnail={thumbnail}
            onLoaded={(image) => {
              setSource(image)
              setCustomCrop(null)
              setJob(IDLE_JOB)
            }}
            onNext={() => setStep('size')}
          />
        )}

        {step === 'size' && source && (
          <SizeStep
            source={source}
            settings={settings}
            update={update}
            onNext={() => setStep('crop')}
          />
        )}

        {step === 'crop' && source && thumbnail && (
          <CropStep
            source={source}
            thumbnail={thumbnail}
            settings={settings}
            update={update}
            targetWidth={target.pxWidth}
            targetHeight={target.pxHeight}
            crop={crop}
            setCustomCrop={setCustomCrop}
            onNext={() => setStep('enhance')}
          />
        )}

        {step === 'enhance' && source && (
          <EnhanceStep
            settings={settings}
            update={update}
            plan={plan}
            estimateSeconds={estimateSeconds}
            benchmarkPending={benchmarking}
            onStart={() => start()}
            onMaximum={maximumQuality}
          />
        )}

        {step === 'run' && (
          <RunStep
            phase={job.phase}
            progress={job.progress}
            detail={job.detail}
            elapsedSeconds={elapsedSeconds}
            estimateSeconds={estimateSeconds}
            error={job.error}
            onCancel={() => {
              if (job.id !== null) getWorker().cancel(job.id)
            }}
            onRetry={() => {
              setJob(IDLE_JOB)
              setStep('enhance')
            }}
          />
        )}

        {step === 'result' && source && job.blob && (
          <ResultStep
            blob={job.blob}
            source={source}
            crop={crop}
            content={content}
            settings={settings}
            target={target}
            plan={plan}
            elapsedMs={job.elapsedMs}
            backend={job.backend}
            worker={getWorker()}
            tuning={tuning}
            baseUrl={baseUrl}
            onBack={() => setStep('enhance')}
            onStartOver={() => {
              setSource(null)
              setJob(IDLE_JOB)
              setCustomCrop(null)
              setStep('upload')
            }}
          />
        )}

        {step !== 'upload' && !source && (
          <div className="space-y-4">
            <p>Choose an image first.</p>
            <Button onClick={() => setStep('upload')}>Go to upload</Button>
          </div>
        )}
      </main>

      {showSettings && (
        <SettingsSheet
          settings={settings}
          update={update}
          onReset={() => setSettings({ ...DEFAULTS })}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}

function extract(source: DecodedImage, crop: Rect): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(crop.width))
  canvas.height = Math.max(1, Math.round(crop.height))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This browser would not give the app a 2D canvas.')
  ctx.drawImage(
    source.bitmap,
    Math.round(crop.x),
    Math.round(crop.y),
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return [255, 255, 255]
  const value = parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}
