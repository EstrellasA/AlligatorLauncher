<script setup lang="ts">
import { Combobox, defineMessages, injectNotificationManager, Toggle, useVIntl } from '@modrinth/ui'
import { onMounted, ref } from 'vue'

import { get_log_share_settings, update_log_share_settings } from '@/helpers/logs'

import SettingsRow from './SettingsRow.vue'
import SettingsSection from './SettingsSection.vue'

type LogShareSettings = {
    share_provider: 'logshare' | 'mclogs'
    ai_source: string
    auto_upload: boolean
    multi_file: boolean
    no_storage: boolean
    show_progress: boolean
}

const { formatMessage } = useVIntl()
const { handleError } = injectNotificationManager()
const settings = ref<LogShareSettings>({
    share_provider: 'logshare',
    ai_source: 'logshare',
    auto_upload: true,
    multi_file: true,
    no_storage: false,
    show_progress: true,
})
const loading = ref(true)
const saving = ref(false)

const messages = defineMessages({
    title: { id: 'app.log-share.settings.title', defaultMessage: 'Log sharing' },
    description: {
        id: 'app.log-share.settings.description',
        defaultMessage:
            'Share crash diagnostics with LogShare for a structured summary and optional AI analysis. LogShare is preferred; mclo.gs is used as a fallback.',
    },
    shareProvider: {
        id: 'app.log-share.settings.share-provider',
        defaultMessage: 'Log sharing service',
    },
    shareProviderDescription: {
        id: 'app.log-share.settings.share-provider-description',
        defaultMessage: 'Where the diagnostic link is uploaded when you share it.',
    },
    autoUpload: {
        id: 'app.log-share.settings.auto-upload',
        defaultMessage: 'Upload to get a structured summary automatically',
    },
    autoUploadDescription: {
        id: 'app.log-share.settings.auto-upload-description',
        defaultMessage: 'Only effective in LogShare AI mode.',
    },
    multiFile: { id: 'app.log-share.settings.multi-file', defaultMessage: 'Multi-file upload' },
    multiFileDescription: {
        id: 'app.log-share.settings.multi-file-description',
        defaultMessage: 'Upload latest.log, crash reports, hs_err and launcher logs together.',
    },
    noStorage: {
        id: 'app.log-share.settings.no-storage',
        defaultMessage: 'Analyze without storing logs',
    },
    noStorageDescription: {
        id: 'app.log-share.settings.no-storage-description',
        defaultMessage:
            'Submit content directly for analysis and skip the stored upload. Disables the automatic summary.',
    },
    showProgress: {
        id: 'app.log-share.settings.show-progress',
        defaultMessage: 'Show AI analysis progress',
    },
    showProgressDescription: {
        id: 'app.log-share.settings.show-progress-description',
        defaultMessage: 'Display thinking, tool and limit status while LogShare AI is working.',
    },
})

const shareProviderOptions = [
    { value: 'logshare', label: 'LogShare' },
    { value: 'mclogs', label: 'mclo.gs' },
]

async function saveShare(next: LogShareSettings): Promise<void> {
    saving.value = true
    try {
        const payload = { ...next, ai_source: 'logshare' }
        await update_log_share_settings(payload)
        settings.value = payload
    } catch (error) {
        handleError(error)
    } finally {
        saving.value = false
    }
}

function updateShare(patch: Partial<LogShareSettings>): void {
    void saveShare({ ...settings.value, ...patch })
}

function selectShareProvider(value: unknown): void {
    const provider = value === 'mclogs' ? 'mclogs' : 'logshare'
    updateShare({ share_provider: provider })
}

onMounted(async () => {
    try {
        settings.value = await get_log_share_settings()
    } catch (error) {
        handleError(error)
    } finally {
        loading.value = false
    }
})
</script>

<template>
    <SettingsSection
        v-if="!loading"
        id="settings-target-log-share"
        :title="formatMessage(messages.title)"
        :description="formatMessage(messages.description)"
    >
        <SettingsRow>
            <template #label>{{ formatMessage(messages.shareProvider) }}</template>
            <template #description>{{ formatMessage(messages.shareProviderDescription) }}</template>
            <template #control>
                <Combobox
                    id="log-share-provider"
                    :model-value="settings.share_provider"
                    :options="shareProviderOptions"
                    :disabled="saving"
                    @update:model-value="selectShareProvider($event)"
                />
            </template>
        </SettingsRow>
        <SettingsRow>
            <template #label>{{ formatMessage(messages.autoUpload) }}</template>
            <template #description>{{ formatMessage(messages.autoUploadDescription) }}</template>
            <template #control>
                <Toggle
                    id="log-share-auto-upload"
                    :model-value="settings.auto_upload"
                    :disabled="saving || settings.no_storage"
                    @update:model-value="updateShare({ auto_upload: !!$event })"
                />
            </template>
        </SettingsRow>
        <SettingsRow>
            <template #label>{{ formatMessage(messages.multiFile) }}</template>
            <template #description>{{ formatMessage(messages.multiFileDescription) }}</template>
            <template #control>
                <Toggle
                    id="log-share-multi-file"
                    :model-value="settings.multi_file"
                    :disabled="saving"
                    @update:model-value="updateShare({ multi_file: !!$event })"
                />
            </template>
        </SettingsRow>
        <SettingsRow>
            <template #label>{{ formatMessage(messages.noStorage) }}</template>
            <template #description>{{ formatMessage(messages.noStorageDescription) }}</template>
            <template #control>
                <Toggle
                    id="log-share-no-storage"
                    :model-value="settings.no_storage"
                    :disabled="saving"
                    @update:model-value="updateShare({ no_storage: !!$event })"
                />
            </template>
        </SettingsRow>
        <SettingsRow>
            <template #label>{{ formatMessage(messages.showProgress) }}</template>
            <template #description>{{ formatMessage(messages.showProgressDescription) }}</template>
            <template #control>
                <Toggle
                    id="log-share-show-progress"
                    :model-value="settings.show_progress"
                    :disabled="saving"
                    @update:model-value="updateShare({ show_progress: !!$event })"
                />
            </template>
        </SettingsRow>
    </SettingsSection>
</template>
