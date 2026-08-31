/**
 * Shows what was just captured, with one button that shares it.
 *
 * The share is a separate, deliberate tap rather than something that fires the
 * moment a recording stops: Safari discards user activation across an await,
 * and the encode/blob assembly happens in between. It also lets a child see
 * what they got before sending it anywhere.
 */
import type {Capture, ShareOutcome} from '../capture/capture'

export interface CapturePreviewHandlers {
  onShare: (capture: Capture) => Promise<ShareOutcome>
  onClose: (capture: Capture) => void
}

export function showCapturePreview(
  root: HTMLElement,
  capture: Capture,
  handlers: CapturePreviewHandlers,
): void {
  const panel = document.createElement('div')
  panel.className = 'panel capture-preview'

  if (capture.kind === 'photo') {
    const image = document.createElement('img')
    image.src = capture.url
    image.alt = 'Your photo'
    panel.append(image)
  } else {
    const video = document.createElement('video')
    video.src = capture.url
    video.controls = true
    video.playsInline = true
    video.loop = true
    video.muted = true
    void video.play().catch(() => undefined)
    panel.append(video)
  }

  const actions = document.createElement('div')
  actions.className = 'capture-actions'

  const share = document.createElement('button')
  share.className = 'button'
  share.type = 'button'
  share.textContent = 'Share'
  share.addEventListener('click', () => {
    share.disabled = true
    handlers
      .onShare(capture)
      .finally(() => {
        share.disabled = false
      })
      .catch((error: unknown) => console.warn('[capture] share failed', error))
  })

  const close = document.createElement('button')
  close.className = 'button button-quiet'
  close.type = 'button'
  close.textContent = 'Back'
  close.addEventListener('click', () => {
    panel.remove()
    handlers.onClose(capture)
  })

  actions.append(share, close)
  panel.append(actions)
  root.append(panel)
}
