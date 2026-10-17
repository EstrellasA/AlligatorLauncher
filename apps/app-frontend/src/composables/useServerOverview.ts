import { onUnmounted, type Ref, ref, watch } from 'vue'

import { get_server_status, type ServerStatus } from '@/helpers/worlds'
import { ServerConfig } from '@/server-config'

/** A player entry as the Server List Ping advertises it. */
export interface ServerPlayer {
    uuid: string
    name: string
}

export type ServerOverviewState = 'loading' | 'online' | 'offline'

/**
 * How often the home page re-reads the server status.
 *
 * The ping is a single protocol round trip and the only source the card needs,
 * so polling stays cheap.
 */
const POLL_INTERVAL_MS = 45_000
/** Hard floor for automatic polling — never ask more often than this. */
const MIN_POLL_INTERVAL_MS = 15_000

/**
 * Player head render, by UUID: the **front face** with the hat/second skin layer
 * composited over it — a Minecraft head icon, viewed straight on.
 *
 * Minotar's `helm` path was checked against the Mojang skin for two players. For
 * a strongly-hatted skin (Grumm, front-face contrast 42.94 between the layers)
 * the render is pixel-identical to the base face with the hat drawn over it —
 * MAE 0.00 against base+hat, 42.94 against base alone — and for the server's own
 * player (contrast 1.90) it also matches base+hat exactly. The render is the 8x8
 * face scaled up, so the caller draws it with `image-rendering: pixelated`.
 *
 * Checked and rejected: visage `/head`, minotar `cube` and mc-heads `/head` are
 * isometric (top and side faces visible — the wrong viewing angle for an icon),
 * minotar `cube` also drops the overlay, and Crafatar answers HTTP 500 for whole
 * players.
 */
export function playerHeadUrl(uuid: string) {
    return `https://minotar.net/helm/${encodeURIComponent(uuid)}/64.png`
}

/**
 * Name-based last resort, for a player the ping gave no UUID for or whose own
 * head failed to load. Deliberately a different service, so an outage at the
 * primary still leaves heads on screen; its avatar is a front face with the
 * overlay too.
 */
export function playerHeadFallbackUrl(name: string) {
    return `https://mc-heads.net/avatar/${encodeURIComponent(name)}/64`
}

/** Stable key for a listed player, tolerant of a missing UUID. */
export function serverPlayerKey(player: ServerPlayer) {
    return player.uuid || `name:${player.name.toLowerCase()}`
}

/**
 * The players the Server List Ping advertises.
 *
 * This is part of the protocol: it needs nothing installed on the server and
 * nothing hosted anywhere, which is what makes the player row survive a change
 * of server provider. It is capped (vanilla sends at most 12 names) and empty
 * when the server runs with `hide-online-players`; both cases are the caller's
 * to explain.
 */
function pingPlayers(status: ServerStatus | null): ServerPlayer[] {
    const sample = status?.players?.sample
    if (!Array.isArray(sample)) return []

    const players: ServerPlayer[] = []
    for (const entry of sample) {
        const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
        if (!name) continue

        players.push({
            uuid: typeof entry?.id === 'string' ? entry.id.trim() : '',
            name,
        })
    }
    return players
}

export interface ServerOverview {
    state: Ref<ServerOverviewState>
    status: Ref<ServerStatus | null>
    players: Ref<ServerPlayer[]>
    /** True when the ping listed at least one name. */
    playersAvailable: Ref<boolean>
    refreshing: Ref<boolean>
    lastUpdatedAt: Ref<number | null>
    refresh: (options?: { force?: boolean }) => Promise<void>
}

/**
 * Polls the Minecraft Server List Ping, which owns everything the home card
 * shows: the online verdict, the latency, the headline count and the player
 * names it advertises.
 *
 * Nothing in here talks to a map service, so the card cannot break when the
 * server is hosted somewhere else.
 */
export function useServerOverview(): ServerOverview {
    const state = ref<ServerOverviewState>('loading')
    const status = ref<ServerStatus | null>(null)
    const players = ref<ServerPlayer[]>([])
    const playersAvailable = ref(false)
    const refreshing = ref(false)
    const lastUpdatedAt = ref<number | null>(null)

    let lastPollStartedAt = 0
    let pollTimer = 0
    let disposed = false

    async function refresh(options: { force?: boolean } = {}) {
        if (disposed || refreshing.value) return

        const now = Date.now()
        if (!options.force && now - lastPollStartedAt < MIN_POLL_INTERVAL_MS) return
        lastPollStartedAt = now
        refreshing.value = true

        try {
            let ping: ServerStatus | null = null
            try {
                ping = await get_server_status(ServerConfig.serverAddress)
            } catch {
                ping = null
            }

            status.value = ping
            state.value = ping ? 'online' : 'offline'
            players.value = pingPlayers(ping)
            playersAvailable.value = players.value.length > 0
            lastUpdatedAt.value = Date.now()
        } finally {
            refreshing.value = false
        }
    }

    function onVisibilityChange() {
        if (document.visibilityState === 'visible') void refresh()
    }

    /**
     * Follow the address saved in 设置 → 服务器 without a restart: the getter
     * reads the reactive store, so changing it re-polls the new server instead
     * of showing the previous server's status until the next interval.
     */
    watch(
        () => ServerConfig.serverAddress,
        () => void refresh({ force: true }),
    )

    void refresh()
    pollTimer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)

    onUnmounted(() => {
        disposed = true
        window.clearInterval(pollTimer)
        document.removeEventListener('visibilitychange', onVisibilityChange)
    })

    return {
        state,
        status,
        players,
        playersAvailable,
        refreshing,
        lastUpdatedAt,
        refresh,
    }
}
