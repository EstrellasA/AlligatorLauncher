/**
 * 服务器专属配置 —— 本定制启动器唯一需要你日常维护的文件。
 *
 * 把「换个服务器就要改哪些地方」全部收敛到这里，避免散落在各个组件里。
 * 改完这个文件，首页/地图页/更新页/更新通道的行为都会跟着变。
 *
 * ⚠️ 注意与 `src/config.ts` 的分工：
 *   - `config.ts`   = 启动器品牌（名称、图标标识、深链、官网/支持链接）
 *   - `server-config.ts`（本文件） = 你这台服务器的具体参数
 */

import { reactive } from 'vue'

import {
    isServerAddressConfigured,
    normalizeServerAddress,
    normalizeServerMapUrl,
    resolveServerAddress,
    resolveServerMapUrl,
} from '@/helpers/server-connection'
import { type AppSettings, get as getSettings, update as updateSettings } from '@/helpers/settings'

/**
 * Build-time fallbacks, for a launcher built with a pre-configured server.
 *
 * They are only consulted when the player has not saved a value in the
 * settings page (「设置 → 服务器」), so a normal install follows the setting and
 * an untouched install keeps behaving exactly as it did before the setting
 * existed.
 */
const BUILD_TIME_SERVER_ADDRESS = (import.meta.env.VITE_AXO_SERVER_ADDRESS ?? '').trim()
const BUILD_TIME_WEB_MAP_URL = (import.meta.env.VITE_AXO_WEB_MAP_URL ?? '').trim()

/**
 * The single mutable source of truth for the two player-editable values.
 *
 * `ServerConfig` exposes them through getters, so every existing
 * `ServerConfig.serverAddress` / `ServerConfig.mapUrl` read keeps working while
 * a computed property or template that reads it re-runs as soon as the saved
 * setting changes. Nothing else may cache these values.
 */
const storedServerConnection = reactive({
    serverAddress: '',
    serverMapUrl: '',
})

export type StoredServerConnection = Pick<AppSettings, 'server_address' | 'server_map_url'>

/** Copy persisted settings into the reactive store (called after every read/save). */
export function applyServerConnectionSettings(
    settings: StoredServerConnection | null | undefined,
): void {
    storedServerConnection.serverAddress = normalizeServerAddress(settings?.server_address)
    storedServerConnection.serverMapUrl = normalizeServerMapUrl(settings?.server_map_url)
}

/** The stored values, trimmed and validated; empty means "not configured". */
export function getStoredServerConnection(): { serverAddress: string; serverMapUrl: string } {
    return {
        serverAddress: storedServerConnection.serverAddress,
        serverMapUrl: storedServerConnection.serverMapUrl,
    }
}

/**
 * Whether the effective address is a real one rather than the placeholder.
 *
 * The first-run overlay uses this to skip its address step for a pre-configured
 * build (env value) and for a returning player (saved setting). It deliberately
 * runs through the same resolution as every other consumer, so "configured"
 * can never disagree with the address the launcher would actually ping.
 */
export function hasConfiguredServerAddress(): boolean {
    return isServerAddressConfigured(
        storedServerConnection.serverAddress,
        BUILD_TIME_SERVER_ADDRESS,
    )
}

/**
 * The one write path for both the settings page and the first-run prompt.
 *
 * Validation happens in the UI before calling this; the normalisers are the
 * same ones the getters use, so a value that reaches the database is always the
 * value the rest of the launcher resolves against. Applying the returned
 * settings immediately updates every reactive consumer.
 */
export async function saveServerConnectionSettings(values: {
    serverAddress: string
    serverMapUrl: string
}): Promise<void> {
    const saved = await updateSettings({
        server_address: normalizeServerAddress(values.serverAddress),
        server_map_url: normalizeServerMapUrl(values.serverMapUrl),
    })
    applyServerConnectionSettings(saved)
    serverConnectionLoaded = true
}

let serverConnectionLoaded = false
let serverConnectionLoading: Promise<void> | null = null

/**
 * Read the persisted settings once, for code that runs before `App.vue` has
 * hydrated the store (the first-run bootstrap can start in a mounted child
 * overlay before the root component's initialization finishes).
 *
 * A failure leaves the store untouched, so the build-time value keeps applying
 * and a later call retries.
 */
export async function ensureServerConnectionSettingsLoaded(): Promise<void> {
    if (serverConnectionLoaded) return
    if (serverConnectionLoading) return await serverConnectionLoading

    serverConnectionLoading = (async () => {
        try {
            applyServerConnectionSettings(await getSettings())
            serverConnectionLoaded = true
        } catch (error) {
            console.warn(
                'Server settings: could not read the stored connection values, using the built-in ones',
                error,
            )
        }
    })()

    try {
        await serverConnectionLoading
    } finally {
        serverConnectionLoading = null
    }
}

export const ServerConfig = {
    // ---------------------------------------------------------------------
    // 服务器
    // ---------------------------------------------------------------------

    /**
     * Minecraft 服务器地址（用于首页状态卡片和「一键进服」）。
     * 格式：`域名` 或 `域名:端口`。默认端口 25565 时可省略 `:25565`。
     *
     * 取值顺序是 **设置页 → 构建期环境变量 → 占位值**：
     *
     *   1. 玩家在「设置 → 服务器 → 服务器地址」里保存的值（存在本地数据库里）；
     *   2. 构建时的 `VITE_AXO_SERVER_ADDRESS`，只为「预配置二进制」保留；
     *   3. `example.invalid`（RFC 2606 保留域名），让漏配的构建明显连不上。
     *
     * 这里用 getter 读取响应式 store，因此改设置后首页状态和进服按钮
     * **无需重启**就会跟进；不要在别处缓存这个字段。
     */
    get serverAddress(): string {
        return resolveServerAddress(storedServerConnection.serverAddress, BUILD_TIME_SERVER_ADDRESS)
    },

    /** 服务器展示名，会出现在首页和进服按钮上。 */
    serverName: 'ALLIGATORZONE',

    // ---------------------------------------------------------------------
    // 游戏版本 —— 首次运行建实例时用
    // ---------------------------------------------------------------------

    /**
     * 客户端必须使用的 Minecraft / 加载器版本，首次运行创建实例时按这里来。
     *
     * ⚠️ 这三个值必须和服务端**严格一致**。客户端 NeoForge 版本偏高时，
     *    那些还没跟进更新的 mod 会加载失败。所以不要「用最新版」，要用服务器在跑的那版。
     *
     * ⚠️ 服务端升级 NeoForge 后，必须改这里并**重新编译启动器发给玩家**。
     *    （评估过远程配置方案，因托管条件不具备而放弃。）
     *
     * 当前值来源：`latest.log` 里 "NeoForge mod loading, version 21.1.252, for MC 1.21.1"。
     */
    gameVersion: '1.21.1',
    loader: 'neoforge',
    loaderVersion: '21.1.252',

    // ---------------------------------------------------------------------
    // 两个 mod 文件夹
    // ---------------------------------------------------------------------

    /**
     * 服务器整合包 mod 的存放目录（相对游戏根目录）。
     *
     * 这个目录由 AutoModpack 通过服务端 `editable: [mods/*, mods/**]` 写入，
     * 启动器只读展示，不做增删 —— 否则会和 AutoModpack 抢同一个目录。
     */
    serverModsFolder: 'mods',

    /**
     * 玩家自选客户端 mod 的存放目录（相对游戏根目录）。
     *
     * 这个目录**不是** Minecraft 原生加载的目录，靠随启动器分发的
     * **AlligatorZone Core** 这个 NeoForge mod（`IModFileCandidateLocator`）
     * 注册给加载器。实测日志里能看到：
     *     Found mod file "MouseTweaks-...jar" [locator: zone.alligatorzone.core.ClientModsLocator@...]
     */
    clientModsFolder: 'clientmods',

    // ---------------------------------------------------------------------
    // 网页地图
    // ---------------------------------------------------------------------

    /**
     * 网页地图地址的**全局默认值**。
     *
     * 取值顺序与 `serverAddress` 相同：设置页保存的值 → 构建期
     * `VITE_AXO_WEB_MAP_URL` → 空。空字符串表示「没有网页地图」，
     * 所有入口（侧边栏按钮、`/map` 路由）都会隐藏，不会渲染空 iframe。
     *
     * 实例设置里的 `web_map_url` 仍然优先于这里（见
     * `helpers/server-web-map.ts`）：实例里保存过值就以实例为准，
     * 从未设置过才回落到这个全局值。
     *
     * ⚠️ CSP：`apps/app/tauri.conf.json` 里 `app.security.csp.frame-src` 和
     *    `app.security.devCsp.frame-src` 已放宽为 `http: https:`，允许内嵌任意
     *    http(s) 来源 —— 这正是「不重新编译也能换地址」的代价：地图来源不再受
     *    白名单限制，被内嵌的页面可以来自任何 http(s) 站点。`self`、`asset:`、
     *    `ipc:` 和原有的具名来源都保持原样，`script-src` 也未额外放宽。
     *    ⚠️ tauri.conf.json 是严格 JSON，写不了注释，所以说明记在这里。
     *    因为 `http:`/`https:` 已经涵盖一切来源，frame-src 里**不再**列出具体
     *    主机：列了既没有额外作用，又会把内网地图地址写进公开仓库。
     *
     * ⚠️ 真实地址同样**不写在这里**，由玩家在设置页填写，或构建时用
     *    `VITE_AXO_WEB_MAP_URL` 注入，理由和 `serverAddress` 完全一致。
     */
    get mapUrl(): string {
        return resolveServerMapUrl(storedServerConnection.serverMapUrl, BUILD_TIME_WEB_MAP_URL)
    },

    /**
     * 地图服务是否允许被 iframe 内嵌。
     * 若地图服务端返回了 `X-Frame-Options` 或 CSP 的 `frame-ancestors`，
     * 浏览器会拒绝内嵌，此时把这里设为 false，页面会改为「用系统浏览器打开」。
     */
    mapEmbeddable: true,

    // ---------------------------------------------------------------------
    // 更新渠道
    // ---------------------------------------------------------------------

    // 「更新笔记」页不再读取 Modrinth 项目：本服务器用 AutoModpack 分发整合包，
    // 没有对应的 Modrinth 项目，所以那一页改成直接读实例里的
    // `automodpack/client/history/<modpackId>/journal.jsonl`（见
    // `helpers/server-changelog.ts`）。原先的 `modrinthProject` 字段已随之删除。

    /**
     * 自建补充清单地址（用于 FTB 等 CurseForge 独占模组）。
     *
     * 由 `scripts/audit-mods.mjs --resolve-cf-urls` 生成，
     * 格式见该脚本输出的 `curseforgeSupplement` 字段。
     *
     * 留空表示暂时不用补充通道。
     */
    supplementManifestUrl: '',

    /**
     * 每次启动是否自动检查客户端内容更新。
     */
    autoUpdateContent: true,

    /**
     * 服务器公告服务的地址。
     *
     * ⚠️ 留空 = 关闭远程公告功能。**请务必不要保留上游默认值**：
     *    上游地址是 ALLIGATORZONE 官方的，不改的话你的启动器会拉取并显示
     *    ALLIGATORZONE 的公告，看起来非常奇怪。
     *
     * 接口需返回 `{ announcements: [...] }`，字段格式见
     * `src/components/ui/RemoteAnnouncements.vue` 里的 `parseAnnouncements`。
     */
    announcementsUrl: '',

    // ---------------------------------------------------------------------
    // 版权 / 合规
    // ---------------------------------------------------------------------

    /**
     * 本定制版的源码地址。
     *
     * ⚠️ ALLIGATORZONE 桌面端是 GPL-3.0-only 强著佐权许可：
     *    你向玩家分发编译后的启动器，就必须同时提供完整对应源码。
     *    请把这个字段填成你实际托管源码的地址（公开仓库或随包附带的源码包）。
     */
    sourceCodeUrl: '',
}

export type ServerConfigShape = typeof ServerConfig
