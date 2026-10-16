<script setup lang="ts">
import { ServerIcon, TriangleAlertIcon } from '@modrinth/assets'
import { defineMessages, useVIntl } from '@modrinth/ui'
import { computed } from 'vue'

import type { ClientModInstallBlockReason } from '@/helpers/client-mod-browse'

const props = defineProps<{
    reason: ClientModInstallBlockReason
}>()

const { formatMessage } = useVIntl()

/**
 * Mirrors the reasoning in `helpers/client-mod-browse.ts`: a mod the server has
 * to run as well cannot live only in the player's own `clientmods/` folder, so
 * the page withholds the install button and says so instead of letting the
 * player discover it as a broken game.
 */
const messages = defineMessages({
    serverRequiredTitle: {
        id: 'app.project.install-blocked.server-required.title',
        defaultMessage: 'This mod has to be installed on the server too',
    },
    serverRequiredDescription: {
        id: 'app.project.install-blocked.server-required.description',
        defaultMessage:
            "It only works when the server runs it as well, and the server's content belongs to the pack you joined — you cannot add anything to it from here. Putting it in your own client mods folder would break the game, so the launcher does not offer an install.",
    },
    unverifiedTitle: {
        id: 'app.project.install-blocked.unverified.title',
        defaultMessage: 'Cannot confirm this mod works on the client alone',
    },
    unverifiedDescription: {
        id: 'app.project.install-blocked.unverified.description',
        defaultMessage:
            'This source does not publish whether a mod has to be installed on the server, so the launcher cannot tell whether a client-only install is safe. Rather than risk a game that no longer works, it does not offer an install here.',
    },
})

const title = computed(() =>
    formatMessage(
        props.reason === 'server-required'
            ? messages.serverRequiredTitle
            : messages.unverifiedTitle,
    ),
)
const description = computed(() =>
    formatMessage(
        props.reason === 'server-required'
            ? messages.serverRequiredDescription
            : messages.unverifiedDescription,
    ),
)
const icon = computed(() => (props.reason === 'server-required' ? ServerIcon : TriangleAlertIcon))
</script>

<template>
    <div
        class="flex max-w-xl items-start gap-2 rounded-lg border border-warning bg-warning-bg p-3"
        role="note"
    >
        <component :is="icon" class="mt-0.5 size-5 shrink-0" />
        <div class="min-w-0">
            <p class="m-0 font-semibold text-[var(--color-text-primary)]">{{ title }}</p>
            <p class="mt-1 mb-0 text-sm text-[var(--color-text-tertiary)]">{{ description }}</p>
        </div>
    </div>
</template>
