/**
 * The tap that buys us the camera permission prompt.
 *
 * iOS Safari will not grant camera access from a page-load call, so nothing
 * in the AR pipeline may start until this resolves.
 */
export function showStartScreen(root: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const panel = document.createElement('div')
    panel.className = 'panel'
    panel.innerHTML = `
      <h1>Bring your sticker to life</h1>
      <p>Point the camera at your sticker and watch what happens.</p>
    `

    const button = document.createElement('button')
    button.className = 'button'
    button.type = 'button'
    button.textContent = 'Start'
    button.addEventListener(
      'click',
      () => {
        panel.remove()
        resolve()
      },
      {once: true},
    )

    panel.append(button)
    root.append(panel)
  })
}
