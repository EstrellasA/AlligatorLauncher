<template>
    <Card>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="markdown-body" v-html="renderHighlightedString(project.body ?? '')" />
    </Card>
</template>

<script setup>
import { Card } from '@modrinth/ui'
import { renderHighlightedString } from '@modrinth/utils'

defineProps({
    project: {
        type: Object,
        default: () => {},
    },
})
</script>

<script>
export default {
    name: 'Description',
}
</script>
