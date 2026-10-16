<script setup lang="ts">
import { defineMessages, SkinPreviewRenderer, useVIntl } from '@modrinth/ui'
import { computed, onUnmounted, ref, useTemplateRef } from 'vue'

// 登录前用的默认史蒂夫皮肤（替代原来的手绘贴图）
import defaultSteveSkin from '@/assets/default-steve.png'

const { formatMessage } = useVIntl()

const messages = defineMessages({
    openSkinSelector: {
        id: 'app.server.avatar.open-skin-selector',
        defaultMessage: 'Change your skin',
    },
})

/** Widget width as a fraction of its height, giving the model room to turn. */
const AVATAR_ASPECT = 1.1
/** Height of the 3D preview, in CSS pixels, at scale 1. */
const AVATAR_HEIGHT_PER_SCALE = 40
/**
 * Camera zoom relative to the renderer's full-body auto-fit.
 *
 * 1 = the whole figure fits exactly inside the canvas. Anything above 1 crops
 * it: the previous value of 1.5 clipped the head off the top. 1.25 keeps the
 * figure comfortably inside the frame while still reading as a character.
 *
 * Deliberately NOT derived from `scale` — changing the widget's on-screen size
 * must not also change how tightly the model is cropped.
 */
const FIT_ZOOM = 1.25
/**
 * Pointer travel from the avatar's centre, in CSS pixels, that turns the head
 * all the way in one direction. Smaller than the renderer's default so a cursor
 * only a few hundred pixels away already moves the head.
 */
const HEAD_TRACKING_RADIUS = 460
/** Last-resort reveal, so a model that never loads cannot hide the widget. */
const MODEL_REVEAL_TIMEOUT_MS = 8000

const props = withDefaults(
    defineProps<{
        /** Current player skin: the 64x64 PNG data URL `get_normalized_skin_texture` returns. */
        textureSrc?: string | null
        /** Skin model: CLASSIC uses 4px arms, SLIM 3px. */
        variant?: 'CLASSIC' | 'SLIM'
        /** Overall size multiplier for the widget. */
        scale?: number
    }>(),
    {
        textureSrc: null,
        variant: 'CLASSIC',
        scale: 3,
    },
)

const emit = defineEmits<{ select: [] }>()

const avatarHeight = computed(() => `${props.scale * AVATAR_HEIGHT_PER_SCALE}px`)
const avatarWidth = computed(
    () => `${Math.round(props.scale * AVATAR_HEIGHT_PER_SCALE * AVATAR_ASPECT)}px`,
)
const avatarZoom = FIT_ZOOM

/**
 * 未登录 / 皮肤未加载时用的兜底贴图：真正的默认史蒂夫皮肤。
 * 早期版本这里是 canvas 手绘的，只填了几个正面矩形，
 * 模型一转角度身体就是透明的 —— 看起来像坏掉了。
 */
const fallbackTexture = defaultSteveSkin

const texture = computed(() => props.textureSrc || fallbackTexture)

/**
 * The renderer builds its scene asynchronously and paints its own "Loading..."
 * label while it does. Keep the flat placeholder on top until the canvas has
 * faded in, so the corner never shows a half-built model or a stray caption.
 */
const isModelVisible = ref(false)
const avatarRoot = useTemplateRef<InstanceType<typeof SkinPreviewRenderer>>('avatarRoot')
let revealTimeout = 0
let canvasObserver: MutationObserver | null = null

function revealModel() {
    isModelVisible.value = true
    canvasObserver?.disconnect()
    canvasObserver = null
}

function observeModelCanvas() {
    const canvas = avatarRoot.value?.$el?.querySelector('canvas')
    if (!canvas) return

    if (canvas.classList.contains('opacity-100')) {
        revealModel()
        return
    }

    canvasObserver = new MutationObserver(() => {
        if (canvas.classList.contains('opacity-100')) revealModel()
    })
    canvasObserver.observe(canvas, { attributes: true, attributeFilter: ['class'] })
}

function onRendererMounted() {
    // The canvas only exists once the renderer has mounted, and the last-resort
    // timeout keeps a model that never loads from hiding the widget for good.
    revealTimeout = window.setTimeout(revealModel, MODEL_REVEAL_TIMEOUT_MS)
    observeModelCanvas()
}

onUnmounted(() => {
    if (revealTimeout) window.clearTimeout(revealTimeout)
    canvasObserver?.disconnect()
    canvasObserver = null
})
</script>

<template>
    <button
        v-tooltip="formatMessage(messages.openSkinSelector)"
        type="button"
        class="skin-avatar"
        :aria-label="formatMessage(messages.openSkinSelector)"
        @click="emit('select')"
    >
        <span class="skin-avatar-scene" :style="{ height: avatarHeight, width: avatarWidth }">
            <SkinPreviewRenderer
                ref="avatarRoot"
                class="skin-avatar-model"
                :class="{ 'is-visible': isModelVisible }"
                :texture-src="texture"
                :variant="variant"
                framing="modal"
                :fit-zoom="avatarZoom"
                :initial-rotation="Math.PI / 8"
                head-tracking
                :head-tracking-radius="HEAD_TRACKING_RADIUS"
                @vue:mounted="onRendererMounted"
            />
            <span v-if="!isModelVisible" class="skin-avatar-placeholder" aria-hidden="true" />
        </span>
    </button>
</template>

<style scoped>
.skin-avatar {
    position: fixed;
    /* Keep clear of the left navigation rail. */
    left: calc(var(--left-bar-width, 4.5rem) + 1rem);
    bottom: 1rem;
    z-index: 30;

    display: block;
    padding: 0.5rem;
    border: 0;
    border-radius: 0.75rem;
    background: transparent;
    cursor: pointer;
    transition:
        transform 160ms ease,
        background-color 160ms ease;
}

.skin-avatar:hover {
    background: var(--surface-3);
    transform: translateY(-2px) scale(1.04);
}

.skin-avatar:active {
    transform: translateY(0) scale(0.98);
}

.skin-avatar:focus-visible {
    outline: none;
    box-shadow: 0 0 0 4px var(--color-brand-shadow);
}

.skin-avatar-scene {
    position: relative;
    display: block;
    /* Turning the head must not paint outside the widget. */
    overflow: hidden;
    border-radius: 0.5rem;
    /* The model renders onto a transparent canvas, so give it a soft floor. */
    background: radial-gradient(
        60% 55% at 50% 64%,
        color-mix(in srgb, var(--color-brand) 12%, transparent),
        transparent 100%
    );
}

.skin-avatar-placeholder {
    position: absolute;
    inset: 0;
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--surface-3) 60%, transparent);
}

/* The renderer draws its own "Loading..." label; the placeholder replaces it. */
.skin-avatar-model :deep(.absolute.inset-0.flex) {
    display: none;
}

.skin-avatar-model {
    opacity: 0;
    transition: opacity 400ms ease;
}

.skin-avatar-model.is-visible {
    opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
    .skin-avatar,
    .skin-avatar-model {
        transition: none;
    }
}
</style>
