import { SHARPEN_LABEL, type SharpenLevel } from '../lib/enhance'
import { MODES, type ModeId } from '../lib/models'
import { FORCED_FACTORS, describePasses, type UpscalePlan } from '../lib/plan'
import { formatDuration, formatMegapixels } from '../lib/image'
import type { Settings } from '../lib/storage'
import type { ExportFormat } from '../worker/protocol'
import { Button, Card, Label, Note, Segmented, Stat, Toggle } from './primitives'

export function EnhanceStep({
  settings,
  update,
  plan,
  estimateSeconds,
  benchmarkPending,
  onStart,
  onMaximum,
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  plan: UpscalePlan
  estimateSeconds: number | null
  benchmarkPending: boolean
  onStart: () => void
  onMaximum: () => void
}) {
  return (
    <div className="space-y-4">
      <Card>
        <Button onClick={onMaximum} className="w-full text-lg">
          Maximum Print Quality
        </Button>
        <p className="mt-2 text-sm text-ink-600 dark:text-paper-300">
          Works out the enlargement your print needs, picks the number of AI passes that
          reaches it without overshooting, resizes to the exact pixel count, applies light
          sharpening and exports a print ready PNG. One button for the whole job.
        </p>
      </Card>

      <Card>
        <Label>Upscaling mode</Label>
        <div className="space-y-2">
          {MODES.map((mode) => {
            const active = settings.modeId === mode.id
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() =>
                  update({
                    modeId: mode.id as ModeId,
                    sharpen: mode.sharpen,
                    denoise: mode.denoise > 0,
                    deblock: mode.deblock,
                  })
                }
                className={`block w-full rounded-xl border p-3 text-left transition ${
                  active
                    ? 'border-brand-500 bg-brand-500/15'
                    : 'border-paper-300 bg-paper-50 dark:border-ink-700 dark:bg-ink-850'
                }`}
              >
                <span className="block text-base font-bold">{mode.label}</span>
                <span className="block text-sm text-ink-600 dark:text-paper-300">
                  {mode.blurb}
                </span>
              </button>
            )
          })}
        </div>
      </Card>

      <Card>
        <Segmented
          label="Enlargement"
          columns={5}
          value={settings.forceFactor ?? 0}
          onChange={(value) => update({ forceFactor: value === 0 ? null : value })}
          options={[
            { value: 0, label: 'Auto' },
            ...FORCED_FACTORS.map((factor) => ({
              value: factor as number,
              label: `${factor}x`,
            })),
          ]}
        />
        <p className="mt-2 text-sm text-ink-600 dark:text-paper-300">
          Auto reaches the enlargement your print needs and stops there, which is both
          the fastest option and the best looking one. Force a number if you want to see
          what a particular amount does to this image.
        </p>
      </Card>

      <Card>
        <Segmented<SharpenLevel>
          label="Sharpening"
          columns={4}
          value={settings.sharpen}
          onChange={(sharpen) => update({ sharpen })}
          options={(['none', 'light', 'medium', 'strong'] as SharpenLevel[]).map((level) => ({
            value: level,
            label: SHARPEN_LABEL[level],
          }))}
        />
        <p className="mt-2 text-sm text-ink-600 dark:text-paper-300">
          Applied at the final print resolution, with a halo guard: no pixel is allowed
          to run past the brightest or darkest of its neighbours, which is what a halo is.
        </p>
        <div className="mt-3 space-y-2">
          <Toggle
            label="Reduce noise"
            hint="Edge preserving, on the source, before anything enlarges the grain."
            checked={settings.denoise}
            onChange={(denoise) => update({ denoise })}
          />
          <Toggle
            label="Reduce JPEG artifacts"
            hint="Softens the 8 pixel block edges a JPEG leaves behind. Worth it for a camera roll photo."
            checked={settings.deblock}
            onChange={(deblock) => update({ deblock })}
          />
        </div>
      </Card>

      <Card>
        <Segmented<ExportFormat>
          label="Export format"
          value={settings.format}
          onChange={(format) => update({ format })}
          options={[
            { value: 'png', label: 'PNG', hint: 'lossless' },
            { value: 'tiff', label: 'TIFF', hint: 'for print shops' },
            { value: 'jpeg', label: 'JPEG', hint: 'smaller' },
          ]}
        />
        {settings.format === 'jpeg' ? (
          <>
            <label className="mt-3 block">
              <Label>JPEG quality: {settings.jpegQuality}</Label>
              <input
                type="range"
                min={70}
                max={100}
                value={settings.jpegQuality}
                onChange={(event) => update({ jpegQuality: Number(event.target.value) })}
                className="h-12 w-full"
              />
            </label>
            <Note tone="warn">
              For printing, PNG or TIFF is the better choice: both are lossless, and this
              is the one and only time the file is written. JPEG here is full resolution
              colour (4:4:4), not the usual 4:2:0, so it is much better than a normal
              JPEG, but it is still lossy.
            </Note>
          </>
        ) : (
          <p className="mt-2 text-sm text-ink-600 dark:text-paper-300">
            {settings.format === 'png'
              ? 'Lossless, with the print DPI and sRGB written into the file. The safest choice.'
              : 'Lossless, Deflate compressed, with the print DPI and a real sRGB profile embedded. What most large format print shops ask for.'}
          </p>
        )}
      </Card>

      <Card>
        <Label>What will happen</Label>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="AI passes" value={describePasses(plan)} />
          <Stat label="Total enlargement" value={`${plan.factor}x`} />
          <Stat
            label="After the AI"
            value={`${plan.intermediateWidth.toLocaleString()} x ${plan.intermediateHeight.toLocaleString()}`}
          />
          <Stat
            label="Then resized"
            value={
              Math.abs(plan.finalResize - 1) < 0.001
                ? 'no change'
                : `${plan.finalResize < 1 ? 'down' : 'up'} ${plan.finalResize.toFixed(3)}x`
            }
          />
          <Stat
            label="Pixels the AI generates"
            value={formatMegapixels(plan.aiPixels)}
          />
          <Stat
            label="Estimated time"
            value={
              benchmarkPending
                ? 'measuring...'
                : estimateSeconds === null
                  ? 'unknown'
                  : formatDuration(estimateSeconds)
            }
            tone={estimateSeconds !== null && estimateSeconds > 1800 ? 'warn' : 'plain'}
          />
        </div>
        {plan.notes.map((note) => (
          <div key={note} className="mt-3">
            <Note>{note}</Note>
          </div>
        ))}
        {estimateSeconds !== null && estimateSeconds > 1800 && (
          <div className="mt-3">
            <Note tone="warn">
              This is a long job on this device. It is measured, not guessed: the app
              timed one tile through the same network before quoting it. Keep the screen
              awake, or drop to 150 DPI, which is a quarter of the work and is what most
              banner printers run at anyway.
            </Note>
          </div>
        )}
      </Card>

      <Button onClick={onStart} className="w-full">
        Upscale
      </Button>
    </div>
  )
}
