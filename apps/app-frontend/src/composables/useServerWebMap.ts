import { computed, onScopeDispose, ref, type ComputedRef } from 'vue'

import { instance_listener } from '@/helpers/events.js'
import { list } from '@/helpers/instance'
import { resolveServerWebMapUrl } from '@/helpers/server-web-map'
import type { GameInstance } from '@/helpers/types'
import { useTheming } from '@/store/state'

/** Bounded retry for the first read, which can precede backend initialization. */
const REFRESH_RETRIES = 5
const REFRESH_RETRY_DELAY_MS = 400

/**
 * The web map address the nav rail and the map page use.
 *
 * Both read the same resolution rule (see `helpers/server-web-map.ts`) and both
 * have to react to the address being edited in the instance settings, so the
 * instance list is refreshed from the `instance` event the backend already
 * emits for every edit.
 */
export function useServerWebMap(): {
    mapUrl: ComputedRef<string>
    /** False until the first instance list has been read from the backend. */
    loaded: ComputedRef<boolean>
} {
    const themeStore = useTheming()
    const instances = ref<GameInstance[]>([])
    const loaded = ref(false)
    let disposed = false
    let unlisten: (() => void) | null = null
    let retryTimer = 0

    /**
     * `list()` can run before the backend state finishes initializing (this
     * composable is created during App's setup, next to `initialize_state()`),
     * so a failure is retried a few times instead of leaving the map entry
     * permanently hidden for the session.
     */
    async function refresh(attempt = 0) {
        try {
            const next = await list()
            if (disposed) return
            instances.value = next
        } catch {
            // Keep the last known list: a transient backend failure must not
            // make the map entry flicker away.
            if (!disposed && attempt < REFRESH_RETRIES) {
                retryTimer = window.setTimeout(
                    () => void refresh(attempt + 1),
                    REFRESH_RETRY_DELAY_MS * (attempt + 1),
                )
            }
            return
        }
        loaded.value = true
    }

    void refresh()

    async function subscribe() {
        try {
            const stop = await instance_listener(async (event: { event?: string }) => {
                // "synced" is emitted by background sync bookkeeping and carries
                // no instance change, matching how QuickInstanceSwitcher
                // filters it.
                if (event?.event === 'synced') return
                await refresh()
            })
            if (disposed) stop()
            else unlisten = stop
        } catch {
            // Best effort: without the subscription the entry still reflects
            // the value read on mount, it just stops following later edits.
        }
    }

    void subscribe()

    onScopeDispose(() => {
        disposed = true
        window.clearTimeout(retryTimer)
        unlisten?.()
    })

    return {
        loaded: computed(() => loaded.value),
        mapUrl: computed(() =>
            resolveServerWebMapUrl(instances.value, themeStore.minimalHomeInstanceId),
        ),
    }
}
