/**
 * The wire contract of `instance_get_automodpack_changelog`.
 *
 * ## Why this is a separate, dependency-free module
 *
 * The update-notes page once crashed with `Cannot read properties of undefined
 * (reading 'length')` because the Rust command serialises camelCase while the
 * page read snake_case. The types lived next to the `invoke` wrapper in
 * `helpers/instance.ts`, whose module graph reaches `@/` aliases and Tauri, so
 * no plain `node --test` file could import them and the mismatch was never
 * exercised.
 *
 * This file therefore has **no imports at all**. It holds the payload types, the
 * key-name pin, and the runtime guard, so `automodpack-payload.test.ts` can
 * check them directly. Keep it that way: adding an import here removes the only
 * place the contract is testable.
 *
 * `helpers/instance.ts` re-exports everything below, so callers keep importing
 * from there.
 */

/** What a published generation did to one file. */
export type AutomodpackChangeKind = 'added' | 'changed' | 'removed'

/** One file a generation touched. `path` is `/`-separated and instance-relative. */
export interface AutomodpackChange {
    path: string
    kind: AutomodpackChangeKind
    /** Absent when the file was added. */
    fromSha1?: string
    /** Absent when the file was removed. */
    toSha1?: string
    fromSize: number
    toSize: number
}

/**
 * Non-mod changes folded by top-level directory. A first publish can touch
 * hundreds of script or config files, so the page shows `count` with a bounded
 * sample rather than a flat list.
 */
export interface AutomodpackDirectoryGroup {
    /** Top-level directory name; `''` collects files sitting at the instance root. */
    directory: string
    count: number
    added: number
    changed: number
    removed: number
    samplePaths: string[]
    samplesTruncated: boolean
}

/**
 * One published AutoModpack generation.
 *
 * `modPaths` is the whole reason the update-notes page can render project
 * cards: each entry is a real instance-relative path such as
 * `mods/Jade-1.21.1-NeoForge-15.10.5.jar`, which is handed to
 * `get_content_items_by_paths` to recover the project, icon and author. A reader
 * that returned only counts or hashes could not produce a card.
 */
export interface AutomodpackGeneration {
    seq: number
    /** ISO-8601 UTC, exactly as the server wrote it. */
    createdAt: string
    /** Operator-authored patch notes; empty means this generation has none. */
    notes: string
    contentToken: string
    /** Journal sequence this generation restores; absent for a normal publish. */
    restoreOf?: number
    changedFiles: number
    modPaths: string[]
    /** Every file the generation touched, with its kind. */
    changes: AutomodpackChange[]
    directories: AutomodpackDirectoryGroup[]
}

export type AutomodpackUnavailableReason =
    | 'not_installed'
    | 'no_selected_pack'
    | 'history_missing'

/** The server's published generation history, read from disk with no network. */
export interface AutomodpackChangelog {
    /** False for the ordinary "nothing published here yet" states. */
    available: boolean
    modpackId?: string
    /** Present exactly when `available` is false. */
    unavailableReason?: AutomodpackUnavailableReason
    /** Newest first. */
    generations: AutomodpackGeneration[]
    /** Journal lines ignored because they could not be parsed (a torn tail). */
    skippedLines: number
}

/**
 * Compile-time pin on the serialised key set.
 *
 * Each list is checked against the interface's own `keyof`, so a property that
 * stops existing — or a new one left out of this record — is a build error. The
 * values are what the Rust structs actually emit; the Rust side asserts the same
 * spelling in
 * `api::instance::automodpack::tests::the_serialised_keys_match_the_frontend_type`.
 */
export const AUTOMODPACK_WIRE_SHAPE = {
    changelog: [
        'available',
        'modpackId',
        'unavailableReason',
        'generations',
        'skippedLines',
    ] as const satisfies readonly (keyof AutomodpackChangelog)[],
    generation: [
        'seq',
        'createdAt',
        'notes',
        'contentToken',
        'restoreOf',
        'changedFiles',
        'modPaths',
        'changes',
        'directories',
    ] as const satisfies readonly (keyof AutomodpackGeneration)[],
    change: [
        'path',
        'kind',
        'fromSha1',
        'toSha1',
        'fromSize',
        'toSize',
    ] as const satisfies readonly (keyof AutomodpackChange)[],
    directoryGroup: [
        'directory',
        'count',
        'added',
        'changed',
        'removed',
        'samplePaths',
        'samplesTruncated',
    ] as const satisfies readonly (keyof AutomodpackDirectoryGroup)[],
} as const

/**
 * Whether a value looks like the payload the command promises.
 *
 * A Tauri command can return anything if it is registered under a name whose
 * shape changed, and `invoke` is typed rather than validated — the cast in
 * `get_automodpack_changelog` would happily hand the page `undefined` for
 * `generations`. The page treats that as "no history" instead of throwing.
 */
export function isAutomodpackChangelog(value: unknown): value is AutomodpackChangelog {
    if (typeof value !== 'object' || value === null) return false
    const candidate = value as Partial<AutomodpackChangelog>
    if (typeof candidate.available !== 'boolean') return false
    return Array.isArray(candidate.generations)
}

/**
 * The payload the page can safely render when the command answered with
 * something else: an ordinary "nothing published here" state, never a throw.
 */
export function emptyAutomodpackChangelog(): AutomodpackChangelog {
    return {
        available: false,
        unavailableReason: 'not_installed',
        generations: [],
        skippedLines: 0,
    }
}

/**
 * Why no history could be shown.
 *
 * `not_installed`, `no_selected_pack` and `history_missing` come from the
 * backend and each mean something different to a player; `unreachable` means
 * the launcher could not even list instances.
 */
export type AutomodpackUnavailable = AutomodpackUnavailableReason | 'unreachable'

/**
 * What the update-notes page should render, once the candidates are resolved.
 *
 * A flat shape rather than a discriminated union, so the page reads
 * `available`, then `generations`, and the narrowing is plain truthiness at the
 * call site.
 */
export interface AutomodpackChangelogView {
    /** True only when a history was found and is safe to render. */
    available: boolean
    /** Set when `available`; the instance the history came from. */
    instanceId?: string
    /** Set when `available`. Always an array, so `.length` is always safe. */
    generations: AutomodpackGeneration[]
    /** Set when `available`. */
    skippedLines: number
    /**
     * How many policy-only republishes were dropped from `generations`.
     *
     * Counted, not silently discarded: the shape of the history is still worth
     * one line of context even though a card for each would be pure noise.
     */
    silentGenerations: number
    /** Set when not `available`; why there is nothing to show. */
    reason?: AutomodpackUnavailable
}

/**
 * Whether a generation says anything to a player.
 *
 * A **policy-only republish** — AutoModpack re-publishing because the pack's
 * rules changed, with `contentToken` unmoved and `changes` empty — carries
 * nothing: no files, no notes. Rendering one produces a large card reading
 * "no files changed" over "no patch notes were published", which is what the
 * user objected to with 「这两个啥都没有为什么要显示」.
 *
 * Both must be empty to hide it. A republish the operator annotated **is**
 * worth showing, so notes alone keep a generation.
 *
 * The reader deliberately still returns these; hiding is a presentation choice,
 * kept here so the backend keeps a complete, honest record of the history.
 */
export function isSilentGeneration(generation: AutomodpackGeneration): boolean {
    const changed = generation.changedFiles ?? 0
    const emptyChanges = (generation.changes?.length ?? 0) === 0
    const noNotes = !generation.notes?.trim()
    return changed === 0 && emptyChanges && noNotes
}

/** The generations worth rendering, in the order the reader returned them. */
export function renderableGenerations(
    generations: readonly AutomodpackGeneration[],
): AutomodpackGeneration[] {
    return generations.filter((generation) => !isSilentGeneration(generation))
}

/** One candidate instance's answer, in the order the page should prefer them. */
export interface AutomodpackCandidate {
    instanceId: string
    /** `null` when the command rejected rather than answering. */
    changelog: AutomodpackChangelog | null
}

/**
 * Folds the per-instance answers into the one state the page renders.
 *
 * The first candidate that has a history wins. Otherwise the most specific
 * reason among the candidates is kept, so "the selected pack's mirror is gone"
 * is not reported as "AutoModpack has never run here". An answer that is not the
 * promised shape is treated as "no history" with the caller's reason, which is
 * what makes a wrong or missing payload an empty page instead of a thrown error
 * — the failure mode that shipped once as
 * `Cannot read properties of undefined (reading 'length')`.
 *
 * Pure on purpose: this is the page's whole state decision, so it is unit tested
 * rather than only reachable through a mounted component.
 */
export function resolveAutomodpackView(
    candidates: readonly AutomodpackCandidate[],
    fallbackReason: AutomodpackUnavailable = 'not_installed',
): AutomodpackChangelogView {
    let reason: AutomodpackUnavailable | null = null

    for (const candidate of candidates) {
        const changelog = candidate.changelog
        if (changelog && isAutomodpackChangelog(changelog) && changelog.available) {
            // `isAutomodpackChangelog` proves this is an array, so a payload that
            // lied about it never reaches the page's `.length`.
            const all = changelog.generations ?? []
            const generations = renderableGenerations(all)
            return {
                available: true,
                instanceId: candidate.instanceId,
                generations,
                skippedLines: changelog.skippedLines ?? 0,
                silentGenerations: all.length - generations.length,
            }
        }
        if (reason === null && changelog?.unavailableReason) {
            reason = changelog.unavailableReason
        }
    }

    return {
        available: false,
        generations: [],
        skippedLines: 0,
        silentGenerations: 0,
        reason: reason ?? fallbackReason,
    }
}
