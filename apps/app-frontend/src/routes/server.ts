import './meta'

import type { RouteRecordRaw } from 'vue-router'

import { isWebMapConfigured } from '@/helpers/server-connection'
import { loadServerWebMapUrl } from '@/helpers/server-web-map'

/**
 * 服务器专属页面。
 *
 * 与 `utility.ts` / `discover.ts` 等既有域表并列，由 `routes/index.ts` 汇总。
 * 新增服务器相关页面时，在这里加一条即可。
 */
export const serverRoutes: RouteRecordRaw[] = [
    {
        path: '/map',
        name: 'ServerMap',
        component: () => import('@/pages/ServerMap.vue'),
        /**
         * 网页地图地址按「实例 → 全局设置 → 构建期环境变量」解析，三者都为空
         * 就没有地图可看。这时直接进 `/map` 只会得到一个空 iframe，所以改跳回
         * 首页 —— 这就是需求里的「不填就不显示网页地图」在路由层的兜底。
         * 地址由哪个实例提供见 `helpers/server-web-map.ts`。
         */
        beforeEnter: async () =>
            isWebMapConfigured(await loadServerWebMapUrl()) ? true : { path: '/' },
        meta: {
            breadcrumb: [{ name: 'Server map' }],
            discordActivity: 'Viewing the server map...',
        },
    },
    {
        path: '/changelog',
        name: 'ServerChangelog',
        component: () => import('@/pages/Changelog.vue'),
        meta: {
            breadcrumb: [{ name: 'Changelog' }],
            discordActivity: 'Reading the changelog...',
        },
    },
]
