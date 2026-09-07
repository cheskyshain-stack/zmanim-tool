import { useEffect, useRef, useState } from 'react'
import {
  FIT_LABEL,
  borderFraction,
  constrainCrop,
  containBox,
  coverCrop,
  croppedFraction,
  ratioLabel,
  ratiosMatch,
  snapRect,
  type FitMode,
  type Rect,
} from '../lib/aspect'
import type { DecodedImage } from '../lib/image'
import type { Settings } from '../lib/storage'
import { Button, Card, Label, Note, Stat } from './primitives'

export function CropStep({
  source,
  thumbnail,
  settings,
  update,
  targetWidth,
  targetHeight,
  crop,
  setCustomCrop,
  onNext,
}: {
  source: DecodedImage
  thumbnail: string
  settings: Settings
  update: (patch: Partial<Settings>) => void
  targetWidth: number
  targetHeight: number
  crop: Rect
  setCustomCrop: (rect: Rect | null) => void
  onNext: () => void
}) {
  const matches = ratiosMatch(source.width, source.height, targetWidth, targetHeight)
  const dropped = croppedFraction(crop, source.width, source.height)
  const border = borderFraction(source.width, source.height, targetWidth, targetHeight)

  return (
    <div className="space-y-4">
      {matches ? (
        <Note>
          <strong>Fits perfectly.</strong> Your image is{' '}
          {ratioLabel(source.width, source.height)} and the print is{' '}
          {ratioLabel(targetWidth, targetHeight)}. Nothing is cropped and nothing is
          stretched.
        </Note>
      ) : (
        <Note tone="warn">
          Your image is <strong>{ratioLabel(source.width, source.height)}</strong> and the
          print is <strong>{ratioLabel(targetWidth, targetHeight)}</strong>. They do not
          match, so something has to give. The image is never stretched to fit.
        </Note>
      )}

      <Card className="!p-0 overflow-hidden">
        {settings.fit === 'contain' ? (
          <ContainPreview
            thumbnail={thumbnail}
            source={source}
            targetWidth={targetWidth}
            targetHeight={targetHeight}
            borderColor={settings.borderColor}
          />
        ) : (
          <CropPreview
            thumbnail={thumbnail}
            source={source}
            crop={crop}
            draggable={settings.fit === 'custom'}
            onChange={(rect) =>
              setCustomCrop(
                snapRect(
                  constrainCrop(rect, source.width, source.height, targetWidth, targetHeight),
                  source.width,
                  source.height,
                ),
              )
            }
          />
        )}
      </Card>

      {!matches && (
        <Card>
          <Label>What should happen</Label>
          <div className="space-y-2">
            {(['cover', 'contain', 'custom'] as FitMode[]).map((mode, index) => {
              const active = settings.fit === mode
              const detail =
                mode === 'cover'
                  ? `Fills the whole print. Loses ${(dropped * 100).toFixed(0)}% of the image.`
                  : mode === 'contain'
                    ? `Keeps all of the image. Adds borders over ${(border * 100).toFixed(0)}% of the print.`
                    : 'Fills the whole print, but you choose which part is kept.'
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    update({ fit: mode })
                    if (mode !== 'custom') setCustomCrop(null)
                  }}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
                    active
                      ? 'border-brand-500 bg-brand-500/15'
                      : 'border-paper-300 bg-paper-50 dark:border-ink-700 dark:bg-ink-850'
                  }`}
                >
                  <span className="text-lg font-black tabular">
                    {'ABC'[index]}
                  </span>
                  <span>
                    <span className="block text-base font-bold">{FIT_LABEL[mode]}</span>
                    <span className="block text-sm text-ink-600 dark:text-paper-300">
                      {detail}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          {settings.fit === 'custom' && (
            <p className="mt-3 text-sm text-ink-600 dark:text-paper-300">
              Drag the bright area to choose what is kept. Use the slider to change how
              much of the image it covers. The shape is locked to the print, so the
              result can never be stretched.
            </p>
          )}
          {settings.fit === 'custom' && (
            <CropSizeSlider
              source={source}
              crop={crop}
              targetWidth={targetWidth}
              targetHeight={targetHeight}
              onChange={(rect) => setCustomCrop(rect)}
            />
          )}
          {settings.fit === 'contain' && (
            <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-paper-300 px-3 py-2 dark:border-ink-700">
              <span className="text-sm font-semibold">Border colour</span>
              <input
                type="color"
                value={settings.borderColor}
                onChange={(event) => update({ borderColor: event.target.value })}
                className="h-9 w-16 cursor-pointer rounded border-0 bg-transparent p-0"
              />
            </label>
          )}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Pixels used from your image"
          value={`${Math.round(crop.width).toLocaleString()} x ${Math.round(crop.height).toLocaleString()}`}
        />
        <Stat
          label="Cropping"
          value={
            settings.fit === 'contain'
              ? 'None, borders added'
              : dropped < 0.001
                ? 'None'
                : `${(dropped * 100).toFixed(0)}% removed`
          }
          tone={settings.fit !== 'contain' && dropped > 0.3 ? 'warn' : 'plain'}
        />
      </div>

      <Button onClick={onNext} className="w-full">
        Choose quality
      </Button>
    </div>
  )
}

function CropPreview({
  thumbnail,
  source,
  crop,
  draggable,
  onChange,
}: {
  thumbnail: string
  source: DecodedImage
  crop: Rect
  draggable: boolean
  onChange: (rect: Rect) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; rect: Rect } | null>(null)

  const percent = (value: number, total: number) => `${(value / total) * 100}%`

  return (
    <div
      ref={box}
      className="relative select-none"
      style={{ aspectRatio: `${source.width} / ${source.height}` }}
      onPointerDown={(event) => {
        if (!draggable) return
        ;(event.target as Element).setPointerCapture?.(event.pointerId)
        drag.current = { x: event.clientX, y: event.clientY, rect: crop }
      }}
      onPointerMove={(event) => {
        if (!draggable || !drag.current || !box.current) return
        const bounds = box.current.getBoundingClientRect()
        const scale = source.width / bounds.width
        onChange({
          ...drag.current.rect,
          x: drag.current.rect.x + (event.clientX - drag.current.x) * scale,
          y: drag.current.rect.y + (event.clientY - drag.current.y) * scale,
        })
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
    >
      <img src={thumbnail} alt="" className="absolute inset-0 h-full w-full" />
      {/* Four panels of shade rather than one box with a huge shadow: a shadow that
          large is expensive to composite on a phone and visibly lags a drag. */}
      <div
        className="absolute bg-black/60"
        style={{ left: 0, top: 0, right: 0, height: percent(crop.y, source.height) }}
      />
      <div
        className="absolute bg-black/60"
        style={{
          left: 0,
          top: percent(crop.y + crop.height, source.height),
          right: 0,
          bottom: 0,
        }}
      />
      <div
        className="absolute bg-black/60"
        style={{
          left: 0,
          top: percent(crop.y, source.height),
          width: percent(crop.x, source.width),
          height: percent(crop.height, source.height),
        }}
      />
      <div
        className="absolute bg-black/60"
        style={{
          left: percent(crop.x + crop.width, source.width),
          top: percent(crop.y, source.height),
          right: 0,
          height: percent(crop.height, source.height),
        }}
      />
      <div
        className={`pointer-events-none absolute border-2 border-white shadow-lg ${
          draggable ? 'cursor-move' : ''
        }`}
        style={{
          left: percent(crop.x, source.width),
          top: percent(crop.y, source.height),
          width: percent(crop.width, source.width),
          height: percent(crop.height, source.height),
        }}
      />
    </div>
  )
}

function ContainPreview({
  thumbnail,
  source,
  targetWidth,
  targetHeight,
  borderColor,
}: {
  thumbnail: string
  source: DecodedImage
  targetWidth: number
  targetHeight: number
  borderColor: string
}) {
  const box = containBox(source.width, source.height, targetWidth, targetHeight)
  return (
    <div
      className="relative"
      style={{ aspectRatio: `${targetWidth} / ${targetHeight}`, background: borderColor }}
    >
      <img
        src={thumbnail}
        alt=""
        className="absolute"
        style={{
          left: `${(box.x / targetWidth) * 100}%`,
          top: `${(box.y / targetHeight) * 100}%`,
          width: `${(box.width / targetWidth) * 100}%`,
          height: `${(box.height / targetHeight) * 100}%`,
        }}
      />
    </div>
  )
}

function CropSizeSlider({
  source,
  crop,
  targetWidth,
  targetHeight,
  onChange,
}: {
  source: DecodedImage
  crop: Rect
  targetWidth: number
  targetHeight: number
  onChange: (rect: Rect) => void
}) {
  const max = coverCrop(source.width, source.height, targetWidth, targetHeight)
  const [value, setValue] = useState(crop.width / max.width)

  useEffect(() => {
    setValue(crop.width / max.width)
  }, [crop.width, max.width])

  return (
    <label className="mt-3 block">
      <Label>How much of the image to keep</Label>
      <input
        type="range"
        min={0.25}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value)
          setValue(next)
          const width = max.width * next
          const height = width / (targetWidth / targetHeight)
          // Grow and shrink about the centre, so the framing the user chose stays put.
          onChange(
            snapRect(
              constrainCrop(
                {
                  x: crop.x + (crop.width - width) / 2,
                  y: crop.y + (crop.height - height) / 2,
                  width,
                  height,
                },
                source.width,
                source.height,
                targetWidth,
                targetHeight,
              ),
              source.width,
              source.height,
            ),
          )
        }}
        className="h-12 w-full"
      />
    </label>
  )
}
