/** "Point at your sticker" — visible whenever the target is not being tracked. */
export interface ScanHint {
  setVisible: (visible: boolean) => void
  remove: () => void
}

export function createScanHint(root: HTMLElement): ScanHint {
  const element = document.createElement('div')
  element.className = 'scan-hint'
  element.textContent = 'Point at your sticker'
  element.hidden = true
  root.append(element)

  return {
    setVisible: (visible) => {
      element.hidden = !visible
    },
    remove: () => element.remove(),
  }
}
