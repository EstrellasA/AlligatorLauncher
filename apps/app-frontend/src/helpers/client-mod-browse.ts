/**
 * ALLIGATORZONE content-browser policy.
 *
 * The launcher's Browse surface exists to add **client-side mods** to an
 * instance. The server pack owns `mods/` (written by AutoModpack), so every
 * install issued from Browse has to target the launcher-managed `clientmods/`
 * folder instead, and the Modrinth search has to be locked to mods that are
 * usable on the client.
 *
 * The multiplayer / server verticals (server modpack selection and server
 * content management) browse through the same `/browse/:projectType` route.
 * They are not part of the "browse content into my instance" flow, so they are
 * left intact and are identified by their route markers
 * (`sid` / `wid` / `from`) or by their project type.
 */

/** The only project type the launcher's content browser offers. */
export const BROWSE_LOCKED_PROJECT_TYPE = 'mod'

/** Canonical route of the locked Browse surface. */
export const BROWSE_LOCKED_PROJECT_PATH = `/browse/${BROWSE_LOCKED_PROJECT_TYPE}`

/**
 * `ProjectType` serde token (`clientmod` → `clientmods/`) accepted by the
 * Rust install commands as an explicit, opt-in destination folder.
 */
export const CLIENT_MOD_TARGET_PROJECT_TYPE = 'clientmod'

/**
 * Project types the multiplayer verticals still browse. Their entry points do
 * not always carry `sid` / `wid` / `from` (the server creation flow pushes a
 * bare `/browse/modpack`), so they have to be exempted explicitly.
 */
export const SERVER_VERTICAL_PROJECT_TYPES: readonly string[] = ['modpack', 'server']

/** Query markers that always mean "this Browse visit belongs to a server". */
const SERVER_BROWSE_QUERY_KEYS = ['sid', 'wid', 'from'] as const

/**
 * Modrinth v3 `/search` `new_filters` clause that keeps only projects whose
 * `client_side` is `required` or `optional`, i.e. every mod a player can
 * actually run on the client.
 *
 * Verified against the live v3 endpoint: `client_side` is a real facet field
 * with the `required` / `optional` / `unsupported` / `unknown` values, and
 * `client_side IN [required, optional]` returns exactly the same total as the
 * equivalent v2 `client_side:required OR client_side:optional` facet pair.
 * (The v3 `environment` field used by the launcher's own server filters is
 * narrower — it drops `client_and_server` — so it is not used here.)
 */
export const CLIENT_SIDE_FACET = 'client_side IN [`required`, `optional`]'

export interface BrowseRouteContext {
    sid?: unknown
    wid?: unknown
    from?: unknown
}

function hasValue(value: unknown): boolean {
    return value !== undefined && value !== null && value !== ''
}

/**
 * Whether this Browse visit is part of a server/multiplayer flow that keeps
 * its own project-type scope.
 */
export function isServerBrowseVisit(
    projectType: string | undefined,
    query: BrowseRouteContext,
): boolean {
    if (SERVER_BROWSE_QUERY_KEYS.some((key) => hasValue(query[key]))) return true
    return SERVER_VERTICAL_PROJECT_TYPES.includes(projectType ?? '')
}

/**
 * The project type Browse must actually use: the requested one inside a server
 * flow, `mod` everywhere else.
 */
export function resolveBrowseProjectType(
    projectType: string | undefined,
    query: BrowseRouteContext,
): string {
    return isServerBrowseVisit(projectType, query)
        ? (projectType ?? BROWSE_LOCKED_PROJECT_TYPE)
        : BROWSE_LOCKED_PROJECT_TYPE
}

/**
 * Appends the client-side facet to a Modrinth search request string.
 *
 * The existing filters are parenthesised before the `AND` so an expression
 * that already contains an `OR` group keeps its meaning.
 */
export function withClientSideFacet(requestParams: string): string {
    const params = new URLSearchParams(
        requestParams.startsWith('?') ? requestParams.slice(1) : requestParams,
    )
    const existing = params.get('new_filters')?.trim() ?? ''
    params.set(
        'new_filters',
        existing ? `(${existing}) AND ${CLIENT_SIDE_FACET}` : CLIENT_SIDE_FACET,
    )
    const query = params.toString()
    return query ? `?${query}` : ''
}

/**
 * The destination folder a content install has to use.
 *
 * `mod` content goes to the launcher-managed `clientmods/` folder; every other
 * content type keeps the backend's provider-derived folder.
 */
export function clientModInstallTarget(
    contentType: string | null | undefined,
): typeof CLIENT_MOD_TARGET_PROJECT_TYPE | undefined {
    return contentType === 'mod' ? CLIENT_MOD_TARGET_PROJECT_TYPE : undefined
}

/** Folder the launcher manages for the player's own mods. */
export const CLIENT_MODS_FOLDER = 'clientmods'

/** Folder the server pack owns; the launcher must never install into it. */
export const SERVER_MODS_FOLDER = 'mods'

/** Whether an instance-relative path lives in the launcher-managed `clientmods/`. */
export function isClientModsPath(relativePath: string | null | undefined): boolean {
    return !!relativePath && relativePath.startsWith(`${CLIENT_MODS_FOLDER}/`)
}

/** Whether an instance-relative path lives in the server pack's `mods/`. */
export function isServerModsPath(relativePath: string | null | undefined): boolean {
    return !!relativePath && relativePath.startsWith(`${SERVER_MODS_FOLDER}/`)
}

/**
 * The instance folder an install of this content type belongs in, or
 * `undefined` when there is no single folder to compare against.
 *
 * Only `mod` is locked down here: browsed mods go to `clientmods/`, and a copy
 * the server pack ships in `mods/` must neither block the install nor be
 * removed by it. Every other content type keeps the backend's own folder rules
 * (`resourcepacks/`, `datapacks/`, `shaderpacks/`, world-scoped data packs), so
 * they are left unconstrained.
 */
export function installFolderForContentType(
    contentType: string | null | undefined,
): string | undefined {
    return clientModInstallTarget(contentType) ? CLIENT_MODS_FOLDER : undefined
}

/**
 * Whether a recorded instance file counts as "already installed" for a new
 * install of `contentType`.
 *
 * A server-pack copy of a mod is not installed as far as the content browser is
 * concerned: AlligatorZone Core lets the server copy win at load time and the
 * mod list shows an advisory conflict badge, so the player may still install
 * their own version into `clientmods/`. The reverse still holds — anything
 * already in `clientmods/` counts.
 */
export function isInstalledForContentType(
    relativePath: string | null | undefined,
    contentType: string | null | undefined,
): boolean {
    const folder = installFolderForContentType(contentType)
    if (!folder) return true
    return !!relativePath && relativePath.startsWith(`${folder}/`)
}

/**
 * The installed-content snapshot entries that may block a new content-browser
 * install.
 *
 * Server-pack `mods/` entries are dropped: AlligatorZone Core lets the server
 * copy win at load time, so a player may still add their own version of the
 * same mod to `clientmods/`, and treating the pack copy as an existing install
 * would reject that selection as a duplicate. Anything already in `clientmods/`
 * — and every other project type — is kept, so a real duplicate is still
 * caught.
 */
export function installedSnapshotItems<
    T extends { projectType: string; expectedRelativePath: string },
>(items: readonly T[]): T[] {
    return items.filter(
        (item) => !(item.projectType === 'mod' && isServerModsPath(item.expectedRelativePath)),
    )
}

/**
 * Whether this instance is linked to the server pack (the ALLIGATORZONE server
 * project) rather than to an ordinary Modrinth / CurseForge / imported modpack.
 *
 * This is about the **provenance of the pack**, which is why it stays link-based:
 * it gates flows that rewrite the pack's own members by version (the modpack
 * update), and those must keep working for ordinary imported modpacks, which are
 * not server packs. It is deliberately *not* the rule for who owns `mods/` — see
 * `isServerModsContent`.
 */
export function isServerManagedInstance(
    instance: { link?: { type?: string } | null } | null | undefined,
): boolean {
    const type = instance?.link?.type
    return type === 'server_project' || type === 'server_project_modpack'
}

/**
 * Whether this content item lives in the server pack's `mods/` folder.
 *
 * **The folder is the rule, not the instance link.** A row is server-owned
 * content when its project type is `mod` — a type the backend derives from the
 * parent folder for every listed file, with `clientmods/` rows typed `clientmod`
 * — or when its own path is under `mods/`.
 *
 * Measured on real launcher databases before choosing this rule:
 * an instance whose link is `unmanaged` reports **zero** `pack_managed` rows
 * while its `mods/` folder is the server's all the same (AutoModpack syncs it
 * from inside the game, so the launcher never records a pack there), and the
 * `imported_modpack` instances report 100% `pack_managed`. The link kind does not
 * track who owns the folder; the folder does. This is also the rule this module
 * is built on — "the server pack owns `mods/`" — which is why *every* browse
 * install already targets `clientmods/`, on every instance.
 *
 * Everything the launcher must not write to inside `mods/` hangs off this
 * predicate: the per-row write protection, the bulk filters, and the write
 * functions themselves. `clientmods/` and every other folder stay fully
 * writable.
 */
export function isServerModsContent(item: {
    project_type?: string | null
    file_path?: string | null
}): boolean {
    return item.project_type === 'mod' || isServerModsPath(item.file_path)
}

/**
 * The project-type override a **manual** add (file picker or drag & drop) has to
 * pass to `add_project_from_path`, or `undefined` to keep the backend's own
 * folder rules.
 *
 * Mod content always targets `clientmods/`, the same destination the content
 * browser uses on every instance: a jar added by hand must not enter the server's
 * `mods/` folder, which AutoModpack treats as player-editable and preserves.
 * Every other content type keeps resolving its own folder.
 */
export function manualAddTargetProjectType(
    contentType: string | null | undefined,
): typeof CLIENT_MOD_TARGET_PROJECT_TYPE | undefined {
    return clientModInstallTarget(contentType)
}

/**
 * The content type a manual add can infer from a file name, before the archive
 * is parsed. Only a jar is unambiguous; everything else returns `undefined` so
 * the backend keeps choosing its folder.
 */
export function manualAddContentTypeFromPath(filePath: string): string | undefined {
    return /\.jar$/i.test(filePath) ? BROWSE_LOCKED_PROJECT_TYPE : undefined
}

/**
 * Project type token for the server pack's own `mods/` folder, for the
 * folder-scoped installed-project lookup
 * (`get_installed_project_ids(instanceId, [SERVER_PACK_PROJECT_TYPE])`).
 */
export const SERVER_PACK_PROJECT_TYPE = 'mod'

/**
 * The key the backend uses for a project in the folder-scoped installed-project
 * list: CurseForge ids are provider-qualified, Modrinth ids are bare.
 */
export function installedProjectKey(provider: string, projectId: string | number): string {
    return provider === 'curseforge' ? `curseforge:${projectId}` : String(projectId)
}

/**
 * The projects the server pack already provides in its own `mods/` folder.
 *
 * `installedInMods` is the folder-scoped list from
 * [`SERVER_PACK_PROJECT_TYPE`], so a project that only exists in `clientmods/` —
 * the player's own copy, a genuine duplicate the installed/disabled state
 * already handles — never shows up here, and neither does non-mod content:
 * only a mod can be shadowed by the pack. Used to warn *before* an install
 * rather than reporting the clash afterwards in the instance's mod list.
 */
export function projectsProvidedByServerPack<
    T extends { provider: string; projectId: string | number; contentType?: string | null },
>(installedInMods: readonly string[], projects: readonly T[]): T[] {
    const provided = new Set(installedInMods)
    return projects.filter(
        (project) =>
            clientModInstallTarget(project.contentType) !== undefined &&
            provided.has(installedProjectKey(project.provider, project.projectId)),
    )
}
