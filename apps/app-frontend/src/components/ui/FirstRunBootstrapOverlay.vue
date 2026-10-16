<template>
    <div
        v-if="visible"
        data-tauri-drag-region
        class="fixed inset-0 z-[10001] dark flex flex-col items-center justify-center gap-5 bg-bg px-6"
    >
        <img class="h-28 w-28 object-contain" src="@/assets/axolotl.png" alt="" />

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
                <span :class="stepTextClass(entry)">{{ formatMessage(stepMessage(entry)) }}</span>
            </li>
        </ol>

        <div v-if="!failure" class="flex w-full max-w-md flex-col items-center gap-2">
            <ProgressBar
                class="w-full"
                :progress="percent"
                :max="100"
                :waiting="!hasProgress"
            />
            <span class="text-sm text-[var(--color-text-tertiary)]">{{ phaseDetail }}</span>
            <span v-if="fileProgress" class="text-sm text-[var(--color-text-tertiary)]">
                {{ fileProgress }}
            </span>
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
                <summary class="cursor-pointer">{{ formatMessage(messages.failedDetails) }}</summary>
                <pre class="mt-1 mb-0 whitespace-pre-wrap break-all">{{ failure.technical }}</pre>
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
import { computed, onMounted, ref, watch } from 'vue'

import { DIRECT_LINKS_SYNCED_EVENT } from '@/helpers/direct-link-sync'
import {
    FirstRunBootstrapError,
    type FirstRunBootstrapProgress,
    type FirstRunBootstrapStep,
    runFirstRunBootstrap,
} from '@/helpers/first-run-bootstrap'
import type { InstallPhaseId } from '@/helpers/install'
import { ServerConfig } from '@/server-config'

/**
 * First-run overlay.
 *
 * Runs once per app start. It stays hidden until there is real work: an
 * instance for this server that is either missing entirely (first run) or
 * missing one of the jars the game cannot start without (a half-built instance
 * left behind by a crash or an earlier failure). A complete instance is never
 * touched, and nothing about the flow depends on "we ran before".
 */

type VisibleStep = 'creating-instance' | 'installing-mods' | 'registering-server'

const visibleSteps: VisibleStep[] = [
    'creating-instance',
    'installing-mods',
    'registering-server',
]

/** How long the finished state stays on screen before the overlay closes. */
const FINISHED_DISPLAY_MS = 1200

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
    stepCreatingInstance: {
        id: 'app.first-run-bootstrap.step.creating-instance',
        defaultMessage: 'Creating your game instance',
    },
    stepInstallingMods: {
        id: 'app.first-run-bootstrap.step.installing-mods',
        defaultMessage: 'Installing the required mods',
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
    phaseFinishing: {
        id: 'app.first-run-bootstrap.phase.finishing',
        defaultMessage: 'Finishing up…',
    },
    fileProgress: {
        id: 'app.first-run-bootstrap.file-progress',
        defaultMessage: 'File {current} of {total}',
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
        defaultMessage:
            'The missing files were added back. You can start playing now.',
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
 * Hidden until work actually starts, so a normal launch (an instance that is
 * present and complete) never flashes a full-screen overlay.
 */
const visible = ref(false)
const running = ref(false)
const finished = ref(false)
const repairing = ref(false)
const step = ref<FirstRunBootstrapStep>('checking')
const progressCurrent = ref<number | undefined>(undefined)
const progressTotal = ref<number | undefined>(undefined)
const installPhase = ref<InstallPhaseId | undefined>(undefined)
const failure = ref<FailureState | null>(null)

const steps = computed<VisibleStep[]>(() =>
    repairing.value ? visibleSteps.filter((entry) => entry !== 'creating-instance') : visibleSteps,
)

watch(step, (current) => {
    if (current !== 'checking') visible.value = true
})

const currentStepIndex = computed(() =>
    finished.value ? steps.value.length : steps.value.indexOf(step.value as VisibleStep),
)

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

function stepMessage(target: VisibleStep) {
    switch (target) {
        case 'creating-instance':
            return messages.stepCreatingInstance
        case 'installing-mods':
            return messages.stepInstallingMods
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
        case 'creating-instance':
            return formatMessage(phaseMessage(installPhase.value))
        case 'installing-mods':
            return formatMessage(messages.stepInstallingMods)
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

const percent = computed(() => {
    const total = progressTotal.value
    const current = progressCurrent.value
    if (!total || total <= 0 || current === undefined) return 0
    return Math.max(0, Math.min(100, (current / total) * 100))
})

const fileProgress = computed(() => {
    if (!progressTotal.value || progressCurrent.value === undefined) return ''
    return formatMessage(messages.fileProgress, {
        current: progressCurrent.value,
        total: progressTotal.value,
    })
})

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
        }
    }
    return {
        message: formatMessage(messages.failedUnknown),
        technical,
        instanceId: null,
    }
}

async function start(mode: 'first-run' | 'retry') {
    if (running.value) return

    running.value = true
    finished.value = false
    failure.value = null
    step.value = 'checking'
    progressCurrent.value = undefined
    progressTotal.value = undefined
    installPhase.value = undefined

    try {
        const result = await runFirstRunBootstrap(
            (progress: FirstRunBootstrapProgress) => {
                repairing.value = progress.repairing
                step.value = progress.step
                progressCurrent.value = progress.current
                progressTotal.value = progress.total
                if (progress.phase !== undefined) installPhase.value = progress.phase
            },
            mode,
        )

        if (result === null) {
            // An instance for this server already exists and is complete:
            // nothing was created, copied or registered.
            visible.value = false
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
                result.repaired ? messages.repairSuccessText : messages.successText,
            ),
            type: 'success',
        })

        // The home and library pages read their instance list once, so tell
        // them an instance appeared. This is the app's existing "instance lists
        // may be stale" signal.
        window.dispatchEvent(new CustomEvent(DIRECT_LINKS_SYNCED_EVENT))

        window.setTimeout(() => {
            visible.value = false
        }, FINISHED_DISPLAY_MS)
    } catch (error) {
        console.error('First-run bootstrap failed', error)
        failure.value = describeFailure(error)
        // The failure must be on screen even when it happened before any step
        // reported progress (the overlay only reveals itself for real work).
        visible.value = true
        addNotification({
            title: formatMessage(messages.failedTitle),
            text: failure.value.message,
            type: 'error',
        })
    } finally {
        running.value = false
    }
}

function dismiss() {
    visible.value = false
}

onMounted(() => {
    void start('first-run')
})
</script>
