/**
 * AnimationMixer plus crossfading between named clips.
 *
 * update() is driven from the pipeline module's onUpdate — there is no rAF
 * loop in this app, because the engine already ticks once per camera frame.
 */
import * as THREE from 'three'

export interface AnimationController {
  /** Names actually present in the GLB, in clip order. */
  readonly available: string[]
  readonly current: string | null
  /** Crossfades to `name`. No-op if the clip is missing or already playing. */
  play: (name: string, fadeSeconds?: number) => void
  /** Advance the mixer. Call once per camera frame. */
  update: (deltaSeconds: number) => void
  stop: () => void
}

export function createAnimationController(
  root: THREE.Object3D,
  clips: THREE.AnimationClip[],
): AnimationController {
  const mixer = new THREE.AnimationMixer(root)
  const actions = new Map<string, THREE.AnimationAction>()

  for (const clip of clips) {
    const action = mixer.clipAction(clip)
    action.setLoop(THREE.LoopRepeat, Infinity)
    actions.set(clip.name, action)
  }

  let current: string | null = null

  return {
    available: clips.map((clip) => clip.name),
    get current() {
      return current
    },
    play: (name, fadeSeconds = 0.25) => {
      if (name === current) return
      const next = actions.get(name)
      if (!next) {
        // A campaign naming a clip the GLB does not have is a config bug, and
        // silently doing nothing makes it invisible until someone films it.
        console.warn(`[animation] clip "${name}" not in GLB; have: ${[...actions.keys()].join(', ')}`)
        return
      }
      const previous = current === null ? undefined : actions.get(current)
      next.reset().setEffectiveWeight(1).fadeIn(fadeSeconds).play()
      previous?.fadeOut(fadeSeconds)
      current = name
    },
    update: (deltaSeconds) => mixer.update(deltaSeconds),
    stop: () => {
      mixer.stopAllAction()
      current = null
    },
  }
}
