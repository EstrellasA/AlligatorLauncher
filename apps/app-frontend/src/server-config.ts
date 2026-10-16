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

export const ServerConfig = Object.freeze({
    // ---------------------------------------------------------------------
    // 服务器
    // ---------------------------------------------------------------------

    /**
     * Minecraft 服务器地址（用于「一键进服」）。
     * 格式：`域名` 或 `域名:端口`。默认端口 25565 时可省略 `:25565`。
     */
    serverAddress: 'i.alligator.zone',

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
     * 网页地图地址的**内置默认值**。
     *
     * 只在两种情况下生效：
     *   1. 首次运行 bootstrap 建实例时，写进该实例的「网页地图地址」；
     *   2. 实例里从未设置过这个地址（`web_map_url` 为 NULL）时兜底，
     *      这样老玩家升级后不会突然看不到地图。
     *
     * 之后玩家可以在「实例设置 → 常规 → 网页地图」里随时改：填了就出现地图页
     * 和侧边栏按钮，清空就隐藏并禁用（空字符串是「明确关掉」，不会再退回这里）。
     * 也就是说，换服务器 / 换地图**不需要重新编译启动器**。
     *
     * ⚠️ CSP：`apps/app/tauri.conf.json` 里 `app.security.csp.frame-src` 和
     *    `app.security.devCsp.frame-src` 已放宽为 `http: https:`，允许内嵌任意
     *    http(s) 来源 —— 这正是「不重新编译也能换地址」的代价：地图来源不再受
     *    白名单限制，被内嵌的页面可以来自任何 http(s) 站点。`self`、`asset:`、
     *    `ipc:` 和原有的具名来源都保持原样，`script-src` 也未额外放宽。
     *    ⚠️ tauri.conf.json 是严格 JSON，写不了注释，所以说明记在这里。
     */
    mapUrl: 'http://k2-17.xyeidc.cn:20125/',

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
})

export type ServerConfigShape = typeof ServerConfig
