<script setup lang="ts">
import { ExternalIcon, GlobeIcon, RefreshCwIcon } from '@modrinth/assets'
import {
    ContentCard as ContentCardItem,
    type ContentCardProject,
    type ContentItem,
    type ContentOwner,
    type ContentRowInlineAction,
    defineMessages,
    useVIntl,
} from '@modrinth/ui'
import { openUrl } from '@tauri-apps/plugin-opener'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import type {
    AutomodpackChangeKind,
    AutomodpackDirectoryGroup,
    AutomodpackGeneration,
    AutomodpackUnavailable,
} from '@/helpers/automodpack-payload'
import { resolveChangelogProjectAction } from '@/helpers/changelog-project-link'
import { get_content_items_by_paths } from '@/helpers/instance'
import { modDisplayName } from '@/helpers/mod-links'
import { loadAutomodpackChangelog } from '@/helpers/server-changelog'

const { formatMessage, locale } = useVIntl()
const router = useRouter()

const messages = defineMessages({
    title: {
        id: 'app.server.changelog.title',
        defaultMessage: 'Pack update notes',
    },
    refresh: { id: 'app.server.changelog.refresh', defaultMessage: 'Refresh' },
    loading: {
        id: 'app.server.changelog.loading',
        defaultMessage: 'Reading the published pack history...',
    },
    errorTitle: {
        id: 'app.server.changelog.load-failed',
        defaultMessage: 'Could not read the update notes.',
    },
    retry: { id: 'app.server.changelog.retry', defaultMessage: 'Try again' },
    generationLabel: {
        id: 'app.server.changelog.generation',
        defaultMessage: 'Generation {seq}',
    },
    publishedOn: {
        id: 'app.server.changelog.published',
        defaultMessage: 'Published {date}',
    },
    restoreBadge: {
        id: 'app.server.changelog.restore',
        defaultMessage: 'Rollback of generation {seq}',
    },
    noNotes: {
        id: 'app.server.changelog.no-notes',
        defaultMessage: 'No patch notes were published with this generation.',
    },
    changedFiles: {
        id: 'app.server.changelog.changed-files',
        defaultMessage:
            '{count, plural, =0 {No files changed} one {# file changed} other {# files changed}}',
    },
    modsHeading: {
        id: 'app.server.changelog.mods-heading',
        defaultMessage: 'Mods',
    },
    modsLoading: {
        id: 'app.server.changelog.mods-loading',
        defaultMessage: 'Loading mod details...',
    },
    modsUnavailable: {
        id: 'app.server.changelog.mods-unavailable',
        defaultMessage:
            'These mods are no longer installed here, so only their file names are known.',
    },
    moreFiles: {
        id: 'app.server.changelog.more-files',
        defaultMessage: 'Show more changed files',
    },
    otherFilesHeading: {
        id: 'app.server.changelog.other-heading',
        defaultMessage: 'Other changed files',
    },
    openProjectPage: {
        id: 'app.server.changelog.open-project',
        defaultMessage: 'Open the project page for {name} in the launcher',
    },
    openProjectExternal: {
        id: 'app.server.changelog.open-project-external',
        defaultMessage: 'Open {name} on its own site (leaves the launcher)',
    },
    openProjectSearch: {
        id: 'app.server.changelog.open-project-search',
        defaultMessage:
            'Search for {name} online — this mod declares no project page of its own',
    },
    skippedLines: {
        id: 'app.server.changelog.skipped-lines',
        defaultMessage:
            '{count, plural, one {# journal line could not be read and was skipped.} other {# journal lines could not be read and were skipped.}}',
    },
    silentGenerations: {
        id: 'app.server.changelog.silent-generations',
        defaultMessage:
            '{count, plural, one {# further generation only republished the pack rules, with no file or note changes.} other {# further generations only republished the pack rules, with no file or note changes.}}',
    },
    fileCount: {
        id: 'app.server.changelog.file-count',
        defaultMessage: '{count, plural, one {# file} other {# files}}',
    },
    kindAdded: { id: 'app.server.changelog.kind-added', defaultMessage: 'Added' },
    kindChanged: { id: 'app.server.changelog.kind-changed', defaultMessage: 'Changed' },
    kindRemoved: { id: 'app.server.changelog.kind-removed', defaultMessage: 'Removed' },
    kindAddedTooltip: {
        id: 'app.server.changelog.kind-added-tooltip',
        defaultMessage: 'This generation added the mod.',
    },
    kindChangedTooltip: {
        id: 'app.server.changelog.kind-changed-tooltip',
        defaultMessage: 'This generation updated the mod.',
    },
    kindRemovedTooltip: {
        id: 'app.server.changelog.kind-removed-tooltip',
        defaultMessage: 'This generation removed the mod.',
    },
    noHistory: {
        id: 'app.server.changelog.no-history',
        defaultMessage:
            'No instance on this computer has an AutoModpack history yet. Launch the pack once and the changes the server published will appear here.',
    },
    noRenderableGenerations: {
        id: 'app.server.changelog.nothing-to-show',
        defaultMessage:
            'The server has published pack generations, but none of them changed a file or carried patch notes, so there is nothing to report yet.',
    },
})

/**
 * Non-mod paths shown per directory before the rest is folded behind a count.
 * A first publish can touch hundreds of script files, so the count leads and
 * the list stays secondary.
 */
const VISIBLE_SAMPLE_PATHS = 8

const loading = ref(true)
const error = ref<string | null>(null)
/**
 * The rendered state. Always an array and always a number, so the template's
 * `.length` and `> 0` reads cannot throw however the backend answered.
 *
 * `generations` holds only the generations worth showing: a policy-only
 * republish with no notes is dropped by `resolveAutomodpackView`, and the count
 * that were dropped comes back as `silentGenerations` for one line of context.
 */
const generations = ref<AutomodpackGeneration[]>([])
const skippedLines = ref(0)
const silentGenerations = ref(0)
const instanceId = ref<string | null>(null)
/** Why there is nothing to show, when no instance has a history. */
const unavailableReason = ref<AutomodpackUnavailable | null>(null)

/** Mod cards per generation sequence number, fetched once per generation. */
const modsByGeneration = ref<Record<number, ContentItem[]>>({})
const requestedGenerations = new Set<number>()
const expandedDirectories = ref<Record<string, boolean>>({})

function formatDate(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleDateString(locale.value, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    })
}

async function load(force = false) {
    loading.value = true
    error.value = null
    try {
        const resolved = await loadAutomodpackChangelog()
        generations.value = resolved.generations
        instanceId.value = resolved.instanceId ?? null
        skippedLines.value = resolved.skippedLines
        silentGenerations.value = resolved.silentGenerations
        unavailableReason.value = resolved.reason ?? null
        if (force) {
            modsByGeneration.value = {}
            requestedGenerations.clear()
        }
        await loadMods()
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err)
    } finally {
        loading.value = false
    }
}

/**
 * Resolves each generation's changed mod paths to instance content items.
 *
 * A journal change carries the changed file's **path**, and that path is what
 * makes a clickable project card possible: it is handed to the same content API
 * the instance mod list uses, which answers with the project, icon and author.
 * A reader that returned only counts or hashes could not produce a card, so the
 * path list is not something to narrow later.
 *
 * Paths the instance no longer has — a mod a later generation removed — come
 * back unmatched and are listed by name instead.
 */
async function loadMods() {
    const currentInstanceId = instanceId.value
    if (!currentInstanceId) return

    for (const generation of generations.value) {
        const modPaths = generation.modPaths ?? []
        if (modPaths.length === 0) continue
        if (requestedGenerations.has(generation.seq)) continue
        requestedGenerations.add(generation.seq)

        let items: ContentItem[] = []
        try {
            items = await get_content_items_by_paths(currentInstanceId, modPaths)
        } catch {
            items = []
        }
        modsByGeneration.value = { ...modsByGeneration.value, [generation.seq]: items }
    }
}

function modsFor(seq: number): ContentItem[] | undefined {
    return modsByGeneration.value[seq]
}

/**
 * Mod paths per generation that no longer match an installed file — a mod a
 * later generation removed. Computed once rather than per row, because the
 * first generation alone carries 159 paths.
 */
const unresolvedByGeneration = computed<Record<number, string[]>>(() => {
    const unresolved: Record<number, string[]> = {}
    for (const generation of generations.value) {
        const items = modsByGeneration.value[generation.seq]
        if (!items) continue
        const known = new Set(items.map((item) => item.file_path))
        const missing = (generation.modPaths ?? []).filter((path) => !known.has(path))
        if (missing.length > 0) unresolved[generation.seq] = missing
    }
    return unresolved
})

function unresolvedModPaths(generation: AutomodpackGeneration): string[] {
    return unresolvedByGeneration.value[generation.seq] ?? []
}

/**
 * What this generation did to one mod path, resolved through a per-generation
 * index so a hundred-card list costs one pass over the changes.
 *
 * The journal records added / changed / removed per file; folding that away
 * would leave the page unable to say "this mod is new here" as opposed to
 * "this mod was updated", which is the first thing a player looks for.
 */
const changeKindIndex = computed<Record<number, Record<string, AutomodpackChangeKind>>>(() => {
    const index: Record<number, Record<string, AutomodpackChangeKind>> = {}
    for (const generation of generations.value) {
        const byPath: Record<string, AutomodpackChangeKind> = {}
        for (const change of generation.changes ?? []) byPath[change.path] = change.kind
        index[generation.seq] = byPath
    }
    return index
})

function kindBadge(generation: AutomodpackGeneration, item: ContentItem) {
    if (!item.file_path) return null
    const kind = changeKindIndex.value[generation.seq]?.[item.file_path]
    if (!kind) return null
    if (kind === 'added') {
        return {
            label: formatMessage(messages.kindAdded),
            tooltip: formatMessage(messages.kindAddedTooltip),
        }
    }
    if (kind === 'removed') {
        return {
            label: formatMessage(messages.kindRemoved),
            tooltip: formatMessage(messages.kindRemovedTooltip),
        }
    }
    return {
        label: formatMessage(messages.kindChanged),
        tooltip: formatMessage(messages.kindChangedTooltip),
    }
}

function directoryKey(seq: number, directory: string): string {
    return `${seq}:${directory}`
}

function isDirectoryExpanded(seq: number, directory: string): boolean {
    return expandedDirectories.value[directoryKey(seq, directory)] ?? false
}

function toggleDirectory(seq: number, directory: string) {
    const key = directoryKey(seq, directory)
    expandedDirectories.value = {
        ...expandedDirectories.value,
        [key]: !isDirectoryExpanded(seq, directory),
    }
}

function visibleSamplePaths(seq: number, group: AutomodpackDirectoryGroup): string[] {
    const samples = group.samplePaths ?? []
    return isDirectoryExpanded(seq, group.directory)
        ? samples
        : samples.slice(0, VISIBLE_SAMPLE_PATHS)
}

function directoryLabel(directory: string): string {
    return directory === '' ? '.' : directory
}

/**
 * The card's project. Every content item the backend returns already carries a
 * project — it falls back to a synthetic `local:` one built from the jar's own
 * metadata or the file name — so this only guards a title that came back blank.
 */
function cardProject(item: ContentItem): ContentCardProject {
    const project = item.project
    const title = project?.title?.trim()
    if (project && title) return project
    return {
        id: project?.id ?? item.id,
        slug: project?.slug,
        title: title || item.file_name,
        icon_url: project?.icon_url,
    }
}

function cardOwner(item: ContentItem): ContentOwner | undefined {
    return item.owner ?? undefined
}

/**
 * Where one changed mod's card goes.
 *
 * The launcher resolves the pack's jars to real Modrinth projects (by sha1, at
 * sync time), so most rows open the launcher's **own** project page — the point
 * of this page is to keep the player inside the launcher. A row the launcher
 * could not match keeps the mod's own site instead, and a row with neither gets
 * no action at all rather than a dead button.
 */
function projectAction(item: ContentItem) {
    return resolveChangelogProjectAction(item, instanceId.value)
}

/**
 * The card title's destination. An in-app row links straight to the launcher's
 * project page — the title is the biggest target on the card, so it carries the
 * primary affordance. A row with only an external site gets no title link: the
 * title must not silently leave the launcher.
 */
function projectRoute(item: ContentItem) {
    const action = projectAction(item)
    if (action?.kind !== 'in_app') return undefined
    return { path: action.path, query: action.query }
}

function actionLabel(item: ContentItem, action: ReturnType<typeof projectAction>): string {
    const name = modDisplayName(item)
    if (action?.kind === 'in_app') {
        return formatMessage(messages.openProjectPage, { name })
    }
    return formatMessage(
        action?.declared ? messages.openProjectExternal : messages.openProjectSearch,
        { name },
    )
}

/** The row's action: navigate in-app, or open the mod's own site. */
function cardInlineActions(item: ContentItem): ContentRowInlineAction[] {
    const action = projectAction(item)
    if (!action) return []
    const label = actionLabel(item, action)
    if (action.kind === 'in_app') {
        return [
            {
                id: 'open-project-page',
                label,
                icon: GlobeIcon,
                action: () => void openProjectInApp(action),
            },
        ]
    }
    return [
        {
            id: 'open-project-external',
            label,
            icon: ExternalIcon,
            action: () => void openExternal(action.url),
        },
    ]
}

/** In-app navigation through the router, so the page stays inside the launcher. */
async function openProjectInApp(action: { path: string; query: Record<string, string> }) {
    await router.push({ path: action.path, query: action.query })
}

async function openExternal(href: string) {
    await openUrl(href).catch(() => undefined)
}

onMounted(() => {
    void load()
})
</script>

<template>
    <div class="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-6 py-4">
        <div class="mb-4 flex shrink-0 items-center justify-between gap-4">
            <h1 class="m-0 text-xl font-semibold text-contrast">
                {{ formatMessage(messages.title) }}
            </h1>
            <button
                type="button"
                v-tooltip="formatMessage(messages.refresh)"
                class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-secondary hover:bg-surface-4 hover:text-contrast"
                :aria-label="formatMessage(messages.refresh)"
                :disabled="loading"
                @click="load(true)"
            >
                <RefreshCwIcon class="h-4 w-4" />
            </button>
        </div>

        <div v-if="loading" class="p-6 text-secondary">
            {{ formatMessage(messages.loading) }}
        </div>

        <div
            v-else-if="error"
            class="rounded-2xl border border-solid border-divider bg-surface-2 p-6"
        >
            <p class="m-0 mb-3 text-secondary">{{ formatMessage(messages.errorTitle) }}</p>
            <p class="m-0 mb-3 font-mono text-sm text-secondary">{{ error }}</p>
            <button
                type="button"
                class="cursor-pointer rounded-full border-0 bg-brand px-4 py-2 font-semibold text-contrast"
                @click="load(true)"
            >
                {{ formatMessage(messages.retry) }}
            </button>
        </div>

        <!--
            Nothing published to show. Three backend states are ordinary and one
            is not; each gets its own sentence rather than a shared shrug, and
            none of them is a thrown error.
        -->
        <div
            v-else-if="generations.length === 0"
            class="rounded-2xl border border-solid border-divider bg-surface-2 p-6 text-secondary"
        >
            <p
                v-if="unavailableReason === 'unreachable'"
                class="m-0 mb-3 text-secondary"
            >
                {{ formatMessage(messages.errorTitle) }}
            </p>
            <!--
                A history exists but every generation in it was a policy-only
                republish. Saying "nothing published yet" would be untrue, so
                this case gets its own sentence.
            -->
            <p v-else-if="silentGenerations > 0" class="m-0 mb-3 text-secondary">
                {{ formatMessage(messages.noRenderableGenerations) }}
            </p>
            <p v-else class="m-0 mb-3 text-secondary">
                {{ formatMessage(messages.noHistory) }}
            </p>
            <button
                type="button"
                class="cursor-pointer rounded-full border-0 bg-brand px-4 py-2 font-semibold text-contrast"
                @click="load(true)"
            >
                {{ formatMessage(messages.retry) }}
            </button>
        </div>

        <div v-else class="min-h-0 flex-1 overflow-y-auto pb-6">
            <p v-if="skippedLines > 0" class="mb-3 text-sm text-orange">
                {{ formatMessage(messages.skippedLines, { count: skippedLines }) }}
            </p>
            <p v-if="silentGenerations > 0" class="mb-3 text-sm text-secondary">
                {{ formatMessage(messages.silentGenerations, { count: silentGenerations }) }}
            </p>

            <article
                v-for="generation in generations"
                :key="generation.seq"
                class="mb-4 rounded-2xl border border-solid border-divider bg-surface-2 p-5"
            >
                <header class="mb-3 flex flex-wrap items-center gap-2">
                    <span class="font-semibold text-contrast">
                        {{ formatMessage(messages.generationLabel, { seq: generation.seq }) }}
                    </span>
                    <span class="text-sm text-secondary">
                        {{
                            formatMessage(messages.publishedOn, {
                                date: formatDate(generation.createdAt),
                            })
                        }}
                    </span>
                    <span
                        v-if="generation.restoreOf !== undefined"
                        class="rounded-full bg-surface-4 px-2 py-0.5 text-xs font-semibold text-contrast"
                    >
                        {{ formatMessage(messages.restoreBadge, { seq: generation.restoreOf }) }}
                    </span>
                    <span class="text-sm text-secondary">
                        {{
                            formatMessage(messages.changedFiles, {
                                count: generation.changedFiles,
                            })
                        }}
                    </span>
                </header>

                <div v-if="generation.notes.trim()" class="markdown-body mb-3 whitespace-pre-wrap">
                    {{ generation.notes }}
                </div>
                <p v-else class="m-0 mb-3 text-secondary">
                    {{ formatMessage(messages.noNotes) }}
                </p>

                <template v-if="(generation.modPaths ?? []).length > 0">
                    <h2 class="mb-2 mt-4 text-sm font-semibold uppercase text-secondary">
                        {{ formatMessage(messages.modsHeading) }}
                    </h2>

                    <div v-if="!modsFor(generation.seq)" class="text-secondary">
                        {{ formatMessage(messages.modsLoading) }}
                    </div>

                    <template v-else>
                        <ContentCardItem
                            v-for="item in modsFor(generation.seq)"
                            :key="item.id"
                            :project="cardProject(item)"
                            :project-link="projectRoute(item)"
                            :version="item.version ?? undefined"
                            :owner="cardOwner(item)"
                            :notice-badge="kindBadge(generation, item)"
                            :inline-actions="cardInlineActions(item)"
                            hide-toggle
                            hide-delete
                        />

                        <div
                            v-if="unresolvedModPaths(generation).length > 0"
                            class="mt-2 text-sm text-secondary"
                        >
                            {{ formatMessage(messages.modsUnavailable) }}
                            <ul class="m-0 mt-1 list-none p-0">
                                <li
                                    v-for="path in unresolvedModPaths(generation)"
                                    :key="path"
                                    class="truncate font-mono"
                                >
                                    {{ path }}
                                </li>
                            </ul>
                        </div>
                    </template>
                </template>

                <template v-if="(generation.directories ?? []).length > 0">
                    <h2 class="mb-2 mt-4 text-sm font-semibold uppercase text-secondary">
                        {{ formatMessage(messages.otherFilesHeading) }}
                    </h2>

                    <div
                        v-for="group in generation.directories"
                        :key="group.directory"
                        class="mb-3 rounded-xl border border-solid border-divider p-3"
                    >
                        <button
                            type="button"
                            class="flex w-full cursor-pointer items-center justify-between gap-2 border-0 bg-transparent p-0 text-left"
                            :aria-expanded="isDirectoryExpanded(generation.seq, group.directory)"
                            @click="toggleDirectory(generation.seq, group.directory)"
                        >
                            <span class="font-mono font-semibold text-contrast">
                                {{ directoryLabel(group.directory) }}
                            </span>
                            <span class="text-sm text-secondary">
                                {{ formatMessage(messages.fileCount, { count: group.count }) }}
                            </span>
                        </button>

                        <ul class="m-0 mt-2 list-none p-0 text-sm text-secondary">
                            <li
                                v-for="path in visibleSamplePaths(generation.seq, group)"
                                :key="path"
                                class="truncate font-mono"
                            >
                                {{ path }}
                            </li>
                        </ul>

                        <button
                            v-if="
                                group.samplesTruncated &&
                                !isDirectoryExpanded(generation.seq, group.directory)
                            "
                            type="button"
                            class="mt-1 cursor-pointer border-0 bg-transparent p-0 text-sm text-brand"
                            @click="toggleDirectory(generation.seq, group.directory)"
                        >
                            {{ formatMessage(messages.moreFiles) }}
                        </button>
                    </div>
                </template>
            </article>
        </div>
    </div>
</template>
