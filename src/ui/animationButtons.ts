/** One button per campaign animation, shown only while the sticker is tracked. */
export interface AnimationButtons {
  setVisible: (visible: boolean) => void
  /** Reflects the clip actually playing, including the automatic idle. */
  setActive: (name: string | null) => void
  remove: () => void
}

export function createAnimationButtons(
  root: HTMLElement,
  names: string[],
  onSelect: (name: string) => void,
): AnimationButtons {
  const bar = document.createElement('div')
  bar.className = 'animation-bar'
  bar.hidden = true

  const buttons = new Map<string, HTMLButtonElement>()
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

  root.append(bar)

  return {
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
