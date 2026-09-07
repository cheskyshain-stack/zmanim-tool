import { ratioLabel } from '../lib/aspect'
import {
  DPI_CHOICES,
  GRADE_LABEL,
  PRESETS,
  assessSource,
  dpiTable,
  orientPreset,
  resolveTarget,
  type Grade,
  type Unit,
} from '../lib/print'
import type { Settings } from '../lib/storage'
import { formatMegapixels, type DecodedImage } from '../lib/image'
import { Button, Card, Label, Note, NumberField, Segmented, Stat } from './primitives'

const GRADE_TONE: Record<Grade, 'good' | 'warn' | 'bad' | 'plain'> = {
  excellent: 'good',
  good: 'good',
  acceptable: 'warn',
  low: 'bad',
}

export function SizeStep({
  source,
  settings,
  update,
  onNext,
}: {
  source: DecodedImage
  settings: Settings
  update: (patch: Partial<Settings>) => void
  onNext: () => void
}) {
  const target = resolveTarget(settings)
  const assessment = assessSource(source.width, source.height, target)
  const table = dpiTable(target.widthIn, target.heightIn)

  function choosePreset(id: string) {
    const preset = PRESETS.find((p) => p.id === id)
    if (!preset) return
    const { widthIn, heightIn } = orientPreset(preset, settings.orientation)
    update({ presetId: id, width: widthIn, height: heightIn, unit: 'in' })
  }

  function setOrientation(orientation: 'landscape' | 'portrait') {
    const preset = PRESETS.find((p) => p.id === settings.presetId)
    if (preset) {
      const { widthIn, heightIn } = orientPreset(preset, orientation)
      update({ orientation, width: widthIn, height: heightIn, unit: 'in' })
    } else {
      // A hand typed size just swaps, which is what "turn it on its side" means.
      update({ orientation, width: settings.height, height: settings.width })
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <Label>Preset sizes</Label>
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((preset) => {
            const active = settings.presetId === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => choosePreset(preset.id)}
                className={`touch flex flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition ${
                  active
                    ? 'border-brand-500 bg-brand-500/15'
                    : 'border-paper-300 bg-paper-50 dark:border-ink-700 dark:bg-ink-850'
                } ${preset.featured ? 'col-span-2' : ''}`}
              >
                <span className="text-base font-bold">
                  {preset.featured && <span aria-hidden>★ </span>}
                  {preset.label}
                </span>
                {preset.note && (
                  <span className="text-xs text-ink-600 dark:text-paper-300">
                    {preset.note}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <div className="mt-3">
          <Segmented
            label="Orientation"
            value={settings.orientation}
            onChange={setOrientation}
            options={[
              { value: 'landscape', label: 'Landscape' },
              { value: 'portrait', label: 'Portrait' },
            ]}
          />
        </div>
      </Card>

      <Card>
        <Label>Or type a size</Label>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Width"
            value={settings.width}
            min={1}
            step={0.5}
            onChange={(width) => update({ width, presetId: null })}
          />
          <NumberField
            label="Height"
            value={settings.height}
            min={1}
            step={0.5}
            onChange={(height) => update({ height, presetId: null })}
          />
        </div>
        <div className="mt-3">
          <Segmented<Unit>
            label="Unit"
            value={settings.unit}
            onChange={(unit) => {
              // Convert as you switch, so the print stays the same physical size and
              // the numbers do not silently mean something twelve times bigger.
              const factor = unit === settings.unit ? 1 : unit === 'ft' ? 1 / 12 : 12
              update({
                unit,
                width: Number((settings.width * factor).toFixed(4)),
                height: Number((settings.height * factor).toFixed(4)),
                presetId: null,
              })
            }}
            options={[
              { value: 'in', label: 'Inches' },
              { value: 'ft', label: 'Feet' },
            ]}
          />
        </div>
      </Card>

      <Card>
        <Segmented
          label="Print resolution"
          value={settings.dpi}
          columns={5}
          onChange={(dpi) => update({ dpi })}
          options={DPI_CHOICES.map((dpi) => ({ value: dpi, label: String(dpi) }))}
        />
        <div className="mt-3 overflow-hidden rounded-xl border border-paper-300 dark:border-ink-700">
          <table className="tabular w-full text-sm">
            <thead className="bg-paper-100 text-left text-xs uppercase text-ink-600 dark:bg-ink-850 dark:text-paper-300">
              <tr>
                <th className="px-3 py-2 font-bold">DPI</th>
                <th className="px-3 py-2 font-bold">Pixels needed</th>
              </tr>
            </thead>
            <tbody>
              {table.map((row) => (
                <tr
                  key={row.dpi}
                  className={
                    row.dpi === settings.dpi
                      ? 'bg-brand-500/15 font-bold'
                      : 'border-t border-paper-200 dark:border-ink-800'
                  }
                >
                  <td className="px-3 py-2">{row.dpi}</td>
                  <td className="px-3 py-2">
                    {row.pxWidth.toLocaleString()} x {row.pxHeight.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <Label>What this print needs</Label>
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="Print size"
            value={`${trim(target.widthIn)}" x ${trim(target.heightIn)}"`}
          />
          <Stat label="Print ratio" value={ratioLabel(target.pxWidth, target.pxHeight)} />
          <Stat
            label="Final pixels"
            value={`${target.pxWidth.toLocaleString()} x ${target.pxHeight.toLocaleString()} (${formatMegapixels(target.pxWidth * target.pxHeight)})`}
            wide
          />
          <Stat
            label="Your image today"
            value={`${assessment.effectiveDpi.toFixed(0)} DPI`}
            tone={GRADE_TONE[assessment.grade]}
          />
          <Stat
            label="Verdict without AI"
            value={GRADE_LABEL[assessment.grade]}
            tone={GRADE_TONE[assessment.grade]}
          />
        </div>
        <div className="mt-3">
          {assessment.alreadyEnough ? (
            <Note>
              The image already has more pixels than this print needs. No AI upscaling
              will run; it will be resized down, which keeps every bit of detail.
            </Note>
          ) : (
            <Note tone={assessment.enlargement > 8 ? 'warn' : 'info'}>
              Needs <strong>{assessment.enlargement.toFixed(2)}x</strong> enlargement to
              reach {target.pxWidth.toLocaleString()} x{' '}
              {target.pxHeight.toLocaleString()}.
              {assessment.enlargement > 8 &&
                ' That is a lot. It is worth trying 150 or 200 DPI as well: a banner ' +
                  'this size is normally seen from further away than a photo print, and ' +
                  'the file is a quarter of the size.'}
            </Note>
          )}
        </div>
      </Card>

      <Button onClick={onNext} className="w-full">
        Check the crop
      </Button>
    </div>
  )
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
