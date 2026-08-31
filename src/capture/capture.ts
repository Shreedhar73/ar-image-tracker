/**
 * Photo and video capture of the AR view.
 *
 * One canvas holds everything worth capturing: 8th Wall's GlTextureRenderer
 * draws the camera feed into it and three.js renders the character into the
 * same one, so a single canvas grab is already the composited shot. The DOM
 * overlay (buttons, hints, debug panel) is deliberately not in it.
 *
 * The engine creates its GL context with `preserveDrawingBuffer: true`
 * (verified in xr.js), which is why `toBlob` works here at all — on a normal
 * WebGL canvas it would return a blank frame outside the render loop.
 *
 * Web APIs only. XR8.MediaRecorder exists but would drag the 5 MB
 * media-worker.js back into the build for something the platform does natively.
 */

const PHOTO_TYPE = 'image/jpeg'
/** A camera frame is photographic noise; PNG of that is huge and slow to encode. */
const PHOTO_QUALITY = 0.92
const RECORD_FPS = 30
/** The blob is held in memory, and a child will happily hold record forever. */
const MAX_RECORDING_MS = 60_000

/** Safari records mp4, Chrome webm. Detected, never assumed. */
const VIDEO_TYPES = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm']

export interface Capture {
  kind: 'photo' | 'video'
  file: File
  /** Object URL for previewing. Call `releaseCapture` when done with it. */
  url: string
}

export function releaseCapture(capture: Capture): void {
  URL.revokeObjectURL(capture.url)
}

function pickVideoType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return VIDEO_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

export function isRecordingSupported(): boolean {
  return pickVideoType() !== null && typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function toCapture(blob: Blob, kind: Capture['kind'], baseName: string, extension: string): Capture {
  const file = new File([blob], `${baseName}-${stamp()}.${extension}`, {type: blob.type})
  return {kind, file, url: URL.createObjectURL(file)}
}

export async function capturePhoto(canvas: HTMLCanvasElement, baseName: string): Promise<Capture> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, PHOTO_TYPE, PHOTO_QUALITY)
  })
  if (!blob) throw new Error('canvas.toBlob produced nothing')
  return toCapture(blob, 'photo', baseName, 'jpg')
}

export interface RecorderHandlers {
  onResult: (capture: Capture) => void
  onStateChange: (recording: boolean) => void
  onError: (error: unknown) => void
}

export interface Recorder {
  readonly recording: boolean
  start: () => void
  stop: () => void
}

export function createRecorder(
  canvas: HTMLCanvasElement,
  baseName: string,
  handlers: RecorderHandlers,
): Recorder {
  let recorder: MediaRecorder | null = null
  let autoStop: number | null = null

  const clearAutoStop = (): void => {
    if (autoStop !== null) window.clearTimeout(autoStop)
    autoStop = null
  }

  return {
    get recording() {
      return recorder !== null
    },
    start: () => {
      if (recorder) return
      const mimeType = pickVideoType()
      if (!mimeType) {
        handlers.onError(new Error('no supported MediaRecorder video type'))
        return
      }
      try {
        const chunks: Blob[] = []
        const active = new MediaRecorder(canvas.captureStream(RECORD_FPS), {mimeType})
        active.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data)
        }
        active.onstop = () => {
          clearAutoStop()
          recorder = null
          handlers.onStateChange(false)
          const extension = mimeType.includes('mp4') ? 'mp4' : 'webm'
          handlers.onResult(toCapture(new Blob(chunks, {type: mimeType}), 'video', baseName, extension))
        }
        active.onerror = (event) => {
          clearAutoStop()
          recorder = null
          handlers.onStateChange(false)
          handlers.onError(event)
        }
        recorder = active
        // Flush periodically instead of holding one blob until stop, so a long
        // recording does not spike memory on a low-end phone.
        active.start(1000)
        handlers.onStateChange(true)
        autoStop = window.setTimeout(() => recorder?.stop(), MAX_RECORDING_MS)
      } catch (error) {
        recorder = null
        handlers.onError(error)
      }
    },
    stop: () => {
      clearAutoStop()
      recorder?.stop()
    },
  }
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled'

/**
 * Hands the capture to the OS share sheet, falling back to a download.
 *
 * MUST be called straight from a user gesture: Safari drops the activation
 * across an await, so the share button is its own tap rather than something
 * that fires automatically when a recording ends.
 */
export async function shareCapture(capture: Capture): Promise<ShareOutcome> {
  const data: ShareData = {files: [capture.file]}
  if (navigator.canShare?.(data) === true) {
    try {
      await navigator.share(data)
      return 'shared'
    } catch (error) {
      // Closing the share sheet rejects with AbortError. That is a choice, not
      // a failure, and must not fall through to a surprise download.
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      console.warn('[capture] share failed, falling back to download', error)
    }
  }
  const link = document.createElement('a')
  link.href = capture.url
  link.download = capture.file.name
  link.click()
  return 'downloaded'
}
