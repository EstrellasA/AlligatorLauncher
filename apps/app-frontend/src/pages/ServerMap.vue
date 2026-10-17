<script setup lang="ts">
import { ExternalIcon, RefreshCwIcon } from '@modrinth/assets'
import { defineMessages, useVIntl } from '@modrinth/ui'
import { openUrl } from '@tauri-apps/plugin-opener'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { useServerWebMap } from '@/composables/useServerWebMap'
import { isWebMapConfigured } from '@/helpers/server-connection'
import { ServerConfig } from '@/server-config'

const { formatMessage } = useVIntl()
const router = useRouter()

const messages = defineMessages({
    openInBrowser: {
        id: 'app.server.map.open-in-browser',
        defaultMessage: 'Open in browser',
    },
    reload: {
        id: 'app.server.map.reload',
        defaultMessage: 'Reload map',
    },
    loading: {
        id: 'app.server.map.loading',
        defaultMessage: 'Loading the map...',
    },
    notEmbeddableTitle: {
        id: 'app.server.map.not-embeddable.title',
        defaultMessage: 'This map cannot be embedded',
    },
    notEmbeddableBody: {
        id: 'app.server.map.not-embeddable.body',
        defaultMessage:
            'The map server refuses to be displayed inside another application. Open it in your browser instead.',
    },
})

/**
 * 地图地址来自实例设置（见 `helpers/server-web-map.ts`），不再写死在这里。
 * `mapEmbeddable` 仍然是构建期常量：那是「这家地图服务允不允许被内嵌」的
 * 服务端特性，不是玩家能改的东西。
 */
const { mapUrl, loaded } = useServerWebMap()

/**
 * 地址被清空时这里就退化成空 iframe，所以直接回首页；路由守卫已经做了同样的
 * 判断，这里是「停在地图页时把地址清掉」的兜底。
 */
watch([loaded, mapUrl], ([isLoaded, url]) => {
    if (isLoaded && !isWebMapConfigured(url)) void router.replace('/')
})

/**
 * 每次点「刷新」就换一次 key，强制 iframe 重新挂载。
 * 直接改 src 到同一个地址不会触发重载，所以用 key 更可靠。
 */
const frameKey = ref(0)
const loading = ref(true)

function reload() {
    loading.value = true
    frameKey.value += 1
}

function onFrameLoad() {
    loading.value = false
}

/**
 * 页面被切走时把 loading 复位，避免下次进来一直显示遮罩。
 */
onMounted(() => {
    loading.value = true
})

onUnmounted(() => {
    loading.value = false
})
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <div v-if="!ServerConfig.mapEmbeddable" class="flex flex-1 items-center justify-center p-8">
            <div
                class="max-w-md rounded-2xl border border-solid border-divider bg-surface-2 p-6 text-center"
            >
                <h2 class="m-0 mb-2 text-lg font-semibold text-contrast">
                    {{ formatMessage(messages.notEmbeddableTitle) }}
                </h2>
                <p class="m-0 mb-4 text-secondary">
                    {{ formatMessage(messages.notEmbeddableBody) }}
                </p>
                <button
                    type="button"
                    class="inline-flex cursor-pointer items-center gap-2 rounded-full border-0 bg-brand px-4 py-2 font-semibold text-contrast"
                    @click="openUrl(mapUrl)"
                >
                    <ExternalIcon class="h-4 w-4" />
                    {{ formatMessage(messages.openInBrowser) }}
                </button>
            </div>
        </div>

        <template v-else>
            <!-- 工具条 -->
            <div class="flex shrink-0 items-center justify-end gap-2 px-4 py-2">
                <button
                    v-tooltip="formatMessage(messages.reload)"
                    type="button"
                    class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-secondary hover:bg-surface-4 hover:text-contrast"
                    :aria-label="formatMessage(messages.reload)"
                    @click="reload"
                >
                    <RefreshCwIcon class="h-4 w-4" />
                </button>
                <button
                    v-tooltip="formatMessage(messages.openInBrowser)"
                    type="button"
                    class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-secondary hover:bg-surface-4 hover:text-contrast"
                    :aria-label="formatMessage(messages.openInBrowser)"
                    @click="openUrl(mapUrl)"
                >
                    <ExternalIcon class="h-4 w-4" />
                </button>
            </div>

            <!-- 地图本体 -->
            <div class="relative min-h-0 flex-1">
                <div
                    v-if="loading"
                    class="absolute inset-0 z-10 flex items-center justify-center text-secondary"
                >
                    {{ formatMessage(messages.loading) }}
                </div>
                <iframe
                    :key="frameKey"
                    :src="mapUrl"
                    class="h-full w-full border-0"
                    referrerpolicy="no-referrer"
                    @load="onFrameLoad"
                />
            </div>
        </template>
    </div>
</template>
