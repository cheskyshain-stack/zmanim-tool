import { useRef, useState } from 'react'
import { ACCEPT_ATTRIBUTE, decodeImage, formatBytes, type DecodedImage } from '../lib/image'
import { ratioLabel } from '../lib/aspect'
import { Button, Card, Note, Stat } from './primitives'

export function UploadStep({
  source,
  thumbnail,
  onLoaded,
  onNext,
}: {
  source: DecodedImage | null
  thumbnail: string | null
  onLoaded: (image: DecodedImage) => void
  onNext: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      onLoaded(await decodeImage(file))
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            void handleFiles(event.dataTransfer.files)
          }}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-paper-300 px-4 py-10 text-center dark:border-ink-700"
        >
          <span className="text-4xl" aria-hidden>
            {busy ? '...' : '+'}
          </span>
          <span className="text-lg font-bold">
            {busy ? 'Reading image' : source ? 'Choose a different image' : 'Choose an image'}
          </span>
          <span className="text-sm text-ink-600 dark:text-paper-300">
            JPG, PNG or WEBP, straight from the camera roll
          </span>
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </Card>

      {error && <Note tone="bad">{error}</Note>}

      {source && thumbnail && (
        <>
          <Card className="!p-0 overflow-hidden">
            <img
              src={thumbnail}
              alt="The image you chose"
              className="checkerboard block max-h-[46vh] w-full object-contain"
            />
          </Card>
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="Dimensions"
              value={`${source.width.toLocaleString()} x ${source.height.toLocaleString()}`}
            />
            <Stat
              label="Aspect ratio"
              value={ratioLabel(source.width, source.height)}
            />
            <Stat
              label="Megapixels"
              value={`${((source.width * source.height) / 1e6).toFixed(1)} MP`}
            />
            <Stat label="File size" value={formatBytes(source.bytes)} />
          </div>
          {source.orientation !== 1 && (
            <Note>
              This photo carried an EXIF rotation tag, which has been applied. The
              dimensions above are the way the image actually looks, not the way the
              file stores it.
            </Note>
          )}
          <Button onClick={onNext} className="w-full">
            Choose print size
          </Button>
        </>
      )}
    </div>
  )
}
