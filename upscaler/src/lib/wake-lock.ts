// Keeping the screen on while a render runs.
//
// This is a port of the approach CJ Portal's stopwatch already proved, and it keeps the
// three bugs that one hit written down, because each of them looked fine and was not:
//
//   1. Test `navigator.wakeLock` itself, not `"wakeLock" in navigator`. The key can be
//      present where the value is not, and `.request` then throws.
//   2. A sentinel the system has already let go of is not a lock. Guarding on
//      `if (lock)` meant that once a phone quietly took the lock back, the page could
//      never ask again for the rest of the session, because the release event does not
//      reliably arrive. The flag on the sentinel is the truth.
//   3. Never say "kept awake" when only the fallback is running. A reassuring message
//      over a screen that then goes dark is worse than no message.
//
// The fallback is the trick a video call uses: a tiny video playing a live canvas
// stream. Android keeps the screen lit for playing video, secure context or not. It is
// a hope rather than a promise, and the status says so.
//
// None of this makes the job run in the background. It stops the screen turning itself
// off, which is the thing that most often kills a long render on a phone.

export type AwakeBy = '' | 'lock' | 'video'

export interface WakeStatus {
  awakeBy: AwakeBy
  /** Why the real lock is unavailable, in words a person can act on. */
  error: string
  /** How often the system took the lock back. A climbing count is the phone fighting. */
  retakes: number
}

type Sentinel = {
  released: boolean
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
}

type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> }

function api(): WakeLockApi | null {
  const value = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock
  return value && typeof value.request === 'function' ? value : null
}

export class ScreenWakeLock {
  private lock: Sentinel | null = null
  private awakeBy: AwakeBy = ''
  private error = ''
  private retakes = 0
  private running = false
  private watchdog = 0
  private painter = 0
  private video: HTMLVideoElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private context: CanvasRenderingContext2D | null = null
  private tint = 0
  private notify: (status: WakeStatus) => void = () => {}

  private report(): void {
    this.notify({ awakeBy: this.awakeBy, error: this.error, retakes: this.retakes })
  }

  start(onChange: (status: WakeStatus) => void): void {
    this.notify = onChange
    if (this.running) return
    this.running = true
    this.retakes = 0
    this.request()

    // Not every Android build fires visibilitychange coming back from the app
    // switcher, so listen for the other two as well.
    window.addEventListener('pageshow', this.rearm)
    window.addEventListener('focus', this.rearm)
    document.addEventListener('visibilitychange', this.rearm)

    this.watchdog = window.setInterval(() => {
      if (!this.running) return
      if (this.awakeBy === 'lock' && this.lock && !this.lock.released) return
      if (document.visibilityState !== 'visible') return
      if (this.awakeBy === 'lock') this.retakes++
      this.request()
    }, 3000)
  }

  stop(): void {
    this.running = false
    window.clearInterval(this.watchdog)
    this.watchdog = 0
    window.clearInterval(this.painter)
    this.painter = 0
    window.removeEventListener('pageshow', this.rearm)
    window.removeEventListener('focus', this.rearm)
    document.removeEventListener('visibilitychange', this.rearm)
    if (this.lock) {
      this.lock.release().catch(() => {})
      this.lock = null
    }
    if (this.video) {
      this.video.pause()
      this.video.remove()
      this.video = null
    }
    this.awakeBy = ''
    this.report()
  }

  private rearm = (): void => {
    if (this.running && document.visibilityState === 'visible') this.request()
  }

  private request(): void {
    const wakeLock = api()
    if (!wakeLock) {
      this.error = 'This browser has no screen lock'
      this.startVideoFallback()
      return
    }
    // Lesson 2: a released sentinel is not a lock.
    if (this.lock && !this.lock.released) return
    this.lock = null
    wakeLock
      .request('screen')
      .then((sentinel) => {
        this.lock = sentinel
        this.awakeBy = 'lock'
        this.error = ''
        sentinel.addEventListener('release', () => {
          this.lock = null
          if (this.awakeBy === 'lock') this.awakeBy = ''
          // Chrome drops the lock whenever the page is hidden. Take it back on return.
          if (this.running && document.visibilityState === 'visible') this.request()
        })
        this.report()
      })
      .catch((problem: unknown) => {
        const name = problem instanceof Error ? problem.name : 'error'
        this.error =
          name === 'NotAllowedError'
            ? 'Screen lock refused, which battery saver does'
            : `Screen lock refused (${name})`
        this.startVideoFallback()
      })
  }

  private startVideoFallback(): void {
    try {
      if (!this.video) {
        this.canvas = document.createElement('canvas')
        this.canvas.width = 2
        this.canvas.height = 2
        this.context = this.canvas.getContext('2d')
        const capture = (
          this.canvas as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream }
        ).captureStream
        if (!capture) {
          this.report()
          return
        }
        const video = document.createElement('video')
        video.muted = true
        video.defaultMuted = true
        video.playsInline = true
        video.setAttribute('muted', '')
        video.setAttribute('playsinline', '')
        video.setAttribute('webkit-playsinline', '')
        video.setAttribute('disablepictureinpicture', '')
        video.setAttribute('aria-hidden', 'true')
        // In the page and not display:none, or it does not count as playing. Two
        // pixels in a corner, under everything.
        video.style.cssText =
          'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1'
        video.srcObject = capture.call(this.canvas, 5)
        document.body.appendChild(video)
        this.video = video
      }
      this.paint()
      // The frames have to keep changing or the stream stalls and the browser stops
      // counting it as playback. Nothing else drives a loop here, so this does.
      window.clearInterval(this.painter)
      this.painter = window.setInterval(() => this.paint(), 200)

      const playing = this.video.play()
      if (playing && typeof playing.then === 'function') {
        playing
          .then(() => {
            this.awakeBy = 'video'
            this.report()
          })
          .catch(() => this.report())
      } else {
        this.awakeBy = 'video'
        this.report()
      }
    } catch {
      this.report()
    }
  }

  private paint(): void {
    if (!this.context) return
    this.tint = (this.tint + 1) % 2
    this.context.fillStyle = this.tint ? '#050608' : '#060709'
    this.context.fillRect(0, 0, 2, 2)
  }
}

/** Says what is holding the screen, in words that do not overpromise. */
export function describeWake(status: WakeStatus): { text: string; solid: boolean } {
  if (status.awakeBy === 'lock') {
    return {
      text:
        'Screen kept awake' +
        (status.retakes ? `, re-taken ${status.retakes} time${status.retakes > 1 ? 's' : ''}` : ''),
      solid: true,
    }
  }
  if (status.awakeBy === 'video') {
    return {
      text: `${status.error || 'No screen lock here'}. Trying a fallback, which may not hold.`,
      solid: false,
    }
  }
  return {
    text: status.error || 'This browser will not hold the screen on',
    solid: false,
  }
}
