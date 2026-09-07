import { deviceProfile, type Settings } from '../lib/storage'
import { Button, Card, Label, Note, Segmented, Stat } from './primitives'

/**
 * Settings, including the advanced knobs. They are here rather than in the main flow
 * because the defaults are worked out from the device and almost nobody should need to
 * touch them, but when a job fails for memory on one particular phone these are the two
 * numbers that fix it.
 */
export function SettingsSheet({
  settings,
  update,
  onReset,
  onClose,
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  onReset: () => void
  onClose: () => void
}) {
  const profile = deviceProfile(settings)
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory

  return (
    <div
      className="fixed inset-0 z-20 flex flex-col bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <button
        type="button"
        className="flex-1"
        aria-label="Close settings"
        onClick={onClose}
      />
      <div className="max-h-[88vh] overflow-y-auto rounded-t-2xl bg-paper-100 p-4 pb-[calc(1rem+var(--safe-bottom))] dark:bg-ink-950">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black">Settings</h2>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>

        <div className="space-y-4">
          <Card>
            <Segmented
              label="Appearance"
              value={settings.theme}
              onChange={(theme) => update({ theme })}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </Card>

          <Card>
            <Label>Processing</Label>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Tile size" value={`${profile.tile} px`} />
              <Stat
                label="Working memory"
                value={`${Math.round(profile.bandBudget / 1024 / 1024)} MB`}
              />
              <Stat label="Tile overlap" value={`${profile.pad} px`} />
              <Stat
                label="Device reports"
                value={memory ? `${memory} GB RAM` : 'no RAM figure'}
              />
            </div>
            <div className="mt-3 space-y-3">
              <Segmented
                label="Tile size"
                value={settings.tileOverride ?? 0}
                onChange={(value) => update({ tileOverride: value === 0 ? null : value })}
                options={[
                  { value: 0, label: 'Auto' },
                  { value: 64, label: '64' },
                  { value: 128, label: '128' },
                  { value: 256, label: '256' },
                ]}
                columns={4}
              />
              <Segmented
                label="Working memory"
                value={settings.memoryBudgetMb ?? 0}
                onChange={(value) =>
                  update({ memoryBudgetMb: value === 0 ? null : value })
                }
                options={[
                  { value: 0, label: 'Auto' },
                  { value: 48, label: '48 MB' },
                  { value: 128, label: '128 MB' },
                  { value: 256, label: '256 MB' },
                ]}
                columns={4}
              />
            </div>
            <div className="mt-3">
              <Note>
                Smaller tiles and less working memory make a job slower but let it finish
                on a device that would otherwise run out. If an export fails part way
                through, drop both a step and try again.
              </Note>
            </div>
          </Card>

          <Card>
            <Label>About</Label>
            <p className="text-sm leading-relaxed text-ink-600 dark:text-paper-300">
              Everything runs on this device. Images are never uploaded, there is no
              account and there is no server. The upscaling uses ESRGAN family neural
              networks (residual dense networks trained on DIV2K) running through
              TensorFlow.js on WebGPU or WebGL, and the final resize to the exact print
              size is Lanczos 3. Add this page to your home screen to keep it available
              offline.
            </p>
          </Card>

          <Button variant="secondary" onClick={onReset} className="w-full">
            Reset all settings
          </Button>
        </div>
      </div>
    </div>
  )
}
