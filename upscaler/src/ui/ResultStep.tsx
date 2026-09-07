import { useEffect, useMemo, useState } from 'react'
import type { Rect } from '../lib/aspect'
import { ratioLabel } from '../lib/aspect'
import { formatBytes, formatDuration, type DecodedImage } from '../lib/image'
import type { Settings } from '../lib/storage'
import type { UpscalePlan } from '../lib/plan'
import type { PassSpec, Tuning } from '../worker/protocol'
import type { PrintTarget } from '../lib/print'
import type { RenderWorker } from '../state/worker-client'
import { Button, Card, Label, Note } from './primitives'
import { CompareViewer } from './CompareViewer'

const EXTENSION = { png: 'png', tiff: 'tif', jpeg: 'jpg' } as const

export function ResultStep({
  blob,
  source,
  crop,
  content,
  settings,
  target,
  plan,
  elapsedMs,
  backend,
  worker,
  tuning,
  baseUrl,
  onStartOver,
  onBack,
}: {
  blob: Blob
  source: DecodedImage
  crop: Rect
  content: Rect
  settings: Settings
  target: PrintTarget
  plan: UpscalePlan
  elapsedMs: number
  backend: string
  worker: RenderWorker
  tuning: Tuning
  baseUrl: string
  onStartOver: () => void
  onBack: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const next = URL.createObjectURL(blob)
    setUrl(next)
    // Revoking matters here: a 300 MB blob URL that is never released keeps the whole
    // file alive for as long as the tab is open.
    return () => URL.revokeObjectURL(next)
  }, [blob])

  const cropped =
    settings.fit === 'contain'
      ? 'None, borders added'
      : Math.abs(crop.width * crop.height - source.width * source.height) <
          source.width * source.height * 0.002
        ? 'None'
        : `${(
            (1 - (crop.width * crop.height) / (source.width * source.height)) *
            100
          ).toFixed(0)}% of the image`

  const filename = useMemo(() => {
    const stem = source.name.replace(/\.[^.]+$/, '') || 'image'
    return `${stem}-${target.pxWidth}x${target.pxHeight}-${target.dpi}dpi.${EXTENSION[settings.format]}`
  }, [source.name, target, settings.format])

  const passes: PassSpec[] = plan.passes
  const printScale = content.width / crop.width

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 rounded-xl bg-good-500 px-3 py-2 text-center text-sm font-black uppercase tracking-wide text-white">
          Ready for large format printing
        </div>
        <dl className="tabular divide-y divide-paper-200 text-sm dark:divide-ink-800">
          <Row label="Print size" value={`${trim(target.widthIn)}" x ${trim(target.heightIn)}"`} />
          <Row
            label="Final resolution"
            value={`${target.pxWidth.toLocaleString()} x ${target.pxHeight.toLocaleString()} px`}
          />
          <Row label="DPI" value={String(target.dpi)} />
          <Row label="Aspect ratio" value={ratioLabel(target.pxWidth, target.pxHeight)} />
          <Row label="Cropping" value={cropped} />
          <Row label="Format" value={settings.format.toUpperCase()} />
          <Row label="Colour" value="sRGB, embedded in the file" />
          <Row label="File size" value={formatBytes(blob.size)} />
          <Row
            label="Upscaling"
            value={
              passes.length
                ? `${passes.map((p) => `${p.scale}x`).join(' then ')} AI, then Lanczos to exact size`
                : 'None needed, Lanczos to exact size'
            }
          />
          <Row
            label="Took"
            value={`${formatDuration(elapsedMs / 1000)} on ${backend.toUpperCase()}`}
          />
        </dl>
      </Card>

      {url && (
        <a
          href={url}
          download={filename}
          className="touch flex w-full items-center justify-center rounded-xl bg-brand-600 px-5 text-base font-semibold text-white hover:bg-brand-700"
        >
          Download print file
        </a>
      )}
      <p className="-mt-2 break-all text-center text-xs text-ink-600 dark:text-paper-300">
        {filename}
      </p>

      {blob.size > 400 * 1024 * 1024 && (
        <Note tone="warn">
          This file is {formatBytes(blob.size)}. Some phones struggle to save a file that
          large from the browser. If the download stalls, try TIFF (usually smaller than
          PNG on photographic images) or a lower DPI.
        </Note>
      )}

      <CompareViewer
        source={source}
        crop={crop}
        passes={passes}
        sharpen={settings.sharpen}
        denoise={settings.denoise}
        deblock={settings.deblock}
        printScale={printScale}
        worker={worker}
        tuning={tuning}
        baseUrl={baseUrl}
      />

      <Card>
        <Label>Not happy with it</Label>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onBack}>
            Change settings
          </Button>
          <Button variant="secondary" onClick={onStartOver}>
            Start over
          </Button>
        </div>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-ink-600 dark:text-paper-300">{label}</dt>
      <dd className="text-right font-bold">{value}</dd>
    </div>
  )
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
