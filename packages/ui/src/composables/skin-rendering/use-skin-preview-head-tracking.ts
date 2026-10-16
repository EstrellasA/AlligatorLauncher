import { useRenderLoop } from '@tresjs/core'
import * as THREE from 'three'
import { type ComputedRef, onUnmounted, type Ref, ref, watch } from 'vue'

const HEAD_NODE_NAME = 'Head'

/** Full-travel yaw / pitch, in radians, at the edge of the tracking radius. */
const MAX_YAW = THREE.MathUtils.degToRad(25)
const MAX_PITCH = THREE.MathUtils.degToRad(18)

/**
 * Only the part of the pointer offset inside this fraction of the container
 * counts as full travel: a smaller fraction means less pointer movement is
 * needed to turn the head all the way.
 */
const TRACKING_RADIUS_FRACTION = 0.34
/** Floor for the tracking radius, in CSS pixels, for very small containers. */
const MIN_TRACKING_RADIUS = 140

/** Exponential smoothing factor, applied per frame with the frame delta folded in. */
const SMOOTHING_PER_SECOND = 9
/** Delta ceiling, so a stalled tab eases in again instead of jumping. */
const MAX_FRAME_DELTA = 1 / 30

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

type MaybeReadonlyRef<T> = Ref<T> | ComputedRef<T>

/**
 * Turns the model's `Head` node towards the pointer, leaving the rest of the
 * model and the existing drag-to-rotate controls alone.
 *
 * The offset is applied from TresJS's `after` loop stage rather than from the
 * `render` stage the animation mixer uses: the idle clips carry a `Head`
 * rotation track of their own, so the mixer's pose for the frame has to be
 * written first and the tracking offset composed on top of it afterwards.
 *
 * The pointer is tracked over the whole window, not only over the container, so
 * a small widget can follow a cursor that is nowhere near it. `maxRadius` and
 * `verticalCenterOffset` let a host tune how far the pointer has to travel for a
 * full turn.
 */
export function useSkinPreviewHeadTracking({
    enabled,
    scene,
    containerElement,
    maxRadius,
    verticalCenterOffset = 0,
    resetKey,
}: {
    enabled: MaybeReadonlyRef<boolean>
    scene: MaybeReadonlyRef<THREE.Object3D | null>
    containerElement: MaybeReadonlyRef<HTMLElement | null>
    maxRadius?: MaybeReadonlyRef<number | undefined>
    verticalCenterOffset?: MaybeReadonlyRef<number | undefined>
    /** Bump to drop the tracked offset, e.g. when the model variant changes. */
    resetKey?: MaybeReadonlyRef<unknown>
}) {
    /** Where the pointer asks the head to look, in -1..1 on both axes. */
    const pointerTargetX = ref(0)
    const pointerTargetY = ref(0)
    /** Where the head currently is, eased towards the target. */
    const pointerX = ref(0)
    const pointerY = ref(0)

    const orientation = new THREE.Quaternion()
    const restOrientation = new THREE.Quaternion()
    const trackingOrientation = new THREE.Quaternion()
    const trackingEuler = new THREE.Euler(0, 0, 0, 'YXZ')

    let headNode: THREE.Object3D | null = null
    let isListening = false
    let isReducedMotion = true
    let reducedMotionQuery: MediaQueryList | null = null

    /** Re-read the media query once, rather than on every frame. */
    function syncReducedMotion() {
        isReducedMotion =
            typeof window === 'undefined' ||
            typeof window.matchMedia !== 'function' ||
            window.matchMedia(REDUCED_MOTION_QUERY).matches
    }

    function isTrackingActive(): boolean {
        return enabled.value && headNode !== null && !isReducedMotion
    }

    function onPointerMove(event: PointerEvent) {
        const rect = containerElement.value?.getBoundingClientRect()
        if (!rect || rect.width <= 0 || rect.height <= 0) return

        const configuredRadius = maxRadius?.value
        const radius =
            configuredRadius && configuredRadius > 0
                ? configuredRadius
                : Math.max(rect.width, MIN_TRACKING_RADIUS) / TRACKING_RADIUS_FRACTION
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2 + (verticalCenterOffset?.value ?? 0)

        pointerTargetX.value = THREE.MathUtils.clamp((event.clientX - centerX) / radius, -1, 1)
        pointerTargetY.value = THREE.MathUtils.clamp((event.clientY - centerY) / radius, -1, 1)
    }

    function onPointerLeave() {
        pointerTargetX.value = 0
        pointerTargetY.value = 0
    }

    function dropPointerOffset() {
        pointerTargetX.value = 0
        pointerTargetY.value = 0
        pointerX.value = 0
        pointerY.value = 0
    }

    /** Restores the node's rest pose, so the head does not stay turned. */
    function resetOrientation() {
        dropPointerOffset()
        headNode?.quaternion.copy(restOrientation)
    }

    function applyOrientation(yaw: number, pitch: number) {
        if (!headNode) return

        trackingEuler.set(pitch, yaw, 0)
        trackingOrientation.setFromEuler(trackingEuler)
        // Premultiply so the offset is applied on top of the rig's rest pose
        // instead of replacing it.
        orientation.copy(restOrientation).premultiply(trackingOrientation)
        headNode.quaternion.copy(orientation)
    }

    function attachPointerListener() {
        if (isListening) return

        window.addEventListener('pointermove', onPointerMove, { passive: true })
        window.addEventListener('pointerleave', onPointerLeave)
        isListening = true
    }

    function detachPointerListener() {
        if (!isListening) return

        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerleave', onPointerLeave)
        isListening = false
    }

    function reconcileTracking() {
        const sceneRoot = scene.value
        const nextHead = sceneRoot ? (sceneRoot.getObjectByName(HEAD_NODE_NAME) ?? null) : null

        if (nextHead !== headNode) {
            dropPointerOffset()
            headNode = nextHead

            if (headNode) {
                // Captured while the node still holds the pose the GLTF baked in.
                restOrientation.copy(headNode.quaternion)
            } else {
                restOrientation.identity()
            }
        }

        if (!isTrackingActive()) {
            detachPointerListener()
            resetOrientation()
            return
        }

        attachPointerListener()
    }

    function onReducedMotionChange() {
        syncReducedMotion()
        reconcileTracking()
    }

    const { onAfterLoop } = useRenderLoop()
    onAfterLoop(({ delta }) => {
        if (!isTrackingActive()) return

        // Frame-rate independent exponential smoothing: the same time constant
        // applies whatever frame rate the canvas runs at.
        const frameDelta = Math.min(delta, MAX_FRAME_DELTA)
        const weight = 1 - Math.exp(-SMOOTHING_PER_SECOND * frameDelta)

        pointerX.value += (pointerTargetX.value - pointerX.value) * weight
        pointerY.value += (pointerTargetY.value - pointerY.value) * weight
        applyOrientation(pointerX.value * MAX_YAW, -pointerY.value * MAX_PITCH)
    })

    if (typeof window !== 'undefined' && window.matchMedia) {
        reducedMotionQuery = window.matchMedia(REDUCED_MOTION_QUERY)
        reducedMotionQuery.addEventListener('change', onReducedMotionChange)
    }
    syncReducedMotion()

    watch([enabled, scene], reconcileTracking, { immediate: true })

    if (resetKey) {
        watch(resetKey, () => {
            // A different head node is about to be swapped in; drop the old
            // offset so the next model does not start already turned.
            dropPointerOffset()
        })
    }

    onUnmounted(() => {
        reducedMotionQuery?.removeEventListener('change', onReducedMotionChange)
        reducedMotionQuery = null
        detachPointerListener()
        dropPointerOffset()
        headNode = null
    })
}
