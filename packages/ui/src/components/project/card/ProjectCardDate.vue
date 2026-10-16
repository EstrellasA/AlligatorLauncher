<script setup lang="ts">
import { CalendarIcon, HistoryIcon } from '@modrinth/assets'
import { capitalizeString } from '@modrinth/utils'
import { computed } from 'vue'

import { defineMessage, useFormatDateTime, useRelativeTime, useVIntl } from '../../../composables'

const { formatMessage } = useVIntl()

const formatRelativeTime = useRelativeTime()
const formatDateTime = useFormatDateTime({
    timeStyle: 'short',
    dateStyle: 'long',
})

const props = defineProps<{
    date: Date
    type: 'updated' | 'published'
}>()

const formattedDate = computed(() => formatDateTime(props.date))

const types = {
    updated: {
        icon: HistoryIcon,
        tooltip: defineMessage({
            id: 'project-card.date.updated.tooltip',
            defaultMessage: 'Updated {date}',
        }),
    },
    published: {
        icon: CalendarIcon,
        tooltip: defineMessage({
            id: 'project-card.date.published.tooltip',
            defaultMessage: 'Published {date}',
        }),
    },
}

const tooltip = computed(() =>
    capitalizeString(formatMessage(types[props.type].tooltip, { date: formattedDate.value })),
)
</script>

<template>
    <div
        v-tooltip="tooltip"
        class="flex min-w-0 items-center gap-2 smart-clickable:allow-pointer-events"
    >
        <component :is="types[props.type].icon" class="size-5 shrink-0" />
        <span class="min-w-0 truncate">{{ capitalizeString(formatRelativeTime(date)) }}</span>
    </div>
</template>
