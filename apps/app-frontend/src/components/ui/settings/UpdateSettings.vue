<script setup lang="ts">
import { DatabaseIcon, EyeIcon, RefreshCwIcon, XIcon } from '@modrinth/assets'
import { Button, defineMessages, injectNotificationManager, NewModal, useVIntl } from '@modrinth/ui'
import { getVersion } from '@tauri-apps/api/app'
import { inject, nextTick, ref, watch } from 'vue'

import UpdateAnnouncementHistory from '@/components/ui/announcement/UpdateAnnouncementHistory.vue'
import {
    betaDatabaseExists,
    copyDatabaseBetweenChannels,
    copyReleaseDatabaseToBeta,
    getCurrentAppDatabasePath,
    getUpdateChannel,
    setUpdateChannel,
    type UpdateChannel,
} from '@/helpers/settings.ts'
import { isDev, restartApp } from '@/helpers/utils.js'

import SettingsSection from './SettingsSection.vue'

const { formatMessage } = useVIntl()
const { addNotification, handleError } = injectNotificationManager()
const [activeChannel, currentVersion, isDevEnvironment, databasePath] = await Promise.all([
    getUpdateChannel(),
    getVersion(),
    isDev(),
    getCurrentAppDatabasePath().catch(() => ''),
])
const selectedChannel = ref<UpdateChannel>(activeChannel)
const currentDatabasePath = ref(databasePath)
const previewUpdateAnnouncement = inject<(version: string) => void>('previewUpdateAnnouncement')
const restartModal = ref<InstanceType<typeof NewModal>>()
const copyDatabaseModal = ref<InstanceType<typeof NewModal>>()
const databaseOperationModal = ref<InstanceType<typeof NewModal>>()
const pendingChannel = ref<UpdateChannel | null>(null)
const databaseOperation = ref<'release-to-beta' | 'beta-to-release' | ''>('')
const databaseOperationBusy = ref(false)
let restoringChannelSelection = false

const messages = defineMessages({
    // This fork is handed out manually and ships no updater, so this page states
    // that plainly. There is deliberately no "check for updates" action here: it
    // could never succeed, because no update server exists.
    manualTitle: {
        id: 'app.settings.updates.manual.title',
        defaultMessage: 'Automatic updates are off',
    },
    manualDescription: {
        id: 'app.settings.updates.manual.description',
        defaultMessage:
            'This build of ALLIGATORZONE never checks for, downloads, or installs launcher updates on its own.',
    },
    manualDistribution: {
        id: 'app.settings.updates.manual.distribution',
        defaultMessage:
            'New versions are handed out manually: download the latest build from the player QQ group, whose number is listed on the About page.',
    },
    title: {
        id: 'app.settings.updates.channel.title',
        defaultMessage: 'Update channel',
    },
    channelStateDescription: {
        id: 'app.settings.updates.channel.state-description',
        defaultMessage:
            'Release and Beta keep separate launcher data on this computer. The selected channel is the data this installation uses.',
    },
    channelLabel: {
        id: 'app.settings.updates.channel.label',
        defaultMessage: 'Channel',
    },
    release: {
        id: 'app.settings.updates.channel.release',
        defaultMessage: 'Release',
    },
    beta: {
        id: 'app.settings.updates.channel.beta',
        defaultMessage: 'Beta',
    },
    currentVersion: {
        id: 'app.settings.updates.current-version',
        defaultMessage: 'Current version {version}',
    },
    preview: {
        id: 'app.settings.updates.preview-announcement',
        defaultMessage: 'Preview update announcement',
    },
    restartTitle: {
        id: 'app.settings.updates.channel.restart-title',
        defaultMessage: 'Restart required',
    },
    restartDescription: {
        id: 'app.settings.updates.channel.restart-description',
        defaultMessage:
            'Restart ALLIGATORZONE now to start using the new update channel, or restart manually later.',
    },
    restartDevelopmentDescription: {
        id: 'app.settings.updates.channel.restart-development-description',
        defaultMessage:
            'The new update channel will be used after you manually restart the development session.',
    },
    restartNow: {
        id: 'app.settings.updates.channel.restart-now',
        defaultMessage: 'Restart now',
    },
    restartLater: {
        id: 'app.settings.updates.channel.restart-later',
        defaultMessage: 'Restart manually later',
    },
    copyDatabaseTitle: {
        id: 'app.settings.updates.channel.copy-database-title',
        defaultMessage: 'Copy Release data to Beta?',
    },
    copyDatabaseDescription: {
        id: 'app.settings.updates.channel.copy-database-description',
        defaultMessage:
            'Would you like to copy your Release database into the Beta channel? This cannot be undone automatically.',
    },
    copyDatabase: {
        id: 'app.settings.updates.channel.copy-database',
        defaultMessage: 'Copy database',
    },
    startEmpty: {
        id: 'app.settings.updates.channel.start-empty',
        defaultMessage: 'Start with empty database',
    },
    databaseIsolationTitle: {
        id: 'app.settings.updates.database-isolation.title',
        defaultMessage: 'Database isolation',
    },
    currentDatabase: {
        id: 'app.settings.updates.database-isolation.current-database',
        defaultMessage: 'Database currently in use',
    },
    databaseIsolationDescription: {
        id: 'app.settings.updates.database-isolation.description',
        defaultMessage:
            'Release and Beta use separate databases, so testing Beta does not change your Release data.',
    },
    releaseDatabase: {
        id: 'app.settings.updates.database-isolation.release',
        defaultMessage: 'Release database',
    },
    betaDatabase: {
        id: 'app.settings.updates.database-isolation.beta',
        defaultMessage: 'Beta database',
    },
    activeDatabase: {
        id: 'app.settings.updates.database-isolation.active',
        defaultMessage: 'Active',
    },
    databaseOperation: {
        id: 'app.settings.updates.database-operation.label',
        defaultMessage: 'Database operation',
    },
    releaseToBeta: {
        id: 'app.settings.updates.database-operation.release-to-beta',
        defaultMessage: 'Copy Release to Beta',
    },
    betaToRelease: {
        id: 'app.settings.updates.database-operation.beta-to-release',
        defaultMessage: 'Copy Beta to Release',
    },
    databaseOperationTitle: {
        id: 'app.settings.updates.database-operation.confirm-title',
        defaultMessage: 'Overwrite database?',
    },
    databaseOperationDescription: {
        id: 'app.settings.updates.database-operation.confirm-description',
        defaultMessage:
            'This will completely replace the inactive {target} database with the contents of the {source} database. This cannot be undone.',
    },
    databaseOperationConfirm: {
        id: 'app.settings.updates.database-operation.confirm',
        defaultMessage: 'Overwrite database',
    },
    databaseOperationActiveTarget: {
        id: 'app.settings.updates.database-operation.active-target',
        defaultMessage:
            'Cannot overwrite the database currently in use. Restart ALLIGATORZONE and switch channels first.',
    },
    databaseOperationFailed: {
        id: 'app.settings.updates.database-operation.failed',
        defaultMessage:
            'The database could not be copied. Please make sure ALLIGATORZONE is not using the target database.',
    },
    databaseOperationSuccess: {
        id: 'app.settings.updates.database-operation.success',
        defaultMessage: '{source} database was copied to {target} successfully.',
    },
    cancel: {
        id: 'app.settings.updates.database-operation.cancel',
        defaultMessage: 'Cancel',
    },
})

watch(selectedChannel, async (channel, previousChannel) => {
    if (restoringChannelSelection) return

    if (channel === 'beta' && previousChannel === 'release') {
        try {
            if (!(await betaDatabaseExists())) {
                pendingChannel.value = channel
                restoringChannelSelection = true
                selectedChannel.value = previousChannel
                await nextTick()
                restoringChannelSelection = false
                copyDatabaseModal.value?.show()
                return
            }
        } catch (error) {
            restoringChannelSelection = true
            selectedChannel.value = previousChannel
            await nextTick()
            restoringChannelSelection = false
            handleError(error)
            return
        }
    }

    await applyChannel(channel)
})

async function applyChannel(channel: UpdateChannel, copyDatabase = false) {
    try {
        if (copyDatabase) await copyReleaseDatabaseToBeta()
        await setUpdateChannel(channel)
        restartModal.value?.show()
        return true
    } catch (error) {
        handleError(error)
        return false
    }
}

async function chooseBetaDatabase(copyDatabase: boolean) {
    const channel = pendingChannel.value
    pendingChannel.value = null
    copyDatabaseModal.value?.hide()
    if (channel && (await applyChannel(channel, copyDatabase))) {
        restoringChannelSelection = true
        selectedChannel.value = channel
        await nextTick()
        restoringChannelSelection = false
    }
}

function onCopyDatabaseModalHide() {
    // Dismissing this choice cancels the pending channel switch. The selected
    // channel was already restored before the modal was shown.
    pendingChannel.value = null
}

async function restartForChannelChange() {
    restartModal.value?.hide()
    try {
        await restartApp()
    } catch (error) {
        handleError(error)
    }
}

function requestDatabaseOperation() {
    if (!databaseOperation.value) return
    databaseOperationModal.value?.show()
}

function selectDatabaseOperation(operation: 'release-to-beta' | 'beta-to-release') {
    databaseOperation.value = operation
    requestDatabaseOperation()
}

async function confirmDatabaseOperation() {
    if (!databaseOperation.value || databaseOperationBusy.value) return
    const [sourceChannel, targetChannel] =
        databaseOperation.value === 'release-to-beta'
            ? (['release', 'beta'] as const)
            : (['beta', 'release'] as const)
    databaseOperationBusy.value = true
    databaseOperationModal.value?.hide()
    try {
        await copyDatabaseBetweenChannels(sourceChannel, targetChannel)
        addNotification({
            type: 'success',
            title: formatMessage(messages.databaseOperationSuccess, {
                source:
                    sourceChannel === 'release'
                        ? formatMessage(messages.releaseDatabase)
                        : formatMessage(messages.betaDatabase),
                target:
                    targetChannel === 'release'
                        ? formatMessage(messages.releaseDatabase)
                        : formatMessage(messages.betaDatabase),
            }),
        })
    } catch {
        handleError(
            new Error(
                targetChannel === activeChannel
                    ? formatMessage(messages.databaseOperationActiveTarget)
                    : formatMessage(messages.databaseOperationFailed),
            ),
        )
    } finally {
        databaseOperationBusy.value = false
    }
}

function cancelDatabaseOperation() {
    databaseOperationModal.value?.hide()
    databaseOperation.value = ''
}

function onDatabaseOperationModalHide() {
    databaseOperation.value = ''
}
</script>

<template>
    <div class="flex flex-col gap-6">
        <SettingsSection :title="formatMessage(messages.manualTitle)">
            <div class="update-manual-panel">
                <div class="update-manual-heading">
                    <p class="m-0 text-sm text-[var(--color-text-tertiary)]">
                        {{ formatMessage(messages.currentVersion, { version: currentVersion }) }}
                    </p>
                    <p class="m-0 text-sm text-[var(--color-text-tertiary)]">
                        {{ formatMessage(messages.manualDescription) }}
                    </p>
                    <p class="m-0 text-sm text-[var(--color-text-tertiary)]">
                        {{ formatMessage(messages.manualDistribution) }}
                    </p>
                </div>
                <div
                    v-if="isDevEnvironment && previewUpdateAnnouncement"
                    class="flex flex-wrap gap-2"
                >
                    <Button
                        type="outlined"
                        native-type="button"
                        @click="previewUpdateAnnouncement(currentVersion)"
                    >
                        <EyeIcon />
                        {{ formatMessage(messages.preview) }}
                    </Button>
                </div>
            </div>
        </SettingsSection>

        <SettingsSection :title="formatMessage(messages.title)">
            <div class="update-channel-panel">
                <p
                    id="settings-target-updates-channel"
                    class="m-0 text-sm leading-[1.45] text-[var(--color-text-tertiary)]"
                >
                    {{ formatMessage(messages.channelStateDescription) }}
                </p>
                <div
                    class="update-channel-options"
                    role="radiogroup"
                    :aria-label="formatMessage(messages.channelLabel)"
                >
                    <button
                        type="button"
                        class="update-channel-card"
                        :class="{ 'update-channel-card-selected': selectedChannel === 'release' }"
                        role="radio"
                        :aria-checked="selectedChannel === 'release'"
                        @click="selectedChannel = 'release'"
                    >
                        <span class="update-channel-card-title">{{
                            formatMessage(messages.release)
                        }}</span>
                    </button>
                    <button
                        type="button"
                        class="update-channel-card"
                        :class="{ 'update-channel-card-selected': selectedChannel === 'beta' }"
                        role="radio"
                        :aria-checked="selectedChannel === 'beta'"
                        @click="selectedChannel = 'beta'"
                    >
                        <span class="update-channel-card-title">{{
                            formatMessage(messages.beta)
                        }}</span>
                    </button>
                </div>
            </div>
            <div class="database-isolation">
                <div class="database-isolation-copy">
                    <h3 class="m-0 text-base font-semibold text-[var(--color-text-primary)]">
                        {{ formatMessage(messages.databaseIsolationTitle) }}
                    </h3>
                    <p class="m-0 text-sm text-[var(--color-text-tertiary)]">
                        {{ formatMessage(messages.databaseIsolationDescription) }}
                    </p>
                    <div class="database-path">
                        <span>{{ formatMessage(messages.currentDatabase) }}</span>
                        <code>{{ currentDatabasePath || '—' }}</code>
                    </div>
                    <div class="database-operation">
                        <span>{{ formatMessage(messages.databaseOperation) }}</span>
                        <div class="database-operation-buttons">
                            <Button
                                type="outlined"
                                :disabled="activeChannel === 'beta'"
                                @click="selectDatabaseOperation('release-to-beta')"
                                ><DatabaseIcon />
                                {{ formatMessage(messages.releaseToBeta) }}
                            </Button>
                            <Button
                                type="outlined"
                                :disabled="activeChannel === 'release'"
                                @click="selectDatabaseOperation('beta-to-release')"
                                ><DatabaseIcon />
                                {{ formatMessage(messages.betaToRelease) }}
                            </Button>
                        </div>
                    </div>
                </div>
                <div
                    class="database-diagram"
                    :aria-label="formatMessage(messages.databaseIsolationDescription)"
                >
                    <div class="database-channel database-channel-release">
                        <span>R</span>
                        <strong>{{ formatMessage(messages.releaseDatabase) }}</strong>
                        <small>{{
                            activeChannel === 'release'
                                ? formatMessage(messages.activeDatabase)
                                : '\u00a0'
                        }}</small>
                    </div>
                    <div class="database-branch" aria-hidden="true"></div>
                    <div class="database-channel database-channel-beta">
                        <span>B</span>
                        <strong>{{ formatMessage(messages.betaDatabase) }}</strong>
                        <small>{{
                            activeChannel === 'beta'
                                ? formatMessage(messages.activeDatabase)
                                : '\u00a0'
                        }}</small>
                    </div>
                </div>
            </div>
        </SettingsSection>

        <UpdateAnnouncementHistory :current-version="currentVersion" />
    </div>

    <NewModal
        ref="restartModal"
        :header="formatMessage(messages.restartTitle)"
        :closable="true"
        :close-on-click-outside="true"
    >
        <p class="m-0">
            {{
                formatMessage(
                    isDevEnvironment
                        ? messages.restartDevelopmentDescription
                        : messages.restartDescription,
                )
            }}
        </p>
        <template #actions>
            <div class="flex justify-end gap-2">
                <Button type="outlined" @click="restartModal?.hide()"
                    ><XIcon />
                    {{ formatMessage(messages.restartLater) }}
                </Button>
                <Button
                    v-if="!isDevEnvironment"
                    type="colored"
                    color="brand"
                    @click="restartForChannelChange"
                    ><RefreshCwIcon />
                    {{ formatMessage(messages.restartNow) }}
                </Button>
            </div>
        </template>
    </NewModal>

    <NewModal
        ref="copyDatabaseModal"
        :header="formatMessage(messages.copyDatabaseTitle)"
        :closable="true"
        :close-on-click-outside="true"
        :on-hide="onCopyDatabaseModalHide"
    >
        <p class="m-0">{{ formatMessage(messages.copyDatabaseDescription) }}</p>
        <template #actions>
            <div class="flex justify-end gap-2">
                <Button type="outlined" @click="chooseBetaDatabase(false)"
                    ><XIcon />
                    {{ formatMessage(messages.startEmpty) }}
                </Button>
                <Button type="colored" color="brand" @click="chooseBetaDatabase(true)"
                    ><RefreshCwIcon />
                    {{ formatMessage(messages.copyDatabase) }}
                </Button>
            </div>
        </template>
    </NewModal>

    <NewModal
        ref="databaseOperationModal"
        :header="formatMessage(messages.databaseOperationTitle)"
        :closable="true"
        :close-on-click-outside="true"
        :on-hide="onDatabaseOperationModalHide"
    >
        <p class="m-0">
            {{
                formatMessage(messages.databaseOperationDescription, {
                    source:
                        databaseOperation === 'release-to-beta'
                            ? formatMessage(messages.releaseDatabase)
                            : formatMessage(messages.betaDatabase),
                    target:
                        databaseOperation === 'release-to-beta'
                            ? formatMessage(messages.betaDatabase)
                            : formatMessage(messages.releaseDatabase),
                })
            }}
        </p>
        <template #actions>
            <div class="flex justify-end gap-2">
                <Button
                    type="outlined"
                    :disabled="databaseOperationBusy"
                    @click="cancelDatabaseOperation"
                    ><XIcon />
                    {{ formatMessage(messages.cancel) }}
                </Button>
                <Button
                    type="colored"
                    color="brand"
                    :disabled="databaseOperationBusy"
                    @click="confirmDatabaseOperation"
                    ><RefreshCwIcon :class="{ 'animate-spin': databaseOperationBusy }" />
                    {{ formatMessage(messages.databaseOperationConfirm) }}
                </Button>
            </div>
        </template>
    </NewModal>
</template>

<style scoped>
.update-manual-panel {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--gap-md);
    padding: var(--gap-lg);
}

.update-manual-heading {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
}

.database-isolation {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
    gap: var(--gap-lg);
    margin: 0 var(--gap-lg) var(--gap-lg);
    padding: var(--gap-md);
    border: 1px solid var(--surface-4);
    border-radius: var(--radius-md);
    background: var(--surface-1);
}

.database-isolation-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--gap-sm);
}

.database-path {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--gap-xs);
    color: var(--color-text-tertiary);
    font-size: 0.9375rem;
}

.database-path code {
    overflow-wrap: anywhere;
    color: var(--color-text-primary);
    font-family: var(--mono-font, monospace);
}

.database-operation {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    color: var(--color-text-tertiary);
    font-size: 0.9375rem;
}

.database-operation-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-sm);
}

.database-diagram {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--gap-sm);
    min-width: 0;
}

.database-channel {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    padding: var(--gap-sm);
    border: 1px solid var(--surface-4);
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    color: var(--color-text-primary);
    text-align: center;
}

.database-channel > span {
    display: grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    border-radius: 50%;
    background: var(--color-brand);
    color: var(--color-button-text);
    font-weight: 700;
}

.database-channel small {
    color: var(--color-brand);
    font-size: 0.7rem;
    font-weight: 600;
}

.database-channel-beta > span {
    background: var(--color-purple, var(--color-brand));
}

.database-branch {
    width: 2.5rem;
    height: 1px;
    background: var(--surface-5);
}

.update-channel-panel {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
    padding: var(--gap-lg);
}

.update-channel-options {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--gap-md);
    width: 100%;
}

.update-channel-card {
    display: flex;
    width: 100%;
    min-width: 0;
    padding: var(--gap-md);
    border: 1px solid var(--surface-4);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    color: var(--color-text-tertiary);
    text-align: left;
    cursor: pointer;
    transition:
        border-color 150ms ease,
        background-color 150ms ease,
        color 150ms ease,
        transform 150ms ease;
}

.update-channel-card:hover {
    border-color: color-mix(in srgb, var(--color-brand) 55%, var(--surface-4));
    background: var(--surface-3);
}

.update-channel-card:active {
    transform: scale(0.98);
}

.update-channel-card:focus-visible {
    outline: 2px solid var(--color-brand);
    outline-offset: 2px;
}

.update-channel-card-selected {
    border-color: var(--color-brand);
    background: color-mix(in srgb, var(--color-brand) 12%, var(--surface-1));
}

.update-channel-card-title {
    color: var(--color-text-primary);
    font-weight: 600;
}

@media (max-width: 640px) {
    .database-isolation {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
