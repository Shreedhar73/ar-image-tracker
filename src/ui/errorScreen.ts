/**
 * One screen, one action. Every failure path in the app ends here.
 *
 * Camera-denied and unsupported-browser are the two cases that must work;
 * the rest exist so nothing can fail silently into a black screen.
 */
export type ErrorKind =
  | 'unknown-campaign'
  | 'camera-denied'
  | 'unsupported-browser'
  | 'in-app-browser'
  | 'assets-missing'
  | 'unknown'

interface ErrorCopy {
  title: string
  body: string
  action: string | null
}

const COPY: Record<ErrorKind, ErrorCopy> = {
  'unknown-campaign': {
    title: 'Sticker not recognised',
    body: 'This link does not match any sticker. Check the QR code on the sticker and scan it again.',
    action: null,
  },
  'camera-denied': {
    title: 'Camera is switched off',
    body: 'Allow camera access for this page, then try again. On iPhone: Settings › Safari › Camera › Allow.',
    action: 'Try again',
  },
  'unsupported-browser': {
    title: 'This browser cannot do AR',
    body: 'Open this page in Safari on iPhone, or Chrome on Android.',
    action: null,
  },
  'in-app-browser': {
    title: 'Open in your browser',
    body: 'The camera does not work inside this app. Tap the menu and choose "Open in browser".',
    action: null,
  },
  'assets-missing': {
    title: 'This sticker is not ready yet',
    body: 'We could not load the artwork for this sticker. Please try again in a moment.',
    action: 'Try again',
  },
  unknown: {
    title: 'Something went wrong',
    body: 'Please try again.',
    action: 'Try again',
  },
}

export function showErrorScreen(root: HTMLElement, kind: ErrorKind, detail?: string): void {
  if (detail !== undefined) console.error(`[error:${kind}]`, detail)

  const copy = COPY[kind]
  const panel = document.createElement('div')
  panel.className = 'panel'

  const title = document.createElement('h1')
  title.textContent = copy.title
  const body = document.createElement('p')
  body.textContent = copy.body
  panel.append(title, body)

  if (copy.action !== null) {
    const button = document.createElement('button')
    button.className = 'button'
    button.type = 'button'
    button.textContent = copy.action
    button.addEventListener('click', () => location.reload())
    panel.append(button)
  }

  root.append(panel)
}

/** WebGL plus getUserMedia are the hard requirements; without either, no AR. */
export function detectUnsupported(): ErrorKind | null {
  if (isInAppBrowser()) return 'in-app-browser'
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported-browser'
  const probe = document.createElement('canvas')
  const gl = probe.getContext('webgl2') ?? probe.getContext('webgl')
  return gl ? null : 'unsupported-browser'
}

/**
 * Social-app webviews. A QR scanned from inside Instagram or Facebook lands
 * here, and their webviews either block getUserMedia or drop the stream.
 */
function isInAppBrowser(): boolean {
  return /FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|TikTok/i.test(navigator.userAgent)
}
