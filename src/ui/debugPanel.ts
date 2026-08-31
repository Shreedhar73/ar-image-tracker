/** Only mounted with ?debug=1. Kids must never see this. */
export interface DebugPanel {
  set: (key: string, value: string) => void
}

export function isDebugEnabled(search: string): boolean {
  return new URLSearchParams(search).get('debug') === '1'
}

export function createDebugPanel(root: HTMLElement): DebugPanel {
  const element = document.createElement('pre')
  element.className = 'debug-panel'
  root.append(element)

  const rows = new Map<string, string>()
  return {
    set: (key, value) => {
      rows.set(key, value)
      element.textContent = [...rows].map(([k, v]) => `${k}: ${v}`).join('\n')
    },
  }
}
