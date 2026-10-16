import { get as getSettings } from '@/helpers/settings'
import { isServerLinkedInstance } from '@/helpers/first-run-bootstrap'
import { list } from '@/helpers/instance'
import type { GameInstance } from '@/helpers/types'
import { ServerConfig } from '@/server-config'

/**
 * Which instance supplies the sidebar web map address.
 *
 * The nav rail is global while the setting is stored per instance, so the
 * address is resolved with a fixed rule instead of "the first instance that
 * happens to have one":
 *
 *   1. An instance with an *explicit* stored value wins, in this order:
 *        a. the instance linked to this server (`server_project` /
 *           `server_project_modpack`) — the web map belongs to the server, and
 *           this is the instance the first-run bootstrap creates;
 *        b. the launcher's home instance (`minimal_home_instance_id`) — the
 *           player's explicit "this is the instance I play" choice;
 *        c. any other instance, in backend list order.
 *      An explicitly empty value is a value: it disables the map and is never
 *      replaced by the built-in default, which is what "不填入就隐藏" means once
 *      a player has actually cleared the field.
 *
 *   2. When *no* instance has an explicit value, the built-in default from
 *      `server-config.ts` applies. Existing installs have no stored value at
 *      all, so this is what keeps the map they have always had from silently
 *      vanishing on upgrade. It only applies while unset: saving any value
 *      (including an empty one) takes over permanently.
 *
 * The rule is deliberately independent of "which instance the home page shows",
 * because `minimal_home_instance_id` is only written once a player picks an
 * instance in the home picker and is still `null` on a fresh install — keying
 * the map on it alone would hide the map for every new player.
 */
export function resolveServerWebMapUrl(
    instances: readonly GameInstance[],
    homeInstanceId: string | null | undefined,
): string {
    if (instances.length === 0) return ''

    const ordered = [
        ...instances.filter(isServerLinkedInstance),
        ...instances.filter(
            (instance) => instance.id === homeInstanceId && !isServerLinkedInstance(instance),
        ),
        ...instances.filter(
            (instance) => instance.id !== homeInstanceId && !isServerLinkedInstance(instance),
        ),
    ]

    const configured = ordered.find(hasStoredWebMapUrl)
    if (configured) return normalizeWebMapUrl(configured.web_map_url)

    return ServerConfig.mapUrl.trim()
}

/** Whether this instance has ever had the field saved (empty counts). */
export function hasStoredWebMapUrl(instance: Pick<GameInstance, 'web_map_url'>): boolean {
    return instance.web_map_url !== null && instance.web_map_url !== undefined
}

/** The stored value, or `null` when the instance has never been configured. */
export function getStoredWebMapUrl(
    instance: Pick<GameInstance, 'web_map_url'>,
): string | null {
    if (!hasStoredWebMapUrl(instance)) return null
    return normalizeWebMapUrl(instance.web_map_url)
}

function normalizeWebMapUrl(value: string | null | undefined): string {
    return (value ?? '').trim()
}

/**
 * A map address has to be an absolute http(s) URL: anything else would be
 * stored happily and then fail to load inside the frame with no explanation.
 * Schemeless input like `map.example.com` is rejected on purpose so the stored
 * value is always exactly what the webview will request.
 */
export function isValidWebMapUrl(value: string): boolean {
    let url: URL
    try {
        url = new URL(value.trim())
    } catch {
        return false
    }
    return url.protocol === 'http:' || url.protocol === 'https:'
}

/**
 * Resolve the address outside a component, for the `/map` route guard. Any
 * failure (backend not ready, settings unreadable) resolves to `''`, i.e. "no
 * map", so the route stays unusable instead of rendering a broken frame.
 */
export async function loadServerWebMapUrl(): Promise<string> {
    try {
        const [instances, settings] = await Promise.all([list(), getSettings()])
        return resolveServerWebMapUrl(instances, settings.minimal_home_instance_id)
    } catch {
        return ''
    }
}
