import { invoke } from '@tauri-apps/api/core'
import { basename } from '@tauri-apps/api/path'

import axolotlLogoUrl from '@/assets/axolotl.png'
import { import_plan_listener, install_job_listener } from '@/helpers/events'
import { cancel_import_plan, import_instance, start_import_plan } from '@/helpers/import.js'
import {
    type ImportPlanRequest,
    type ImportPlanSnapshot,
    install_create_instance,
    installJobInstanceId,
    type InstallJobSnapshot,
    type InstallPhaseId,
    wait_for_install_job,
} from '@/helpers/install'
import { cache_icon, edit, edit_icon, get, list } from '@/helpers/instance'
import type { GameInstance, InstanceLoader } from '@/helpers/types'
import {
    ensureManagedServerWorldExists,
    get_instance_worlds,
    resolveManagedServerWorld,
} from '@/helpers/worlds'
import { ServerConfig } from '@/server-config'

/**
 * First-run bootstrap.
 *
 * A player who has never opened this launcher has no instance at all, so the
 * launcher has to build the whole playable environment by itself: create an
 * instance on the versions the server runs, drop the bundled mod jars that make
 * the game start and sync, and register the server so one-click join works.
 *
 * The jars come as two sets with different destinations: the server set (the
 * AutoModpack entry point and the `clientmods/` locator) goes into `mods/`, and
 * the client-only set (Sodium, Colorwheel, Iris, …) goes into `clientmods/`,
 * which the loader only reads because that locator mod registers it. The server
 * pack cannot supply the second set — AutoModpack never distributes what the
 * server does not have — so the launcher installs both here, and an instance is
 * considered incomplete unless *both* folders are complete.
 *
 * The client set is only installed once the server pack is on disk, because
 * several of its jars depend on mods that only the pack delivers
 * (`sablemassview` needs `sable`, `create_cyber_goggles` and `smart_bounds` need
 * `create`). On a brand-new instance AutoModpack has not downloaded anything yet,
 * and seeding `clientmods/` would make NeoForge fail its dependency check before
 * the download can happen — the first launch would crash instead of syncing. The
 * backend decides that precondition and reports it as `deferred`; a deferred set
 * is intentionally missing, never broken, and this launch installs it once the
 * pack exists.
 *
 * Everything here is strictly "only when nothing exists yet": if any instance
 * already links to this server, the flow does nothing at all.
 */

/**
 * Identifies instances created by this bootstrap inside `link.project_id`.
 *
 * This fork does not use Modrinth server projects (`privateModrinthServices` is
 * off), so the value is a local marker rather than a real Modrinth project id.
 * Nothing else in the app dereferences it — the server-project link *type* is
 * what the rest of the app discriminates on.
 */
const SERVER_INSTANCE_LINK_ID = 'alligatorzone-private-server'

/** Link types the rest of the app treats as "this is our server's instance". */
export function isServerLinkedInstance(instance: GameInstance): boolean {
    const type = instance.link?.type
    return type === 'server_project' || type === 'server_project_modpack'
}

/** The instance linked to this server, or null when there is none yet. */
async function findServerLinkedInstance(): Promise<GameInstance | null> {
    const instances = await list()
    return instances.find(isServerLinkedInstance) ?? null
}

/**
 * Whether this launch should ask the player how to get the instance.
 *
 * The question is only for a genuinely first run. A player who already has an
 * instance for this server keeps the existing behaviour: a complete instance
 * does nothing, an incomplete one is repaired silently, and neither ever sees
 * the question. If the instance list cannot be read, the automatic flow's own
 * check stays authoritative — asking here could create a duplicate.
 */
export async function shouldOfferInstallChoice(): Promise<boolean> {
    try {
        return (await findServerLinkedInstance()) === null
    } catch (error) {
        console.error(
            'First-run bootstrap: could not inspect existing instances; not offering the import choice',
            error,
        )
        return false
    }
}

export type FirstRunBootstrapStep =
    | 'checking'
    | 'importing'
    | 'creating-instance'
    | 'installing-mods'
    | 'registering-server'
    | 'done'

/** Stage of the folder preview/import, when the step is `importing`. */
export type FirstRunImportStage = 'scanning' | 'copying'

export interface FirstRunBootstrapProgress {
    step: FirstRunBootstrapStep
    /**
     * True while completing an instance that already existed but was left
     * incomplete (missing one of the jars the game cannot start without).
     */
    repairing: boolean
    /** Completed units reported by the install job, when available. */
    current?: number
    total?: number
    phase?: InstallPhaseId
    /** Folder the bundled-mod step is writing right now (`mods`/`clientmods`). */
    modsFolder?: string
    /** Which half of an import is running, when `step === 'importing'`. */
    importStage?: FirstRunImportStage
    /** Files the import preview has found so far. */
    importedFiles?: number
}

/** What the internal steps report; the flag that is fixed per run is added on top. */
type BootstrapProgressUpdate = Omit<FirstRunBootstrapProgress, 'repairing'>

export interface FirstRunBootstrapResult {
    instanceId: string
    /** False when an instance from an earlier attempt was repaired instead. */
    created: boolean
    /** True when this run completed a pre-existing, incomplete instance. */
    repaired: boolean
    /** True when the instance came from the player's existing installation. */
    imported: boolean
    /**
     * Absolute folders the bundled sets were installed into, in install order:
     * the server pack's `mods` first, the client-only `clientmods` second. A set
     * that was deferred — it waits for AutoModpack to install the server pack —
     * is not listed, because nothing was written to its folder.
     */
    modsDirs: string[]
    copied: number
    replaced: number
    unchanged: number
    /**
     * False when the server could not be added to the instance automatically.
     * Non-fatal: the player can still add it by hand, but it is reported.
     */
    serverRegistered: boolean
}

export type FirstRunBootstrapFailureReason =
    'instance-creation' | 'instance-id-missing' | 'bundled-mods' | 'import'

export class FirstRunBootstrapError extends Error {
    readonly reason: FirstRunBootstrapFailureReason
    readonly originalError: unknown
    /**
     * The instance the failed attempt had already created, when there is one.
     * Letting a retry resume from here is what keeps a half-built instance from
     * being abandoned — the automatic first-run path never resumes, only a
     * player-initiated retry does.
     */
    readonly instanceId: string | null

    constructor(
        reason: FirstRunBootstrapFailureReason,
        message: string,
        originalError?: unknown,
        instanceId: string | null = null,
    ) {
        super(message)
        this.name = 'FirstRunBootstrapError'
        this.reason = reason
        this.originalError = originalError
        this.instanceId = instanceId
    }
}

/**
 * `first-run` is the automatic path. It does nothing at all when a complete
 * instance for this server already exists; when one exists but is missing a jar
 * the game cannot start without, it repairs that instance (and never creates a
 * second one).
 *
 * `retry` is a player-initiated retry behind the failure panel. It reconciles
 * whatever exists instead of bailing out.
 */
export type FirstRunBootstrapMode = 'first-run' | 'retry'

interface BundledModsReport {
    instanceId: string
    modsDir: string
    files: Array<{ fileName: string; status: string; bytes: number }>
    copied: number
    replaced: number
    unchanged: number
    /** True when the set was not installed: it waits for the server pack. */
    deferred: boolean
}

type BundledModState = 'up_to_date' | 'missing' | 'outdated' | 'source_missing'

interface BundledModsStatus {
    instanceId: string
    modsDir: string
    files: Array<{ fileName: string; state: BundledModState }>
    /**
     * True when this set is incomplete — a jar is absent from the instance, or
     * absent from the launcher build itself.
     */
    needsRepair: boolean
    /**
     * True when this set was not inspected because it waits for the server pack,
     * which AutoModpack has not installed into this instance yet. Such a set is
     * intentionally missing, so it never counts as incomplete.
     */
    deferred: boolean
    missing: string[]
    outdated: string[]
    missingSources: string[]
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    return typeof error === 'string' ? error : String(error)
}

/**
 * The bundled sets the launcher ships, in install order, as the folders they
 * belong in.
 *
 * These are the two folders `server-config.ts` owns; the backend resolves each
 * one to the set of jars (and the resource directory) it ships for that folder,
 * and rejects a folder it does not know. Keeping the folders here rather than in
 * Rust is what lets a server be re-pointed by editing one file.
 */
const BUNDLED_MODS_FOLDERS: readonly string[] = [
    ServerConfig.serverModsFolder,
    ServerConfig.clientModsFolder,
]

async function installBundledModsInto(
    instanceId: string,
    modsFolder: string,
): Promise<BundledModsReport> {
    return await invoke<BundledModsReport>('plugin:bootstrap|bootstrap_install_bundled_mods', {
        request: { instanceId, modsFolder },
    })
}

/**
 * Install every bundled set into its own folder.
 *
 * Sequential on purpose: each set is a separate copy, and an error names the
 * folder it failed on instead of hiding behind a concurrent write.
 *
 * A set the backend defers comes back with `deferred: true` and no work done;
 * that is a normal answer, not a failure, so it is only reported for diagnosis.
 */
async function installBundledMods(
    instanceId: string,
    onProgress: (progress: BootstrapProgressUpdate) => void,
): Promise<BundledModsReport[]> {
    const reports: BundledModsReport[] = []
    for (const modsFolder of BUNDLED_MODS_FOLDERS) {
        // Report the folder before writing it so the overlay can name the set
        // that is actually being installed instead of a generic "mods" step.
        onProgress({ step: 'installing-mods', modsFolder })
        reports.push(await installBundledModsInto(instanceId, modsFolder))
    }

    const deferred = reports.filter((report) => report.deferred)
    if (deferred.length > 0) {
        console.info(
            'First-run bootstrap: bundled sets deferred until AutoModpack installs the server pack',
            { instanceId, modsDirs: deferred.map((report) => report.modsDir) },
        )
    }

    return reports
}

/** The folders a bundled set was actually written to. */
function installedModsDirs(reports: BundledModsReport[]): string[] {
    return reports.filter((report) => !report.deferred).map((report) => report.modsDir)
}

/**
 * Ask the backend whether an existing instance is still missing any bundled
 * jar, for every set. Read-only: it creates, copies and removes nothing.
 */
async function bundledModsStatus(
    instanceId: string,
    modsFolder: string,
): Promise<BundledModsStatus> {
    return await invoke<BundledModsStatus>('plugin:bootstrap|bootstrap_bundled_mods_status', {
        request: { instanceId, modsFolder },
    })
}

async function bundledModsStatuses(instanceId: string): Promise<BundledModsStatus[]> {
    const statuses: BundledModsStatus[] = []
    for (const modsFolder of BUNDLED_MODS_FOLDERS) {
        statuses.push(await bundledModsStatus(instanceId, modsFolder))
    }
    return statuses
}

/**
 * The sets that are still incomplete.
 *
 * A verdict from *either* set counts. The server set alone cannot start the
 * game — the client-only rendering stack lives in `clientmods/`, and Flywheel
 * comes up without a backend without it — so checking only `mods/` would leave
 * exactly the broken instance a repair exists to fix.
 *
 * A deferred set is excluded no matter what: it waits for the server pack, so
 * its jars are meant to be absent on this launch, and repairing it would report
 * something as broken that the launcher itself postpones on purpose. That is
 * also why the first launch installs `mods/` only.
 */
function incompleteSets(statuses: BundledModsStatus[]): BundledModsStatus[] {
    return statuses.filter((status) => status.needsRepair && !status.deferred)
}

/** Sum one result bucket across every bundled set that was installed. */
function countBundledMods(
    reports: BundledModsReport[],
    bucket: 'copied' | 'replaced' | 'unchanged',
): number {
    return reports.reduce((total, report) => total + report[bucket], 0)
}

async function hasManagedServerWorld(instanceId: string): Promise<boolean> {
    const worlds = await get_instance_worlds(instanceId)
    return (
        resolveManagedServerWorld(worlds, ServerConfig.serverName, ServerConfig.serverAddress) !=
        null
    )
}

/**
 * Cached icon path for the instance this bootstrap owns, or null when the
 * artwork could not be prepared (never fatal: the instance is still created).
 *
 * The logo is the launcher's own asset, so the bytes come from the frontend
 * bundle and are handed to the instance icon cache. That is the same storage
 * `instance_edit_icon` writes to, it works identically in a packaged install
 * (no `resource_dir`, no working-directory or absolute path anywhere), and it
 * needs no second copy of the image in the repository. `instance_cache_icon` is
 * content addressed, so this is also idempotent.
 */
let instanceIconPathPromise: Promise<string | null> | null = null

function resolveInstanceIconPath(): Promise<string | null> {
    instanceIconPathPromise ??= (async () => {
        try {
            const response = await fetch(axolotlLogoUrl)
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }
            const bytes = Array.from(new Uint8Array(await response.arrayBuffer()))
            return await cache_icon('alligatorzone.png', bytes)
        } catch (error) {
            console.error('First-run bootstrap: could not prepare the instance icon', error)
            return null
        }
    })()
    return instanceIconPathPromise
}

/**
 * Give the logo to an instance the bootstrap created earlier that has no icon
 * at all, for example one built before this icon existed.
 *
 * It never replaces an icon: an instance that already carries one (a player's
 * choice, or a project icon) keeps it, and no instance other than the
 * server-linked one this bootstrap owns is ever passed in here.
 */
async function ensureInstanceIcon(
    instanceId: string,
    currentIconPath: string | null | undefined,
): Promise<void> {
    if (currentIconPath) return

    const iconPath = await resolveInstanceIconPath()
    if (!iconPath) return

    try {
        await edit_icon(instanceId, iconPath)
    } catch (error) {
        // Non-fatal: the instance keeps the generic placeholder.
        console.error('First-run bootstrap: could not set the instance icon', error)
    }
}

/**
 * Build the playable environment for a first-time player.
 *
 * In `first-run` mode this resolves to `null` without changing anything when a
 * complete instance for this server already exists. An instance that exists but
 * is missing a jar the game cannot start without is repaired instead — that is
 * the only case in which an existing instance is written to. `retry` mode is
 * only used behind an explicit player action.
 */
export async function runFirstRunBootstrap(
    onProgress: (progress: FirstRunBootstrapProgress) => void,
    mode: FirstRunBootstrapMode = 'first-run',
): Promise<FirstRunBootstrapResult | null> {
    const newInstanceProgress = (progress: BootstrapProgressUpdate) =>
        onProgress({ ...progress, repairing: false })
    const repairProgress = (progress: BootstrapProgressUpdate) =>
        onProgress({ ...progress, repairing: true })

    newInstanceProgress({ step: 'checking' })

    const existing = await findServerLinkedInstance()

    if (existing && mode === 'first-run') {
        // An instance already exists, so this launch must not create a second
        // one and must not touch a working setup. The only thing it may do is
        // finish an instance that was left incomplete — one that is missing a
        // jar the game cannot start without, in either set. That is keyed off
        // the actual file state of both folders, never off "we ran before".
        let statuses: BundledModsStatus[]
        try {
            statuses = await bundledModsStatuses(existing.id)
        } catch (error) {
            // The instance exists but its files cannot be inspected (moved or
            // unreadable instance directory). Doing nothing keeps the strict
            // "never touch an existing instance" rule; the launcher still runs.
            console.error(
                'First-run bootstrap: could not inspect the existing instance, leaving it untouched',
                error,
            )
            return null
        }

        const incomplete = incompleteSets(statuses)
        if (incomplete.length === 0) return null

        console.warn('First-run bootstrap: instance is missing required mods, repairing it', {
            instanceId: existing.id,
            sets: incomplete.map((status) => ({
                modsDir: status.modsDir,
                missing: status.missing,
                missingSources: status.missingSources,
            })),
        })
        // Instances built before the logo existed have no icon at all; this
        // only fills that gap and never replaces an icon a player chose.
        await ensureInstanceIcon(existing.id, existing.icon_path)
        return await finishBootstrap(existing.id, {
            created: false,
            repaired: true,
            onProgress: repairProgress,
        })
    }

    let instanceId: string
    let created = false
    if (existing) {
        // Retry after a failed attempt: finish the instance that is already
        // there instead of creating a second one.
        instanceId = existing.id
        await ensureInstanceIcon(existing.id, existing.icon_path)
    } else {
        newInstanceProgress({ step: 'creating-instance' })
        instanceId = await createServerInstance(newInstanceProgress)
        created = true
    }

    return await finishBootstrap(instanceId, {
        created,
        repaired: !created,
        onProgress: created ? newInstanceProgress : repairProgress,
    })
}

/**
 * Create the instance on the exact versions the server runs and link it to this
 * server, waiting for the install job to finish.
 */
async function createServerInstance(
    onProgress: (progress: BootstrapProgressUpdate) => void,
): Promise<string> {
    // The instance is created with the launcher's own logo, exactly like an
    // instance created from a project gets that project's icon.
    const iconPath = await resolveInstanceIconPath()

    let job: InstallJobSnapshot
    try {
        job = await install_create_instance({
            name: ServerConfig.serverName,
            gameVersion: ServerConfig.gameVersion,
            // ServerConfig keeps these as plain strings so the whole file stays
            // editable without touching types; the backend validates them
            // against its own loader metadata.
            loader: ServerConfig.loader as InstanceLoader,
            loaderVersion: ServerConfig.loaderVersion,
            iconPath,
            link: {
                type: 'server_project',
                project_id: SERVER_INSTANCE_LINK_ID,
            },
        })
    } catch (error) {
        throw new FirstRunBootstrapError('instance-creation', errorMessage(error), error)
    }

    const instanceId = installJobInstanceId(job)
    if (!instanceId) {
        throw new FirstRunBootstrapError(
            'instance-id-missing',
            `Install job ${job.job_id} did not report an instance id`,
        )
    }

    // Subscribe before waiting so no progress event is missed; the job keeps
    // reporting phase/progress while `wait_for_install_job` blocks.
    let unlisten: (() => void) | null = null
    try {
        unlisten = await install_job_listener((updated: InstallJobSnapshot) => {
            if (updated.job_id !== job.job_id) return
            onProgress({
                step: 'creating-instance',
                current: updated.progress?.current,
                total: updated.progress?.total,
                phase: updated.phase,
            })
        })

        await wait_for_install_job(job.job_id)
    } catch (error) {
        throw new FirstRunBootstrapError(
            'instance-creation',
            errorMessage(error),
            error,
            instanceId,
        )
    } finally {
        unlisten?.()
    }

    return instanceId
}

/**
 * Seeds the per-instance web map address on the instance this launcher exists
 * for, so a fresh install shows the map out of the box.
 *
 * Only a freshly created instance is seeded. An install that already exists
 * keeps whatever is stored, and when nothing is stored at all the resolver in
 * `helpers/server-web-map.ts` applies the same built-in default — so this is
 * about recording the value, not about making the map appear.
 */
async function prefillServerWebMapUrl(instanceId: string): Promise<void> {
    const mapUrl = ServerConfig.mapUrl.trim()
    if (!mapUrl) return

    try {
        await edit(instanceId, { web_map_url: mapUrl })
    } catch (error) {
        // Non-fatal: while the value stays unset the built-in default applies.
        console.error('First-run bootstrap: saving the web map address failed', error)
    }
}

/** Copy the bundled mods and register the server for an existing instance. */
async function finishBootstrap(
    instanceId: string,
    options: {
        created: boolean
        repaired: boolean
        imported?: boolean
        /** Seed the instance's web-map address even when it was not created here. */
        prefillWebMap?: boolean
        onProgress: (progress: BootstrapProgressUpdate) => void
    },
): Promise<FirstRunBootstrapResult> {
    const { created, repaired, imported = false, prefillWebMap, onProgress } = options

    if (created || prefillWebMap) await prefillServerWebMapUrl(instanceId)

    onProgress({ step: 'installing-mods' })

    let reports: BundledModsReport[]
    try {
        reports = await installBundledMods(instanceId, onProgress)
    } catch (error) {
        throw new FirstRunBootstrapError('bundled-mods', errorMessage(error), error, instanceId)
    }

    onProgress({ step: 'registering-server' })

    let serverRegistered = false
    try {
        await ensureManagedServerWorldExists(
            instanceId,
            ServerConfig.serverName,
            ServerConfig.serverAddress,
        )
        serverRegistered = await hasManagedServerWorld(instanceId)
    } catch (error) {
        console.error('First-run bootstrap: adding the server failed', error)
    }

    onProgress({ step: 'done' })

    return {
        instanceId,
        created,
        repaired,
        imported,
        modsDirs: installedModsDirs(reports),
        copied: countBundledMods(reports, 'copied'),
        replaced: countBundledMods(reports, 'replaced'),
        unchanged: countBundledMods(reports, 'unchanged'),
        serverRegistered,
    }
}

/** The player canceled the first-run import; nothing was written. */
export class FirstRunImportCanceledError extends Error {
    constructor() {
        super('The import was canceled')
        this.name = 'FirstRunImportCanceledError'
    }
}

/** Upper bound for the read-only folder preview; the import job has its own. */
const IMPORT_PLAN_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Wait for the read-only import preview (`start_import_plan`), reporting the
 * scan as it finds files. The plan validates the folder and says how much will
 * be copied or downloaded before anything is written; cancelling it leaves no
 * trace, which is why the overlay only offers cancellation during this stage.
 */
async function previewImportPlan(
    request: ImportPlanRequest,
    onProgress: (progress: FirstRunBootstrapProgress) => void,
    signal?: AbortSignal,
): Promise<ImportPlanSnapshot> {
    let settle: ((snapshot: ImportPlanSnapshot) => void) | null = null
    let fail: ((error: unknown) => void) | null = null
    const done = new Promise<ImportPlanSnapshot>((resolve, reject) => {
        settle = resolve
        fail = reject
    })

    let finished = false
    let unlisten: (() => void) | null = null
    const finish = (callback: () => void) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        signal?.removeEventListener('abort', onAbort)
        unlisten?.()
        callback()
    }
    const succeed = (snapshot: ImportPlanSnapshot) => finish(() => settle?.(snapshot))
    const rejectPlan = (error: unknown) => finish(() => fail?.(error))
    const onAbort = () => {
        void cancel_import_plan(request.requestId).catch(() => {})
        rejectPlan(new FirstRunImportCanceledError())
    }
    const timeout = setTimeout(() => {
        void cancel_import_plan(request.requestId).catch(() => {})
        rejectPlan(
            new FirstRunBootstrapError(
                'import',
                `Inspecting the selected folder did not finish within ${IMPORT_PLAN_TIMEOUT_MS / 60_000} minutes`,
            ),
        )
    }, IMPORT_PLAN_TIMEOUT_MS)

    if (signal?.aborted) {
        onAbort()
        return await done
    }

    try {
        unlisten = await import_plan_listener((snapshot: ImportPlanSnapshot) => {
            if (snapshot.requestId !== request.requestId) return
            if (snapshot.stage === 'error') {
                rejectPlan(
                    new FirstRunBootstrapError(
                        'import',
                        snapshot.error ?? 'The selected folder could not be inspected',
                    ),
                )
                return
            }
            if (snapshot.stage === 'done') {
                succeed(snapshot)
                return
            }
            onProgress({
                step: 'importing',
                repairing: false,
                importStage: 'scanning',
                importedFiles: snapshot.modCount,
                current: snapshot.cache.files + snapshot.local.files + snapshot.network.files,
            })
        })

        if (signal?.aborted) {
            onAbort()
            return await done
        }

        signal?.addEventListener('abort', onAbort, { once: true })
        await start_import_plan(request)
    } catch (error) {
        rejectPlan(
            new FirstRunBootstrapError(
                'import',
                `The selected folder could not be inspected: ${errorMessage(error)}`,
                error,
            ),
        )
    }

    return await done
}

/**
 * Run the existing import pipeline (`import_instance` → install job) and wait
 * for it, reporting per-file progress. `Generic` with the server's own
 * versions covers a copied `.minecraft`, a launcher folder with a nested
 * `.minecraft`, and a bare instance folder alike.
 */
async function importInstanceFromFolder(
    sourcePath: string,
    folderName: string,
    onProgress: (progress: FirstRunBootstrapProgress) => void,
): Promise<string> {
    let job: InstallJobSnapshot
    try {
        job = await import_instance(
            'Generic',
            sourcePath,
            folderName,
            false,
            sourcePath,
            ServerConfig.gameVersion,
            ServerConfig.loader,
            ServerConfig.loaderVersion,
            null,
        )
    } catch (error) {
        throw new FirstRunBootstrapError(
            'import',
            `The existing installation could not be imported: ${errorMessage(error)}`,
            error,
        )
    }

    const instanceId = installJobInstanceId(job)
    if (!instanceId) {
        throw new FirstRunBootstrapError(
            'import',
            `Import job ${job.job_id} did not report an instance id`,
        )
    }

    // Subscribe before waiting so no progress event is missed; the job keeps
    // reporting its own file counts while `wait_for_install_job` blocks.
    let unlisten: (() => void) | null = null
    try {
        unlisten = await install_job_listener((updated: InstallJobSnapshot) => {
            if (updated.job_id !== job.job_id) return
            onProgress({
                step: 'importing',
                repairing: false,
                importStage: 'copying',
                current: updated.progress?.current,
                total: updated.progress?.total,
                phase: updated.phase,
            })
        })

        await wait_for_install_job(job.job_id)
    } catch (error) {
        throw new FirstRunBootstrapError(
            'import',
            `The existing installation could not be imported: ${errorMessage(error)}`,
            error,
            instanceId,
        )
    } finally {
        unlisten?.()
    }

    return instanceId
}

/**
 * Bring an imported instance up to the same standard as a downloaded one:
 * linked to this server, carrying the launcher icon, self-healed for the
 * bundled sets, and with the server world registered.
 */
async function finishImportedInstance(
    instanceId: string,
    onProgress: (progress: FirstRunBootstrapProgress) => void,
): Promise<FirstRunBootstrapResult> {
    const report = (progress: BootstrapProgressUpdate) =>
        onProgress({ ...progress, repairing: false })

    // A player's own icon wins; this only fills a missing one, exactly like the
    // repair path does for instances created before the logo existed.
    const instance = await get(instanceId).catch(() => null)
    await ensureInstanceIcon(instanceId, instance?.icon_path)

    // Link first: if anything after this fails, a retry finds the instance and
    // finishes it instead of importing a second copy.
    try {
        await edit(instanceId, {
            link: { type: 'server_project', project_id: SERVER_INSTANCE_LINK_ID },
        })
    } catch (error) {
        throw new FirstRunBootstrapError(
            'import',
            `The imported instance could not be linked to ${ServerConfig.serverName}: ${errorMessage(error)}`,
            error,
            instanceId,
        )
    }

    // Same self-heal as any other instance: an imported install may be missing
    // the server set's jars, or the client set AutoModpack never ships.
    let statuses: BundledModsStatus[]
    try {
        statuses = await bundledModsStatuses(instanceId)
    } catch (error) {
        throw new FirstRunBootstrapError(
            'import',
            `The imported instance could not be inspected: ${errorMessage(error)}`,
            error,
            instanceId,
        )
    }
    const incomplete = incompleteSets(statuses)
    if (incomplete.length > 0) {
        console.warn(
            'First-run bootstrap: imported instance is missing bundled mods, repairing it',
            {
                instanceId,
                sets: incomplete.map((status) => ({
                    modsDir: status.modsDir,
                    missing: status.missing,
                    missingSources: status.missingSources,
                })),
            },
        )
    }

    return await finishBootstrap(instanceId, {
        created: false,
        repaired: incomplete.length > 0,
        imported: true,
        prefillWebMap: true,
        onProgress: report,
    })
}

/**
 * Import the player's existing installation as this server's instance.
 *
 * This is the `start_import_plan` → preview → `import_instance` →
 * `wait_for_install_job` flow the creation UI uses, followed by the same
 * finishing steps as a fresh install (link, icon, bundled sets, server world).
 * Cancelling before the copy starts (`FirstRunImportCanceledError`) creates no
 * instance and writes nothing.
 */
export async function runFirstRunImport(
    sourcePath: string,
    onProgress: (progress: FirstRunBootstrapProgress) => void,
    signal?: AbortSignal,
): Promise<FirstRunBootstrapResult> {
    const report = (progress: BootstrapProgressUpdate) =>
        onProgress({ ...progress, repairing: false })

    report({ step: 'importing', importStage: 'scanning' })

    const folderName = (await basename(sourcePath).catch(() => '')) || 'imported'
    const request: ImportPlanRequest = {
        requestId: `first-run-import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        launcherType: 'Generic',
        basePath: sourcePath,
        instanceFolder: folderName,
        instancePath: sourcePath,
        gameVersion: ServerConfig.gameVersion,
        loader: ServerConfig.loader,
        loaderVersion: ServerConfig.loaderVersion,
    }

    const preview = await previewImportPlan(request, report, signal)
    if (signal?.aborted) throw new FirstRunImportCanceledError()

    console.info('First-run bootstrap: importing an existing installation', {
        sourcePath,
        mods: preview.modCount,
        files: preview.cache.files + preview.local.files + preview.network.files,
    })

    const instanceId = await importInstanceFromFolder(sourcePath, folderName, report)
    return await finishImportedInstance(instanceId, report)
}
