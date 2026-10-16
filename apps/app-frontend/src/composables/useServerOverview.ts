import { onUnmounted, ref, type Ref } from 'vue'

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
 * Player head render, by UUID: an isometric **3D** head that includes the
 * hat/second skin layer.
 *
 * Visage's `/head` path was checked against two players — the server's own
 * player and a strongly-hatted skin (Grumm) — and returns an isometric render
 * whose front face carries the white/orange pixels that exist only in the hat
 * layer. It accepts a UUID or a name and returns the identical image either way.
 *
 * Checked and rejected while choosing this: minotar `helm` and `avatar` are
 * flat front faces (no depth), minotar `cube` is isometric but drops the
 * overlay, mc-heads `/avatar` is flat and its UUID lookup once resolved to the
 * wrong skin, and Crafatar answers HTTP 500 for whole players.
 */
export function playerHeadUrl(uuid: string) {
    return `https://visage.surgeplay.com/head/64/${encodeURIComponent(uuid)}`
}

/**
 * Last resort for a player whose UUID the ping did not report, or whose head
 * failed to load: mc-heads' isometric head, which also draws the overlay. Note
 * the argument order — mc-heads takes the player *before* the size, the other
 * way round from Visage above.
 */
export function playerHeadFallbackUrl(name: string) {
    return `https://mc-heads.net/head/${encodeURIComponent(name)}/64`
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
