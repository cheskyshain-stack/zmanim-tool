import { formatDuration } from '../lib/image'
import { describeWake, type WakeStatus } from '../lib/wake-lock'
import { PHASE_LABEL, type Phase } from '../worker/protocol'
import { Button, Card, Note } from './primitives'

// The order the user sees them in. Every one of these is a real stage of the pipeline,
// not a decorative step: preparing cleans the source, upscaling runs the network,
// resizing is the Lanczos step to the exact print size, enhancing is the sharpen pass,
// exporting is the encoder writing rows.
const SEQUENCE: Phase[] = [
  'preparing',
  'loading-model',
  'upscaling',
  'resizing',
  'enhancing',
  'exporting',
]

export function RunStep({
  phase,
  progress,
  detail,
  elapsedSeconds,
  estimateSeconds,
  wake,
  error,
  onCancel,
  onRetry,
}: {
  phase: Phase
  progress: number
  detail: string
  elapsedSeconds: number
  estimateSeconds: number | null
  wake: WakeStatus
  error: string | null
  onCancel: () => void
  onRetry: () => void
}) {
  const percent = Math.min(100, Math.max(0, progress * 100))
  const screen = describeWake(wake)
  // Once a job is a fifth of the way in, its own measured rate beats the up front
  // estimate, so switch to it.
  const remaining =
    progress > 0.02 && elapsedSeconds > 3
      ? (elapsedSeconds / progress) * (1 - progress)
      : estimateSeconds

  if (error) {
    return (
      <div className="space-y-4">
        <Note tone="bad">{error}</Note>
        <Button onClick={onRetry} className="w-full">
          Back to settings
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-lg font-bold">{PHASE_LABEL[phase]}</span>
          <span className="tabular text-2xl font-black">{percent.toFixed(1)}%</span>
        </div>
        <div
          className="h-4 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-ink-800"
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-brand-500 transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-ink-600 dark:text-paper-300">{detail}</p>
        <div className="tabular mt-3 flex justify-between text-sm">
          <span>Elapsed {formatDuration(elapsedSeconds)}</span>
          <span>
            {remaining === null ? '' : `About ${formatDuration(remaining)} left`}
          </span>
        </div>
      </Card>

      <Card>
        <ol className="space-y-2">
          {SEQUENCE.map((step) => {
            const index = SEQUENCE.indexOf(step)
            const current = SEQUENCE.indexOf(phase)
            const state = index < current ? 'done' : index === current ? 'now' : 'todo'
            return (
              <li key={step} className="flex items-center gap-3">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                    state === 'done'
                      ? 'bg-good-500 text-white'
                      : state === 'now'
                        ? 'bg-brand-500 text-white'
                        : 'bg-paper-200 text-ink-600 dark:bg-ink-800 dark:text-paper-300'
                  }`}
                >
                  {state === 'done' ? '✓' : index + 1}
                </span>
                <span
                  className={
                    state === 'todo'
                      ? 'text-ink-600 dark:text-paper-300'
                      : 'font-semibold'
                  }
                >
                  {PHASE_LABEL[step]}
                </span>
              </li>
            )
          })}
        </ol>
      </Card>

      <Note tone={screen.solid ? 'info' : 'warn'}>
        <strong>{screen.text}.</strong> This runs entirely on this device, so leaving the
        browser or locking the phone can suspend it. A desktop or laptop has no such
        limit and is much faster, and this is the same page there.
      </Note>

      <Button variant="danger" onClick={onCancel} className="w-full">
        Cancel
      </Button>
    </div>
  )
}
