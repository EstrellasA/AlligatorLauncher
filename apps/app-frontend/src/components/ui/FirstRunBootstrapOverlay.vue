<template>
    <div
        v-if="visible"
        data-tauri-drag-region
        class="fixed inset-0 z-[10001] dark flex flex-col items-center justify-center gap-5 bg-bg px-6"
    >
        <img class="h-28 w-28 object-contain" src="@/assets/axolotl.png" alt="" />

        <template v-if="choosing">
            <div class="flex w-full max-w-md flex-col gap-2 text-center">
                <h1 class="m-0 text-xl font-bold text-[var(--color-text-primary)]">
                    {{ formatMessage(messages.choiceTitle) }}
                </h1>
                <p class="m-0 text-sm text-[var(--color-text-tertiary)]">
                    {{
                        formatMessage(messages.choiceSubtitle, { server: ServerConfig.serverName })
                    }}
                </p>
            </div>

            <div class="flex w-full max-w-md flex-col gap-3">
                <button
                    type="button"
                    class="flex w-full cursor-pointer flex-col items-start gap-1 rounded-xl border border-solid border-[var(--color-divider)] bg-surface-2 p-4 text-left"
                    @click="chooseImport"
                >
                    <span class="text-sm font-bold text-[var(--color-text-primary)]">
                        {{ formatMessage(messages.choiceImportTitle) }}
                    </span>
                    <span class="text-xs text-[var(--color-text-tertiary)]">
                        {{ formatMessage(messages.choiceImportText) }}
                    </span>
                </button>
                <button
                    type="button"
                    class="flex w-full cursor-pointer flex-col items-start gap-1 rounded-xl border border-solid border-[var(--color-divider)] bg-surface-2 p-4 text-left"
                    @click="start('first-run')"
                >
                    <span class="text-sm font-bold text-[var(--color-text-primary)]">
                        {{ formatMessage(messages.choiceDownloadTitle) }}
                    </span>
                    <span class="text-xs text-[var(--color-text-tertiary)]">
                        {{ formatMessage(messages.choiceDownloadText) }}
                    </span>
                </button>
                <button
                    type="button"
                    class="mt-1 cursor-pointer self-center border-0 bg-transparent p-1 text-xs text-[var(--color-text-tertiary)] underline"
                    @click="skip"
                >
                    {{ formatMessage(messages.choiceSkip) }}
                </button>
            </div>
        </template>

        <template v-else>
            <div class="flex w-full max-w-md flex-col gap-2 text-center">
                <h1 class="m-0 text-xl font-bold text-[var(--color-text-primary)]">
                    {{ formatMessage(repairing ? messages.repairTitle : messages.title) }}
                </h1>
                <p class="m-0 text-sm text-[var(--color-text-tertiary)]">
                    {{
                        formatMessage(repairing ? messages.repairSubtitle : messages.subtitle, {
                            server: ServerConfig.serverName,
                        })
                    }}
                </p>
            </div>

            <ol v-if="!failure" class="m-0 flex w-full max-w-md list-none flex-col gap-2 p-0">
                <li v-for="entry in steps" :key="entry" class="flex items-center gap-2">
                    <CheckIcon
                        v-if="stepState(entry) === 'done'"
                        class="size-4 shrink-0 text-green"
                        aria-hidden="true"
                    />
                    <SpinnerIcon
                        v-else-if="stepState(entry) === 'active'"
                        class="size-4 shrink-0 animate-spin text-brand"
                        aria-hidden="true"
                    />
                    <span
                        v-else
                        class="size-4 shrink-0 rounded-full border border-solid border-[var(--color-divider)]"
                        aria-hidden="true"
                    />
                    <span :class="stepTextClass(entry)">{{
                        formatMessage(stepMessage(entry))
                    }}</span>
                </li>
            </ol>

            <div v-if="!failure" class="flex w-full max-w-md flex-col items-center gap-2">
                <ProgressBar
                    class="w-full"
                    :progress="percent"
                    :max="100"
                    :waiting="!showProgress"
                />
                <span class="text-sm text-[var(--color-text-tertiary)]">{{ phaseDetail }}</span>
                <span v-if="fileProgress" class="text-sm text-[var(--color-text-tertiary)]">
                    {{ fileProgress }}
                </span>
                <span
                    v-else-if="importScanProgress"
                    class="text-sm text-[var(--color-text-tertiary)]"
                >
                    {{ importScanProgress }}
                </span>
                <span v-if="elapsed" class="text-xs text-[var(--color-text-tertiary)]">
                    {{ formatMessage(messages.elapsed, { time: elapsed }) }}
                </span>
                <p
                    v-if="slowHint"
                    class="m-0 rounded-lg border border-solid border-[var(--color-divider)] bg-surface-2 px-3 py-2 text-xs text-[var(--color-text-tertiary)]"
                >
                    {{ formatMessage(messages.slowHint) }}
                </p>
                <Button v-if="canCancelImport" type="outlined" color="brand" @click="cancelImport">
                    {{ formatMessage(messages.cancel) }}
                </Button>
            </div>

            <div
                v-else
                class="flex w-full max-w-md flex-col gap-2 rounded-xl border border-solid border-red bg-surface-2 p-4 text-left"
            >
                <span class="text-sm font-bold text-red">
                    {{ formatMessage(messages.failedTitle) }}
                </span>
                <span class="text-sm text-[var(--color-text-default)]">{{ failureMessage }}</span>
                <details class="text-xs text-[var(--color-text-tertiary)]">
                    <summary class="cursor-pointer">
                        {{ formatMessage(messages.failedDetails) }}
                    </summary>
                    <pre class="mt-1 mb-0 whitespace-pre-wrap break-all">{{
                        failure.technical
                    }}</pre>
                </details>
            </div>

            <div v-if="failure" class="flex w-full max-w-md justify-end gap-2">
                <Button type="outlined" color="brand" @click="dismiss">
                    {{ formatMessage(messages.dismiss) }}
                </Button>
                <Button type="colored" color="brand" :disabled="running" @click="start('retry')">
                    {{ formatMessage(messages.retry) }}
                </Button>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { CheckIcon, SpinnerIcon } from '@modrinth/assets'
import {
    Button,
    defineMessages,
    injectNotificationManager,
    ProgressBar,
    useVIntl,
} from '@modrinth/ui'
import { open } from '@tauri-apps/plugin-dialog'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { DIRECT_LINKS_SYNCED_EVENT } from '@/helpers/direct-link-sync'
import {
    FirstRunBootstrapError,
    type FirstRunBootstrapProgress,
    type FirstRunBootstrapStep,
    FirstRunImportCanceledError,
    runFirstRunBootstrap,
    runFirstRunImport,
    shouldOfferInstallChoice,
} from '@/helpers/first-run-bootstrap'
import type { InstallPhaseId } from '@/helpers/install'
import { ServerConfig } from '@/server-config'

/**
 * First-run overlay.
 *
 * Runs once per app start. A genuinely first run first asks how to get the
 * instance — import an existing copy, download it, or skip — and only starts
 * work after the answer. A player who already has an instance for this server
 * never sees the question: a complete instance is left alone and an incomplete
 * one keeps being repaired automatically, exactly as before.
 */

type VisibleStep = 'creating-instance' | 'installing-mods' | 'registering-server'

const visibleSteps: VisibleStep[] = ['creating-instance', 'installing-mods', 'registering-server']

/** How long the finished state stays on screen before the overlay closes. */
const FINISHED_DISPLAY_MS = 1200

/**
 * With no visible progress change for this long, say that the network may be
 * slow or blocked. Purely informational: it never cancels the job, and it
 * disappears by itself as soon as progress resumes.
 */
const SLOW_HINT_AFTER_MS = 75_000

const { formatMessage } = useVIntl()
const { addNotification } = injectNotificationManager()

const messages = defineMessages({
    title: {
        id: 'app.first-run-bootstrap.title',
        defaultMessage: 'Setting up your game',
    },
    subtitle: {
        id: 'app.first-run-bootstrap.subtitle',
        defaultMessage:
            'The launcher is building a ready-to-play instance for {server}. This only happens once.',
    },
    choiceTitle: {
        id: 'app.first-run-bootstrap.choice.title',
        defaultMessage: 'Is the modpack already installed?',
    },
    choiceSubtitle: {
        id: 'app.first-run-bootstrap.choice.subtitle',
        defaultMessage:
            'Choose how to prepare your game for {server}. Nothing is downloaded until you choose.',
    },
    choiceImportTitle: {
        id: 'app.first-run-bootstrap.choice.import-title',
        defaultMessage: 'I already have it — import',
    },
    choiceImportText: {
        id: 'app.first-run-bootstrap.choice.import-text',
        defaultMessage:
            "Pick the folder that already contains this server's pack — another launcher's instance folder or a copied .minecraft.",
    },
    choiceDownloadTitle: {
        id: 'app.first-run-bootstrap.choice.download-title',
        defaultMessage: "I don't have it — download",
    },
    choiceDownloadText: {
        id: 'app.first-run-bootstrap.choice.download-text',
        defaultMessage: 'Create a new instance and download everything the server needs.',
    },
    choiceSkip: {
        id: 'app.first-run-bootstrap.choice.skip',
        defaultMessage: 'Skip',
    },
    stepCreatingInstance: {
        id: 'app.first-run-bootstrap.step.creating-instance',
        defaultMessage: 'Creating your game instance',
    },
    stepCheckingFolder: {
        id: 'app.first-run-bootstrap.step.checking-folder',
        defaultMessage: 'Checking the selected folder',
    },
    stepImporting: {
        id: 'app.first-run-bootstrap.step.importing',
        defaultMessage: 'Importing your existing install',
    },
    stepInstallingMods: {
        id: 'app.first-run-bootstrap.step.installing-mods',
        defaultMessage: 'Installing the required mods',
    },
    stepInstallingClientMods: {
        id: 'app.first-run-bootstrap.step.installing-client-mods',
        defaultMessage: 'Installing the client mods',
    },
    stepRegisteringServer: {
        id: 'app.first-run-bootstrap.step.registering-server',
        defaultMessage: 'Adding the server to your instance',
    },
    phasePreparing: {
        id: 'app.first-run-bootstrap.phase.preparing',
        defaultMessage: 'Preparing your game…',
    },
    phaseDownloadingMinecraft: {
        id: 'app.first-run-bootstrap.phase.downloading-minecraft',
        defaultMessage: 'Downloading the game files…',
    },
    phaseInstallingLoader: {
        id: 'app.first-run-bootstrap.phase.installing-loader',
        defaultMessage: 'Installing the mod loader…',
    },
    phaseDownloadingPack: {
        id: 'app.first-run-bootstrap.phase.downloading-pack',
        defaultMessage: 'Downloading the modpack…',
    },
    phaseDownloadingPackContent: {
        id: 'app.first-run-bootstrap.phase.downloading-pack-content',
        defaultMessage: 'Installing the modpack files…',
    },
    phasePreparingJava: {
        id: 'app.first-run-bootstrap.phase.preparing-java',
        defaultMessage: 'Preparing Java…',
    },
    phaseCopyingMods: {
        id: 'app.first-run-bootstrap.phase.copying-mods',
        defaultMessage: 'Copying the required files…',
    },
    phaseFinishing: {
        id: 'app.first-run-bootstrap.phase.finishing',
        defaultMessage: 'Finishing up…',
    },
    fileProgress: {
        id: 'app.first-run-bootstrap.file-progress',
        defaultMessage: 'File {current} of {total}',
    },
    importScanProgress: {
        id: 'app.first-run-bootstrap.import-scan-progress',
        defaultMessage: 'Found {files} files so far',
    },
    elapsed: {
        id: 'app.first-run-bootstrap.elapsed',
        defaultMessage: 'Elapsed {time}',
    },
    slowHint: {
        id: 'app.first-run-bootstrap.slow-hint',
        defaultMessage:
            'This is taking longer than usual. Your network may be slow or blocking the download; the launcher is still trying.',
    },
    cancel: {
        id: 'app.downloads.cancel',
        defaultMessage: 'Cancel',
    },
    failedTitle: {
        id: 'app.first-run-bootstrap.failed.title',
        defaultMessage: 'Setup could not be finished',
    },
    failedInstanceCreation: {
        id: 'app.first-run-bootstrap.failed.instance-creation',
        defaultMessage:
            'The game instance could not be created. Check your network connection and try again.',
    },
    failedInstanceIdMissing: {
        id: 'app.first-run-bootstrap.failed.instance-id-missing',
        defaultMessage:
            'The launcher could not tell which instance was created. Please report this to the server team.',
    },
    failedBundledMods: {
        id: 'app.first-run-bootstrap.failed.bundled-mods',
        defaultMessage:
            'Your instance was created, but the required mods could not be installed. The game will not start until this is fixed.',
    },
    failedImport: {
        id: 'app.first-run-bootstrap.failed.import',
        defaultMessage:
            'The existing install could not be imported. Check that the folder contains the pack, then try again — or choose download instead.',
    },
    failedUnknown: {
        id: 'app.first-run-bootstrap.failed.unknown',
        defaultMessage: 'Something went wrong while setting up your game.',
    },
    failedDetails: {
        id: 'app.first-run-bootstrap.failed.details',
        defaultMessage: 'Technical details',
    },
    retry: {
        id: 'app.first-run-bootstrap.retry',
        defaultMessage: 'Try again',
    },
    dismiss: {
        id: 'app.first-run-bootstrap.dismiss',
        defaultMessage: 'Continue anyway',
    },
    successTitle: {
        id: 'app.first-run-bootstrap.success.title',
        defaultMessage: 'Your game is ready',
    },
    successText: {
        id: 'app.first-run-bootstrap.success.text',
        defaultMessage:
            'The instance was created with the mods this server needs. You can start playing now.',
    },
    successImportedText: {
        id: 'app.first-run-bootstrap.success.imported-text',
        defaultMessage:
            'Your existing install was imported and prepared. You can start playing now.',
    },
    repairTitle: {
        id: 'app.first-run-bootstrap.repair.title',
        defaultMessage: 'Finishing your game setup',
    },
    repairSubtitle: {
        id: 'app.first-run-bootstrap.repair.subtitle',
        defaultMessage:
            'The launcher found files missing from your {server} instance and is adding them back. This only happens once.',
    },
    repairSuccessText: {
        id: 'app.first-run-bootstrap.repair.success-text',
        defaultMessage: 'The missing files were added back. You can start playing now.',
    },
    serverMissingTitle: {
        id: 'app.first-run-bootstrap.server-missing.title',
        defaultMessage: 'The server was not added automatically',
    },
    serverMissingText: {
        id: 'app.first-run-bootstrap.server-missing.text',
        defaultMessage:
            'Add {address} to your instance manually, or use the join button on the home page.',
    },
})

interface FailureState {
    message: string
    technical: string
    /** Instance created by the failed attempt, when there is one. */
    instanceId: string | null
}

/**
 * Hidden until there is something to ask or report, so a normal launch (an
 * instance that is present and complete) never flashes a full-screen overlay.
 */
const visible = ref(false)
const choosing = ref(false)
const running = ref(false)
const finished = ref(false)
const repairing = ref(false)
const step = ref<FirstRunBootstrapStep>('checking')
const progressCurrent = ref<number | undefined>(undefined)
const progressTotal = ref<number | undefined>(undefined)
const installPhase = ref<InstallPhaseId | undefined>(undefined)
const modsFolder = ref<string | undefined>(undefined)
const importStage = ref<'scanning' | 'copying' | undefined>(undefined)
const importedFiles = ref<number | undefined>(undefined)
const failure = ref<FailureState | null>(null)

const startedAt = ref<number | null>(null)
const lastProgressAt = ref(Date.now())
const nowTick = ref(Date.now())
let tickTimer: number | null = null
let importAbortController: AbortController | null = null

const steps = computed<VisibleStep[]>(() =>
    repairing.value ? visibleSteps.filter((entry) => entry !== 'creating-instance') : visibleSteps,
)

watch(step, (current) => {
    if (current !== 'checking' && !choosing.value) visible.value = true
    // Progress from the install job is stale once the job's step is over:
    // bundled-mod copying and server registration report their own state.
    if (current === 'installing-mods' || current === 'registering-server' || current === 'done') {
        progressCurrent.value = undefined
        progressTotal.value = undefined
    }
})

watch(
    () => [
        step.value,
        installPhase.value,
        progressCurrent.value,
        progressTotal.value,
        modsFolder.value,
        importStage.value,
        importedFiles.value,
    ],
    () => {
        lastProgressAt.value = Date.now()
    },
)

const currentStepIndex = computed(() => {
    if (finished.value) return steps.value.length
    if (step.value === 'importing') return steps.value.indexOf('creating-instance')
    return steps.value.indexOf(step.value as VisibleStep)
})

function stepState(target: VisibleStep): 'pending' | 'active' | 'done' {
    const index = currentStepIndex.value
    const own = steps.value.indexOf(target)
    if (index < 0) return 'pending'
    if (own < index) return 'done'
    return own === index ? 'active' : 'pending'
}

function stepTextClass(target: VisibleStep) {
    return stepState(target) === 'pending'
        ? 'text-sm text-[var(--color-text-tertiary)]'
        : 'text-sm text-[var(--color-text-default)]'
}

/** The first step is an import or an install depending on what is running. */
function firstStepMessage() {
    if (step.value === 'importing') {
        return importStage.value === 'copying'
            ? messages.stepImporting
            : messages.stepCheckingFolder
    }

    switch (installPhase.value) {
        case 'resolving_minecraft':
        case 'downloading_minecraft':
            return messages.phaseDownloadingMinecraft
        case 'resolving_loader':
        case 'running_loader_processors':
        case 'updating_loader':
            return messages.phaseInstallingLoader
        case 'resolving_pack':
        case 'downloading_pack_file':
        case 'reading_pack_manifest':
            return messages.phaseDownloadingPack
        case 'preparing_java':
            return messages.phasePreparingJava
        case 'downloading_content':
        case 'extracting_overrides':
            return messages.phaseDownloadingPackContent
        default:
            return messages.stepCreatingInstance
    }
}

function stepMessage(target: VisibleStep) {
    switch (target) {
        case 'creating-instance':
            return firstStepMessage()
        case 'installing-mods':
            return step.value === 'installing-mods' &&
                modsFolder.value === ServerConfig.clientModsFolder
                ? messages.stepInstallingClientMods
                : messages.stepInstallingMods
        case 'registering-server':
            return messages.stepRegisteringServer
    }
}

function phaseMessage(phase: InstallPhaseId | undefined) {
    switch (phase) {
        case 'resolving_minecraft':
        case 'downloading_minecraft':
            return messages.phaseDownloadingMinecraft
        case 'resolving_loader':
        case 'running_loader_processors':
        case 'updating_loader':
            return messages.phaseInstallingLoader
        case 'resolving_pack':
        case 'downloading_pack_file':
        case 'reading_pack_manifest':
            return messages.phaseDownloadingPack
        case 'preparing_java':
            return messages.phasePreparingJava
        case 'downloading_content':
        case 'extracting_overrides':
            return messages.phaseDownloadingPackContent
        case 'verifying':
        case 'finalizing':
            return messages.phaseFinishing
        default:
            return messages.phasePreparing
    }
}

const phaseDetail = computed(() => {
    switch (step.value) {
        case 'checking':
            return formatMessage(messages.phasePreparing)
        case 'importing':
            return formatMessage(
                importStage.value === 'copying'
                    ? messages.stepImporting
                    : messages.stepCheckingFolder,
            )
        case 'creating-instance':
            return formatMessage(phaseMessage(installPhase.value))
        case 'installing-mods':
            return formatMessage(messages.phaseCopyingMods)
        case 'registering-server':
            return formatMessage(messages.stepRegisteringServer)
        default:
            return formatMessage(messages.successTitle)
    }
})

const hasProgress = computed(
    () =>
        progressTotal.value !== undefined &&
        progressTotal.value > 0 &&
        progressCurrent.value !== undefined,
)

/**
 * Only show file counts for the job that produced them. Reusing the install
 * job's "file 0 of 4" while the mods are being copied is exactly the dishonest
 * label this overlay used to show.
 */
const showProgress = computed(
    () =>
        (step.value === 'creating-instance' ||
            (step.value === 'importing' && importStage.value === 'copying')) &&
        hasProgress.value,
)

const percent = computed(() => {
    const total = progressTotal.value
    const current = progressCurrent.value
    if (!total || total <= 0 || current === undefined) return 0
    return Math.max(0, Math.min(100, (current / total) * 100))
})

const fileProgress = computed(() => {
    if (!showProgress.value) return ''
    if (!progressTotal.value || progressCurrent.value === undefined) return ''
    return formatMessage(messages.fileProgress, {
        current: progressCurrent.value,
        total: progressTotal.value,
    })
})

const importScanProgress = computed(() => {
    if (step.value !== 'importing' || importStage.value !== 'scanning') return ''
    if (!importedFiles.value) return ''
    return formatMessage(messages.importScanProgress, { files: importedFiles.value })
})

const elapsed = computed(() => {
    if (startedAt.value === null) return ''
    const seconds = Math.max(0, Math.floor((nowTick.value - startedAt.value) / 1000))
    const minutes = Math.floor(seconds / 60)
    return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
})

/** Informational only; it disappears by itself when progress resumes. */
const slowHint = computed(
    () =>
        running.value &&
        !finished.value &&
        failure.value === null &&
        startedAt.value !== null &&
        nowTick.value - lastProgressAt.value >= SLOW_HINT_AFTER_MS,
)

const canCancelImport = computed(
    () => running.value && step.value === 'importing' && importStage.value === 'scanning',
)

const failureMessage = computed(() => failure.value?.message ?? '')

function describeFailure(error: unknown): FailureState {
    const technical = error instanceof Error ? error.message : String(error)
    if (error instanceof FirstRunBootstrapError) {
        const instanceId = error.instanceId
        switch (error.reason) {
            case 'instance-creation':
                return {
                    message: formatMessage(messages.failedInstanceCreation),
                    technical,
                    instanceId,
                }
            case 'instance-id-missing':
                return {
                    message: formatMessage(messages.failedInstanceIdMissing),
                    technical,
                    instanceId,
                }
            case 'bundled-mods':
                return {
                    message: formatMessage(messages.failedBundledMods),
                    technical,
                    instanceId,
                }
            case 'import':
                return {
                    message: formatMessage(messages.failedImport),
                    technical,
                    instanceId,
                }
        }
    }
    return {
        message: formatMessage(messages.failedUnknown),
        technical,
        instanceId: null,
    }
}

function beginRun() {
    running.value = true
    finished.value = false
    failure.value = null
    step.value = 'checking'
    progressCurrent.value = undefined
    progressTotal.value = undefined
    installPhase.value = undefined
    modsFolder.value = undefined
    importStage.value = undefined
    importedFiles.value = undefined
    startedAt.value = Date.now()
    lastProgressAt.value = Date.now()
    nowTick.value = Date.now()
    if (tickTimer === null) {
        tickTimer = window.setInterval(() => {
            nowTick.value = Date.now()
        }, 1000)
    }
}

function onProgress(progress: FirstRunBootstrapProgress) {
    repairing.value = progress.repairing
    step.value = progress.step
    progressCurrent.value = progress.current
    progressTotal.value = progress.total
    if (progress.phase !== undefined) installPhase.value = progress.phase
    modsFolder.value = progress.modsFolder
    importStage.value = progress.importStage
    importedFiles.value = progress.importedFiles
}

function handleFailure(error: unknown) {
    console.error('First-run bootstrap failed', error)
    choosing.value = false
    failure.value = describeFailure(error)
    // The failure must be on screen even when it happened before any step
    // reported progress (the overlay only reveals itself for real work).
    visible.value = true
    addNotification({
        title: formatMessage(messages.failedTitle),
        text: failure.value.message,
        type: 'error',
    })
}

async function completeRun(result: Awaited<ReturnType<typeof runFirstRunBootstrap>>) {
    if (result === null) {
        // An instance for this server already exists and is complete:
        // nothing was created, copied or registered.
        visible.value = false
        choosing.value = false
        return
    }

    finished.value = true

    if (!result.serverRegistered) {
        addNotification({
            title: formatMessage(messages.serverMissingTitle),
            text: formatMessage(messages.serverMissingText, {
                address: ServerConfig.serverAddress,
            }),
            type: 'warning',
        })
    }

    addNotification({
        title: formatMessage(messages.successTitle),
        text: formatMessage(
            result.imported
                ? messages.successImportedText
                : result.repaired
                  ? messages.repairSuccessText
                  : messages.successText,
        ),
        type: 'success',
    })

    // The home and library pages read their instance list once, so tell them an
    // instance appeared. This is the app's existing "instance lists may be
    // stale" signal.
    window.dispatchEvent(new CustomEvent(DIRECT_LINKS_SYNCED_EVENT))

    window.setTimeout(() => {
        visible.value = false
    }, FINISHED_DISPLAY_MS)
}

async function start(mode: 'first-run' | 'retry') {
    if (running.value) return

    choosing.value = false
    beginRun()
    visible.value = true

    try {
        const result = await runFirstRunBootstrap(onProgress, mode)
        await completeRun(result)
    } catch (error) {
        handleFailure(error)
    } finally {
        running.value = false
    }
}

/** Import an existing install; cancel during the scan writes nothing at all. */
async function chooseImport() {
    if (running.value) return
    const selected = await open({ multiple: false, directory: true })
    const sourcePath = selected ? String(Array.isArray(selected) ? selected[0] : selected) : null
    if (!sourcePath) return

    choosing.value = false
    beginRun()
    visible.value = true

    const controller = new AbortController()
    importAbortController = controller
    try {
        const result = await runFirstRunImport(sourcePath, onProgress, controller.signal)
        await completeRun(result)
    } catch (error) {
        if (error instanceof FirstRunImportCanceledError) {
            // Nothing was written, so the question is safe to show again.
            running.value = false
            choosing.value = true
            visible.value = true
            return
        }
        handleFailure(error)
    } finally {
        running.value = false
        importAbortController = null
    }
}

function cancelImport() {
    importAbortController?.abort()
}

function dismiss() {
    choosing.value = false
    visible.value = false
}

/** Leave the launcher to its normal UI without creating or installing anything. */
function skip() {
    choosing.value = false
    visible.value = false
}

onMounted(() => {
    void (async () => {
        if (await shouldOfferInstallChoice()) {
            choosing.value = true
            visible.value = true
            return
        }
        void start('first-run')
    })()
})

onUnmounted(() => {
    if (tickTimer !== null) {
        window.clearInterval(tickTimer)
        tickTimer = null
    }
})
</script>
