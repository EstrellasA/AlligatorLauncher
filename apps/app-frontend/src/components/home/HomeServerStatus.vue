<script setup lang="ts">
import { PlayIcon, RefreshCwIcon, ServerIcon, SpinnerIcon, UsersIcon } from '@modrinth/assets'
import { Button, defineMessages, formatLoaderLabel, useVIntl } from '@modrinth/ui'
import { computed, onUnmounted, ref, watch } from 'vue'

import { useMinecraftLaunchError } from '@/composables/useMinecraftLaunchError'
import {
    playerHeadFallbackUrl,
    playerHeadUrl,
    serverPlayerKey,
    type ServerPlayer,
    useServerOverview,
} from '@/composables/useServerOverview'
import { trackEvent } from '@/helpers/analytics'
import { generatePlayerHeadBlob } from '@/helpers/rendering/batch-skin-renderer'
import { resolveServerWebMapUrl } from '@/helpers/server-web-map'
import type { GameInstance } from '@/helpers/types'
import { ensureManagedServerWorldExists, start_join_server } from '@/helpers/worlds'
import { ServerConfig } from '@/server-config'
import { handleSevereError } from '@/store/error'

const props = defineProps<{
    instances: GameInstance[]
    /** Instance the bottom bar will launch; joining reuses the same choice. */
    selectedInstanceId?: string | null
}>()

const { formatMessage } = useVIntl()
const handleMinecraftLaunchError = useMinecraftLaunchError()

const messages = defineMessages({
    statusOnline: {
        id: 'app.home.server-status.online',
        defaultMessage: 'Online',
    },
    statusOffline: {
        id: 'app.home.server-status.offline',
        defaultMessage: 'Offline',
    },
    statusChecking: {
        id: 'app.home.server-status.checking',
        defaultMessage: 'Checking...',
    },
    latency: {
        id: 'app.home.server-status.latency',
        defaultMessage: '{latency} ms',
    },
    version: {
        id: 'app.home.server-status.version',
        defaultMessage: 'Minecraft {gameVersion} · {loader} {loaderVersion}',
    },
    playersTitle: {
        id: 'app.home.server-status.players.title',
        defaultMessage: 'Players online',
    },
    playersEmpty: {
        id: 'app.home.server-status.players.empty',
        defaultMessage: 'Nobody is online right now — the world is all yours.',
    },
    playersUnavailable: {
        id: 'app.home.server-status.players.unavailable',
        defaultMessage: 'The server does not publish its player list, so only the count is shown.',
    },
    playersStale: {
        id: 'app.home.server-status.players.stale',
        defaultMessage:
            'The server advertises at most 12 names, so the list can be shorter than the count.',
    },
    playersMore: {
        id: 'app.home.server-status.players.more',
        defaultMessage: '+{count}',
    },
    loading: {
        id: 'app.home.server-status.loading',
        defaultMessage: 'Fetching the latest server status...',
    },
    offlineTitle: {
        id: 'app.home.server-status.offline.title',
        defaultMessage: 'The server is offline right now',
    },
    offlineBody: {
        id: 'app.home.server-status.offline.body',
        defaultMessage:
            'It may be under maintenance — ask in the group chat? The web map often still works.',
    },
    /**
     * The same sentence without the map clause, for when the instance has no web
     * map address — pointing a player at a page the launcher has hidden would be
     * worse than saying nothing.
     */
    offlineBodyNoMap: {
        id: 'app.home.server-status.offline.body.no-map',
        defaultMessage: 'It may be under maintenance — ask in the group chat?',
    },
    refresh: {
        id: 'app.home.server-status.refresh',
        defaultMessage: 'Refresh status',
    },
    join: {
        id: 'app.home.server-status.join',
        defaultMessage: 'Join server',
    },
    joining: {
        id: 'app.home.server-status.joining',
        defaultMessage: 'Joining...',
    },
    joinOffline: {
        id: 'app.home.server-status.join.offline',
        defaultMessage: 'The server is offline right now.',
    },
    joinNoInstance: {
        id: 'app.home.server-status.join.no-instance',
        defaultMessage: 'Choose a home instance before joining the server.',
    },
    joinNotInstalled: {
        id: 'app.home.server-status.join.not-installed',
        defaultMessage: 'This instance is still installing. Join once it is ready.',
    },
})

const MAX_VISIBLE_PLAYERS = 5

const { state, status, players, refreshing, refresh } = useServerOverview()

const selectedInstance = computed(() =>
    props.instances.find((instance) => instance.id === props.selectedInstanceId),
)
const instanceReady = computed(() => selectedInstance.value?.install_stage === 'installed')

/**
 * Whether the offline copy may point at the web map.
 *
 * The address is a per-instance setting resolved by the shared helper, so it can
 * legitimately be empty — the nav entry hides in that case, and this sentence has
 * to stop pointing at a page the player cannot reach.
 */
const webMapUrl = computed(() =>
    resolveServerWebMapUrl(props.instances, props.selectedInstanceId),
)

/**
 * The Server List Ping answer owns the headline number: it is the count the
 * server itself reports, and it needs nothing installed or hosted anywhere.
 */
const onlineCount = computed(() => Math.max(status.value?.players?.online ?? 0, 0))
const latency = computed(() => status.value?.ping ?? null)

const latencyLabel = computed(() => {
    const value = latency.value
    if (typeof value !== 'number' || value < 0) return null
    return formatMessage(messages.latency, { latency: value })
})

/**
 * Loader ids are lowercase (`neoforge`), so the shared label table supplies the
 * brand casing the rest of the app uses (`NeoForge`).
 */
const loaderLabel = computed(() => formatLoaderLabel(ServerConfig.loader))

const versionLine = computed(() =>
    formatMessage(messages.version, {
        gameVersion: ServerConfig.gameVersion,
        loader: loaderLabel.value,
        loaderVersion: ServerConfig.loaderVersion,
    }),
)

const statusLabel = computed(() => {
    if (state.value === 'online') return formatMessage(messages.statusOnline)
    if (state.value === 'offline') return formatMessage(messages.statusOffline)
    return formatMessage(messages.statusChecking)
})

const visiblePlayers = computed(() => players.value.slice(0, MAX_VISIBLE_PLAYERS))
const hiddenPlayerCount = computed(() => Math.max(players.value.length - MAX_VISIBLE_PLAYERS, 0))

/**
 * The names are never a promise that the headline count is fully listed: the
 * Server List Ping sample is capped (vanilla advertises at most 12 names), and
 * it is empty when the server runs with `hide-online-players`. Whenever it
 * cannot cover the count, `playersStale` says so rather than implying the list
 * is complete.
 */
const playerListNote = computed(() => {
    if (state.value !== 'online') return null
    if (players.value.length === 0) return null
    if (players.value.length >= onlineCount.value) return null

    return messages.playersStale
})

/**
 * With nobody listed, the authoritative count decides the copy: a non-zero count
 * with no names means the server keeps its list to itself, not that it is empty.
 */
const emptyPlayerListMessage = computed(() =>
    onlineCount.value > 0 ? messages.playersUnavailable : messages.playersEmpty,
)

/**
 * A head renderer can fail for one player (a miss, or a service hiccup) without
 * failing for the rest, so a failed player falls back to the name-based renderer
 * for the rest of the session. The set is replaced rather than mutated so the
 * template recomputes.
 */
const failedHeads = ref<ReadonlySet<string>>(new Set())

/**
 * Heads are drawn **locally**, the same way the account chip at the top of this
 * page draws its own: `generatePlayerHeadBlob` takes the raw skin, draws the
 * face and then draws the hat layer four pixels larger, so the second layer
 * overhangs the head the way it does in game. A plain third-party head only
 * overlays a face-sized hat, which for a skin whose hair is close in colour to
 * the head reads as one flat layer — which is exactly what players reported.
 *
 * The raw skin comes from Minotar's `/skin` path, which serves the 64x64 texture
 * with `Access-Control-Allow-Origin: *`, so the canvas is not tainted.
 */
const localHeads = ref<ReadonlyMap<string, string>>(new Map())
const pendingHeadRenders = new Map<string, Promise<void>>()
const createdHeadUrls = new Set<string>()

function skinTextureUrl(player: ServerPlayer) {
    return `https://minotar.net/skin/${encodeURIComponent(player.uuid || player.name)}`
}

/**
 * The renderer only accepts a 64x64 texture. Legacy 64x32 skins keep the head
 * and the hat in the same place, so padding the canvas to 64x64 is enough for a
 * head — but they have to be padded first rather than handed over as they are.
 */
async function loadNormalizedSkin(url: string): Promise<string> {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error(`skin texture failed to load: ${url}`))
        img.src = url
    })

    if (image.width === 64 && image.height === 64) return url

    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not get 2D context for the skin texture')

    context.imageSmoothingEnabled = false
    context.drawImage(image, 0, 0)

    const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
    )
    if (!blob) throw new Error('Could not normalise the skin texture')

    const normalizedUrl = URL.createObjectURL(blob)
    createdHeadUrls.add(normalizedUrl)
    return normalizedUrl
}

async function renderHeadLocally(player: ServerPlayer) {
    const key = serverPlayerKey(player)
    if (localHeads.value.has(key) || pendingHeadRenders.has(key)) return

    const render = (async () => {
        try {
            const skinUrl = await loadNormalizedSkin(skinTextureUrl(player))
            const blob = await generatePlayerHeadBlob(skinUrl)
            const url = URL.createObjectURL(blob)
            createdHeadUrls.add(url)
            localHeads.value = new Map(localHeads.value).set(key, url)
        } catch {
            // Unreachable or unusable textures cannot be drawn here; the
            // third-party head below stays the fallback for those players.
        } finally {
            pendingHeadRenders.delete(key)
        }
    })()

    pendingHeadRenders.set(key, render)
    await render
}

watch(
    players,
    (list) => {
        for (const player of list.slice(0, MAX_VISIBLE_PLAYERS)) void renderHeadLocally(player)
    },
    { immediate: true },
)

/**
 * The locally drawn head once it is ready; until then (and for players it cannot
 * draw) the third-party head, which is also the last resort if that image fails.
 */
function playerHeadSrc(player: ServerPlayer) {
    const key = serverPlayerKey(player)
    const local = localHeads.value.get(key)
    if (local) return local

    if (player.uuid && !failedHeads.value.has(key)) return playerHeadUrl(player.uuid)
    return playerHeadFallbackUrl(player.name)
}

function onPlayerHeadError(player: ServerPlayer) {
    const key = serverPlayerKey(player)
    if (failedHeads.value.has(key)) return

    const next = new Set(failedHeads.value)
    next.add(key)
    failedHeads.value = next
}

onUnmounted(() => {
    for (const url of createdHeadUrls) URL.revokeObjectURL(url)
    createdHeadUrls.clear()
    pendingHeadRenders.clear()
})

const joinDisabledReason = computed(() => {
    if (state.value === 'offline') return formatMessage(messages.joinOffline)
    if (!selectedInstance.value) return formatMessage(messages.joinNoInstance)
    if (!instanceReady.value) return formatMessage(messages.joinNotInstalled)
    return undefined
})

const joining = ref(false)

async function joinServer() {
    const instance = selectedInstance.value
    if (!instance || joining.value || joinDisabledReason.value) return

    joining.value = true
    try {
        // Make sure the multiplayer entry exists, then reuse the launcher's
        // normal "join a server" launch path instead of inventing another one.
        await ensureManagedServerWorldExists(
            instance.id,
            ServerConfig.serverName,
            ServerConfig.serverAddress,
        )
        await start_join_server(instance.id, ServerConfig.serverAddress)
        trackEvent('InstanceStart', {
            loader: instance.loader,
            game_version: instance.game_version,
            source: 'HomeServerStatus',
        })
    } catch (error) {
        const handled = await handleMinecraftLaunchError(error, {
            instance_id: instance.id,
            instance_name: instance.name,
        })
        if (!handled) handleSevereError(error, { instanceId: instance.id })
    } finally {
        joining.value = false
    }
}
</script>

<template>
    <section class="server-card" data-onboarding-id="home-server-status">
        <!-- Identity first: the server on the left, refresh aligned with it. -->
        <div class="server-card__top">
            <div class="server-card__heading">
                <span class="server-card__name">
                    <ServerIcon class="size-4 shrink-0" aria-hidden="true" />
                    <span class="truncate">{{ ServerConfig.serverName }}</span>
                </span>

                <button
                    v-tooltip="formatMessage(messages.refresh)"
                    type="button"
                    class="server-card__refresh"
                    :disabled="refreshing"
                    :aria-label="formatMessage(messages.refresh)"
                    @click="refresh({ force: true })"
                >
                    <SpinnerIcon v-if="refreshing" class="size-4 animate-spin" aria-hidden="true" />
                    <RefreshCwIcon v-else class="size-4" aria-hidden="true" />
                </button>
            </div>

            <p class="server-card__version">{{ versionLine }}</p>
        </div>

        <!-- The state carries the line; the latency stays a quiet unit. -->
        <p class="server-card__status">
            <span
                class="server-card__dot"
                :class="`server-card__dot--${state}`"
                aria-hidden="true"
            />
            <span class="server-card__state">{{ statusLabel }}</span>
            <template v-if="latencyLabel">
                <span class="server-card__status-separator" aria-hidden="true">·</span>
                <span class="server-card__latency">{{ latencyLabel }}</span>
            </template>
        </p>

        <!-- Middle of the card: the player heads, or whatever stands in for them. -->
        <div class="server-card__players">
            <span v-if="state === 'loading'" class="server-card__placeholder">
                <SpinnerIcon class="size-5 animate-spin" aria-hidden="true" />
                <span>{{ formatMessage(messages.loading) }}</span>
            </span>

            <template v-else-if="state === 'offline'">
                <span class="server-card__offline-title">
                    {{ formatMessage(messages.offlineTitle) }}
                </span>
                <span class="server-card__offline-body">
                    {{ formatMessage(webMapUrl ? messages.offlineBody : messages.offlineBodyNoMap) }}
                </span>
            </template>

            <template v-else>
                <div v-if="visiblePlayers.length > 0" class="player-row">
                    <span
                        v-for="(player, index) in visiblePlayers"
                        :key="serverPlayerKey(player)"
                        class="player-chip"
                        :style="{ zIndex: index + 1 }"
                    >
                        <img
                            class="player-chip__head"
                            :src="playerHeadSrc(player)"
                            :alt="player.name"
                            :title="player.name"
                            loading="lazy"
                            decoding="async"
                            @error="onPlayerHeadError(player)"
                        />
                        <span class="player-chip__name">{{ player.name }}</span>
                    </span>
                    <span
                        v-if="hiddenPlayerCount > 0"
                        class="player-chip player-chip--more"
                        :style="{ zIndex: visiblePlayers.length + 1 }"
                    >
                        {{ formatMessage(messages.playersMore, { count: hiddenPlayerCount }) }}
                    </span>
                </div>

                <span v-else class="server-card__players-empty">
                    {{ formatMessage(emptyPlayerListMessage) }}
                </span>

                <p v-if="playerListNote" class="server-card__stale">
                    {{ formatMessage(playerListNote) }}
                </p>
            </template>
        </div>

        <!-- Bottom row: the count on the left, the single action on the right. -->
        <div class="server-card__footer">
            <span class="server-card__count">
                <UsersIcon class="size-4 shrink-0" aria-hidden="true" />
                <span class="server-card__count-label">
                    {{ formatMessage(messages.playersTitle) }}
                </span>
                <span class="server-card__count-number">{{ onlineCount }}</span>
            </span>

            <Button
                v-tooltip="joinDisabledReason"
                type="colored"
                color="brand"
                size="lg"
                :disabled="!!joinDisabledReason || joining"
                @click="joinServer"
            >
                <SpinnerIcon v-if="joining" class="animate-spin" aria-hidden="true" />
                <PlayIcon v-else aria-hidden="true" />
                <span class="truncate">{{
                    formatMessage(joining ? messages.joining : messages.join)
                }}</span>
            </Button>
        </div>
    </section>
</template>

<style scoped>
.server-card {
    position: relative;
    display: flex;
    /*
     * The card fills its two-thirds panel inside the middle row of a
     * fixed-height page, and gives way without ever scrolling the page: once its
     * content no longer fits, the card scrolls itself.
     */
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.875rem 1.25rem;

    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;

    /*
     * Glass: a translucent surface under a brand sheen, with a lit top edge.
     * The blur needs something to reveal behind it, which is what the page glow
     * in Index.vue provides. The surface token still follows the user's
     * transparency settings.
     */
    background:
        linear-gradient(
            145deg,
            color-mix(in srgb, var(--color-brand) 15%, transparent),
            color-mix(in srgb, var(--color-brand) 3%, transparent) 45%,
            transparent 100%
        ),
        color-mix(in srgb, var(--surface-card, var(--surface-3)) 55%, transparent);
    backdrop-filter: blur(16px) saturate(135%);
    -webkit-backdrop-filter: blur(16px) saturate(135%);
    border: 1px solid color-mix(in srgb, var(--color-brand) 30%, transparent);
    border-radius: var(--radius-lg);
    box-shadow:
        inset 0 1px 0 color-mix(in srgb, white 10%, transparent),
        0 18px 40px -30px color-mix(in srgb, var(--color-brand) 55%, transparent);
}

.server-card__top {
    display: flex;
    flex-shrink: 0;
    flex-direction: column;
    gap: 0.125rem;
}

.server-card__heading {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
}

.server-card__dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 9999px;
    flex-shrink: 0;
    background: var(--color-text-tertiary);
}

.server-card__dot--online {
    background: var(--color-green);
    animation: server-status-breathe 2s ease-in-out infinite;
}

.server-card__dot--offline {
    background: var(--color-text-tertiary);
    opacity: 0.7;
}

@keyframes server-status-breathe {
    0%,
    100% {
        transform: scale(0.9);
        opacity: 0.7;
        box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-green) 45%, transparent);
    }
    50% {
        transform: scale(1.15);
        opacity: 1;
        box-shadow: 0 0 0 0.3rem color-mix(in srgb, var(--color-green) 0%, transparent);
    }
}

/* The state is the line's weight; the latency is only a measurement. */
.server-card__status {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.375rem;
    margin: 0;
}

.server-card__state {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--color-text-primary);
}

.server-card__status-separator {
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
}

.server-card__latency {
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    color: var(--color-text-tertiary);
}

.server-card__name {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.375rem;
    font-weight: 700;
    color: var(--color-text-primary);
}

.server-card__refresh {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    border: 0;
    border-radius: 9999px;
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition:
        background-color 140ms ease,
        color 140ms ease;
}

.server-card__refresh:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-brand) 12%, transparent);
    color: var(--color-text-primary);
}

.server-card__refresh:disabled {
    cursor: default;
    opacity: 0.6;
}

.server-card__refresh:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--color-brand-shadow);
}

.server-card__version {
    margin: 0;
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
}

/*
 * The middle of the card. The floor is one head (2.25rem) plus a little air, so
 * an empty server still reads as a laid-out row and the region cannot collapse;
 * the extra height comes out of the empty space this area had below the status
 * line. It is also the region that gives way first: the card scrolls itself
 * rather than growing the row.
 */
.server-card__players {
    display: flex;
    flex: 1 1 auto;
    min-height: 2.75rem;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    gap: 0.375rem;
}

.server-card__placeholder {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
}

.server-card__offline-title {
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--color-text-primary);
}

.server-card__offline-body {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
}

.server-card__players-empty {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
}

.server-card__stale {
    margin: 0;
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
    opacity: 0.85;
}

.server-card__footer {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
}

.server-card__count {
    display: flex;
    align-items: center;
    gap: 0.375rem;
}

.server-card__count-label {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
}

.server-card__count-number {
    font-size: 1.125rem;
    font-weight: 800;
    line-height: 1;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
}

/* --- Player heads ------------------------------------------------------- */

.player-row {
    display: flex;
    align-items: center;
    /* The drawn head carries the hat layer as an overhang, so neighbours are
       spaced apart: an overlap would clip the hair of the head underneath. */
    gap: 0.25rem;
}

.player-chip {
    position: relative;
    display: block;
    /* 36px: the local render is 72px (a 64px face plus a 4px hat overhang), so
       this is an exact 2:1 downscale and the visible face stays 32px — the same
       numbers the account chip uses. */
    width: 2.25rem;
    height: 2.25rem;
}

.player-chip__head {
    display: block;
    width: 100%;
    height: 100%;
    /* Both the drawn head and the third-party fallback are pixel art scaled by a
       whole number (or, for the fallback, by ~1.8), so nearest-neighbour keeps
       the skin pixels — and the hat layer — intact. No frame: the account chip
       shows its head bare too. */
    image-rendering: pixelated;
    object-fit: contain;
}

.player-chip--more {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    border: 1px solid color-mix(in srgb, var(--color-brand) 22%, transparent);
    background: color-mix(in srgb, var(--color-brand) 16%, transparent);
    color: var(--color-text-primary);
    font-size: 0.6875rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
}

.player-chip__name {
    position: absolute;
    bottom: calc(100% + 0.375rem);
    left: 50%;
    z-index: 40;
    transform: translateX(-50%) translateY(2px);
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--surface-card, var(--surface-3)) 92%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-brand) 22%, transparent);
    color: var(--color-text-primary);
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition:
        opacity 140ms ease,
        transform 140ms ease;
}

.player-chip:hover .player-chip__name {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
}

@media (prefers-reduced-motion: reduce) {
    .server-card__dot--online {
        animation: none;
        opacity: 1;
        transform: none;
    }

    .player-chip__name {
        transition: none;
    }
}
</style>
