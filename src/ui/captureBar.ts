/** Shutter and record toggle, laid out like a phone camera app. */
export interface CaptureBar {
  setVisible: (visible: boolean) => void
  setRecording: (recording: boolean) => void
  remove: () => void
}

export interface CaptureBarHandlers {
  onPhoto: () => void
  onToggleRecord: () => void
  /** False hides the record button entirely rather than offering a dead control. */
  recordingSupported: boolean
}

export function createCaptureBar(root: HTMLElement, handlers: CaptureBarHandlers): CaptureBar {
  const bar = document.createElement('div')
  bar.className = 'capture-bar'
  bar.hidden = true

  const shutter = document.createElement('button')
  shutter.className = 'shutter'
  shutter.type = 'button'
  shutter.setAttribute('aria-label', 'Take a photo')
  shutter.addEventListener('click', handlers.onPhoto)
  bar.append(shutter)

  const record = document.createElement('button')
  record.className = 'record'
  record.type = 'button'
  record.setAttribute('aria-label', 'Record a video')
  record.setAttribute('aria-pressed', 'false')
  record.addEventListener('click', handlers.onToggleRecord)
  if (handlers.recordingSupported) bar.append(record)

  root.append(bar)

  return {
    setVisible: (visible) => {
      bar.hidden = !visible
    },
    setRecording: (recording) => {
      record.setAttribute('aria-pressed', String(recording))
      record.setAttribute('aria-label', recording ? 'Stop recording' : 'Record a video')
    },
    remove: () => bar.remove(),
  }
}
