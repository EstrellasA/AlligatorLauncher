<script setup lang="ts">
import { SaveIcon } from '@modrinth/assets'
import {
    Button,
    defineMessages,
    injectNotificationManager,
    StyledInput,
    useVIntl,
} from '@modrinth/ui'
import { computed, ref } from 'vue'

import { isValidServerAddress, isValidWebMapUrl } from '@/helpers/server-connection'
import { get as getSettings } from '@/helpers/settings'
import {
    applyServerConnectionSettings,
    getStoredServerConnection,
    saveServerConnectionSettings,
} from '@/server-config'

import SettingsRow from './SettingsRow.vue'
import SettingsSaveStatus from './SettingsSaveStatus.vue'
import SettingsSection from './SettingsSection.vue'

const { formatMessage } = useVIntl()
const { addNotification, handleError } = injectNotificationManager()

const messages = defineMessages({
    title: {
        id: 'app.settings.server.section-title',
        defaultMessage: 'Server connection',
    },
    fallbackNote: {
        id: 'app.settings.server.fallback-note',
        defaultMessage:
            'Leave a field empty to use the value built into this launcher. The server address is used by the home status card and the join button; an empty web map address hides the map page and its navigation button.',
    },
    address: {
        id: 'app.settings.server.address',
        defaultMessage: 'Server address',
    },
    addressDescription: {
        id: 'app.settings.server.address-description',
        defaultMessage:
            'The Minecraft server address, for example host or host:port. Do not include a protocol or a path.',
    },
    addressPlaceholder: {
        id: 'app.settings.server.address-placeholder',
        defaultMessage: 'play.example.com:25565',
    },
    map: {
        id: 'app.settings.server.map',
        defaultMessage: 'Server web map',
    },
    mapDescription: {
        id: 'app.settings.server.map-description',
        defaultMessage:
            'Optional web map URL. When neither this nor the per-instance address is set, the map page and its navigation button are hidden.',
    },
    mapPlaceholder: {
        id: 'app.settings.server.map-placeholder',
        defaultMessage: 'https://map.example.com/',
    },
    save: {
        id: 'app.settings.server.save',
        defaultMessage: 'Save server settings',
    },
    saved: {
        id: 'app.settings.server.saved',
        defaultMessage: 'Server settings saved',
    },
    addressInvalid: {
        id: 'app.settings.server.address-invalid',
        defaultMessage:
            'Enter a host or host:port without a protocol, a path, or spaces, or leave it empty.',
    },
    mapInvalid: {
        id: 'app.settings.server.map-invalid',
        defaultMessage: 'Enter a complete http:// or https:// address, or leave it empty.',
    },
})

/**
 * Read the authoritative values once, then keep the reactive store in sync so a
 * save immediately updates the home status card and the map entry, without a
 * restart. `getStoredServerConnection` is the same normalised value the rest of
 * the launcher resolves against.
 */
const initialSettings = await getSettings()
applyServerConnectionSettings(initialSettings)
const stored = getStoredServerConnection()

const addressInput = ref(stored.serverAddress)
const mapInput = ref(stored.serverMapUrl)
const savedAddress = ref(stored.serverAddress)
const savedMapUrl = ref(stored.serverMapUrl)
const saving = ref(false)
const lastSaveState = ref<'idle' | 'saved' | 'error'>('idle')
const retrySave = ref<(() => void) | undefined>()

const addressInvalid = computed(
    () => addressInput.value.trim() !== '' && !isValidServerAddress(addressInput.value),
)
const mapInvalid = computed(() => mapInput.value.trim() !== '' && !isValidWebMapUrl(mapInput.value))
const dirty = computed(
    () =>
        addressInput.value.trim() !== savedAddress.value ||
        mapInput.value.trim() !== savedMapUrl.value,
)
const saveStatus = computed(() => {
    if (saving.value) return 'saving'
    return lastSaveState.value
})
const canSave = computed(
    () => dirty.value && !addressInvalid.value && !mapInvalid.value && !saving.value,
)

async function save() {
    if (!canSave.value) return

    saving.value = true
    lastSaveState.value = 'idle'
    retrySave.value = undefined

    try {
        await saveServerConnectionSettings({
            serverAddress: addressInput.value,
            serverMapUrl: mapInput.value,
        })

        const next = getStoredServerConnection()
        savedAddress.value = next.serverAddress
        savedMapUrl.value = next.serverMapUrl
        addressInput.value = next.serverAddress
        mapInput.value = next.serverMapUrl
        lastSaveState.value = 'saved'
        addNotification({ type: 'success', title: formatMessage(messages.saved) })
    } catch (error) {
        lastSaveState.value = 'error'
        retrySave.value = () => void save()
        handleError(error)
    } finally {
        saving.value = false
    }
}
</script>

<template>
    <SettingsSection
        :title="formatMessage(messages.title)"
        :description="formatMessage(messages.fallbackNote)"
        title-id="settings-target-server"
    >
        <template #extra>
            <SettingsSaveStatus :status="saveStatus" :retry="retrySave" />
        </template>
        <SettingsRow stacked>
            <template #label>
                <span id="settings-target-server-address" tabindex="-1">
                    {{ formatMessage(messages.address) }}
                </span>
            </template>
            <template #description>
                {{ formatMessage(messages.addressDescription) }}
            </template>
            <template #control>
                <div class="flex w-full flex-col gap-2">
                    <StyledInput
                        id="server-address"
                        v-model="addressInput"
                        autocomplete="off"
                        type="text"
                        :error="addressInvalid"
                        :placeholder="formatMessage(messages.addressPlaceholder)"
                        :spellcheck="false"
                        :input-attrs="{
                            'aria-labelledby': 'settings-target-server-address',
                            'aria-invalid': addressInvalid,
                        }"
                        wrapper-class="w-full"
                    />
                    <p v-if="addressInvalid" class="m-0 text-sm text-red">
                        {{ formatMessage(messages.addressInvalid) }}
                    </p>
                </div>
            </template>
        </SettingsRow>
        <SettingsRow stacked>
            <template #label>
                <span id="settings-target-server-map" tabindex="-1">
                    {{ formatMessage(messages.map) }}
                </span>
            </template>
            <template #description>
                {{ formatMessage(messages.mapDescription) }}
            </template>
            <template #control>
                <div class="flex w-full flex-col gap-2">
                    <StyledInput
                        id="server-web-map"
                        v-model="mapInput"
                        autocomplete="off"
                        type="url"
                        :error="mapInvalid"
                        :placeholder="formatMessage(messages.mapPlaceholder)"
                        :spellcheck="false"
                        :input-attrs="{
                            'aria-labelledby': 'settings-target-server-map',
                            'aria-invalid': mapInvalid,
                        }"
                        wrapper-class="w-full"
                    />
                    <p v-if="mapInvalid" class="m-0 text-sm text-red">
                        {{ formatMessage(messages.mapInvalid) }}
                    </p>
                </div>
            </template>
        </SettingsRow>
        <div class="settings-actions flex justify-end p-4">
            <Button
                type="colored"
                color="brand"
                native-type="button"
                :disabled="!canSave"
                @click="save"
            >
                <SaveIcon />
                {{ formatMessage(messages.save) }}
            </Button>
        </div>
    </SettingsSection>
</template>

<style scoped>
.settings-actions {
    border-top: 1px solid
        var(--settings-divider, color-mix(in srgb, var(--surface-4) 55%, transparent));
}
</style>
