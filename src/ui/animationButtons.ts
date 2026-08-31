/**
 * One button per animation, shown only while a sticker is tracked.
 *
 * The set of buttons is not fixed for the session: a pack holds several
 * stickers with different characters and different clips, so the bar is
 * rebuilt for whichever sticker is currently in view.
 */
export interface AnimationButtons {
  /** Replaces the buttons. No-op if the names are already the ones shown. */
  setNames: (names: string[]) => void
  setVisible: (visible: boolean) => void
  /** Reflects the clip actually playing, including the automatic idle. */
  setActive: (name: string | null) => void
  remove: () => void
}

export function createAnimationButtons(
  root: HTMLElement,
  onSelect: (name: string) => void,
): AnimationButtons {
  const bar = document.createElement('div')
  bar.className = 'animation-bar'
  bar.hidden = true
  root.append(bar)

  const buttons = new Map<string, HTMLButtonElement>()
  let shown: string[] = []

  return {
    setNames: (names) => {
      // Rebuilding on every imagefound would drop the pressed state and flicker
      // the bar each time the child looks back at the same sticker.
      if (names.length === shown.length && names.every((name, i) => name === shown[i])) return
      shown = [...names]
      bar.replaceChildren()
      buttons.clear()
      for (const name of names) {
        const button = document.createElement('button')
        button.className = 'button'
        button.type = 'button'
        button.textContent = name
        button.setAttribute('aria-pressed', 'false')
        button.addEventListener('click', () => onSelect(name))
        buttons.set(name, button)
        bar.append(button)
      }
    },
    setVisible: (visible) => {
      bar.hidden = !visible
    },
    setActive: (active) => {
      for (const [name, button] of buttons) {
        button.setAttribute('aria-pressed', String(name === active))
      }
    },
    remove: () => bar.remove(),
  }
}
