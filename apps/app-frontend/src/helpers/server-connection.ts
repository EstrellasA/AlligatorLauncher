/**
 * Pure rules for the launcher's global server connection settings.
 *
 * The two values live in the app database (settings page → 服务器) and are
 * resolved in a fixed order:
 *
 *   **stored setting → build-time env value → placeholder**
 *
 * The build-time value exists so a pre-configured binary still works, and the
 * placeholder keeps a launcher with neither from silently connecting to some
 * other server. Keeping these rules dependency-free is deliberate: they are
 * unit-tested directly, and the reactive store in `server-config.ts` must not
 * be the only place that knows the precedence.
 */

/** RFC 2606 reserved domain: resolves nowhere, so a misconfigured build is obvious. */
export const PLACEHOLDER_SERVER_ADDRESS = 'example.invalid'

/** No web map by default; an empty resolved address hides every map entry point. */
export const PLACEHOLDER_WEB_MAP_URL = ''

const MAX_SERVER_ADDRESS_LENGTH = 255
const MAX_WEB_MAP_URL_LENGTH = 2048

export type ServerConnectionSettings = {
    serverAddress: string
    serverMapUrl: string
}

/**
 * A bare Minecraft address: `host` or `host:port`.
 *
 * A scheme (`https://…`) or anything that looks like a URL path would be handed
 * to the ping/join backend verbatim and fail there with a much less useful
 * error, so it is rejected up front. IPv6 without a port is not supported;
 * `[::1]:25565` is.
 */
export function isValidServerAddress(value: string): boolean {
    const trimmed = value.trim()
    if (!trimmed || trimmed.length > MAX_SERVER_ADDRESS_LENGTH) return false
    if (/\s/.test(trimmed)) return false
    if (/[/\\?#@]/.test(trimmed)) return false
    if (trimmed.includes('://')) return false

    const separator = trimmed.lastIndexOf(':')
    if (separator !== -1) {
        const host = trimmed.slice(0, separator)
        const port = trimmed.slice(separator + 1)
        if (!host || !port || !/^\d+$/.test(port)) return false
    }

    return true
}

/** The stored address, or `''` when it is missing or invalid ("not configured"). */
export function normalizeServerAddress(value: unknown): string {
    if (typeof value !== 'string') return ''
    const trimmed = value.trim()
    return isValidServerAddress(trimmed) ? trimmed : ''
}

/**
 * A web map address has to be an absolute http(s) URL: anything else would be
 * stored happily and then fail to load inside the map frame with no
 * explanation. Schemeless input like `map.example.com` is rejected on purpose
 * so the stored value is always exactly what the webview will request.
 */
export function isValidWebMapUrl(value: string): boolean {
    const trimmed = value.trim()
    if (!trimmed || trimmed.length > MAX_WEB_MAP_URL_LENGTH) return false

    let url: URL
    try {
        url = new URL(trimmed)
    } catch {
        return false
    }
    return url.protocol === 'http:' || url.protocol === 'https:'
}

/** The stored map address, or `''` when it is missing or invalid. */
export function normalizeServerMapUrl(value: unknown): string {
    if (typeof value !== 'string') return ''
    const trimmed = value.trim()
    return isValidWebMapUrl(trimmed) ? trimmed : ''
}

/**
 * Resolve the effective address. Only a valid stored value or build-time value
 * can win; an invalid one behaves like "not configured" instead of crashing.
 */
export function resolveServerAddress(
    stored: string | null | undefined,
    buildTime: string | null | undefined,
): string {
    return (
        normalizeServerAddress(stored) ||
        normalizeServerAddress(buildTime) ||
        PLACEHOLDER_SERVER_ADDRESS
    )
}

/** Resolve the effective web map address; `''` means "no map at all". */
export function resolveServerMapUrl(
    stored: string | null | undefined,
    buildTime: string | null | undefined,
): string {
    return (
        normalizeServerMapUrl(stored) || normalizeServerMapUrl(buildTime) || PLACEHOLDER_WEB_MAP_URL
    )
}

/**
 * Whether an address is actually configured.
 *
 * This is the "should the first-run overlay ask for an address?" predicate: a
 * pre-configured build (environment value) and a returning player (saved
 * setting) are both configured and must never see the prompt, while an invalid
 * value is not, so it prompts instead of pinging the placeholder.
 */
export function isServerAddressConfigured(
    stored: string | null | undefined,
    buildTime: string | null | undefined,
): boolean {
    return resolveServerAddress(stored, buildTime) !== PLACEHOLDER_SERVER_ADDRESS
}

/**
 * Whether a map address is usable.
 *
 * Every entry point into the map (nav rail button, `/map` route guard, map
 * page) is gated on this predicate, so an empty address hides the whole
 * feature instead of rendering an empty iframe.
 */
export function isWebMapConfigured(url: string | null | undefined): boolean {
    return typeof url === 'string' && url.trim().length > 0
}
