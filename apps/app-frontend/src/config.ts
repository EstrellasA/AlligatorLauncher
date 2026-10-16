const trimTrailingSlash = (url: string) => url.replace(/\/$/, '')

export const AlligatorZoneConfig = Object.freeze({
    productName: 'ALLIGATORZONE',
    shortProductName: 'ALLIGATORZONE',

    // 这是个人小群自用，没有官网、没有公开支持渠道、没有赞助。
    // 留空即可 —— 错误弹窗会跳过空链接。
    //
    // ⚠️ sourceOfferUrl 仍然要填：ALLIGATORZONE 桌面端是 GPL-3.0-only，
    //    分发编译好的二进制就必须让拿到它的人能拿到对应源码。
    //    GPL 不要求公开仓库，把改好的源码 zip 放到静态目录里即可。
    website: '',
    repositoryUrl: '',
    supportUrl: '',
    qqGroupNumber: '',
    qqChannelUrl: '',
    sponsorUrl: '',

    /**
     * 源码获取地址（GPL-3.0 §6 的对应源码义务）。
     * 关于页已删除，目前没有界面展示它；保留是为了给源码地址一个唯一的登记处。
     */
    sourceOfferUrl: '',

    bundleIdentifier: 'com.alligatorzone.launcher',
    deepLinkScheme: 'alligatorzone',
    userAgent: (version: string, os: string) => `alligatorzone-launcher/${version} (${os})`,
    capabilities: Object.freeze({
        publicModrinthApi: true,
        privateModrinthServices: false,
        ghsTelemetry: false,
    }),
})

const siteUrl = trimTrailingSlash(import.meta.env.MODRINTH_URL || 'https://modrinth.com')
const officialLabrinthBaseUrl = trimTrailingSlash(
    import.meta.env.MODRINTH_API_BASE_URL || 'https://api.modrinth.com',
)
type DownloadSourceMode = 'auto' | 'official_only' | 'mirror_preferred' | 'official_preferred'

// The Modrinth API always uses the official source; Modrinth download mirror
// routing is handled by the Rust download layer.
export function setModrinthSourceMode(_sourceMode: DownloadSourceMode) {}

export function setModrinthMirrorEnabled(_enabled: boolean) {}

export function getOfficialLabrinthBaseUrl() {
    return officialLabrinthBaseUrl
}

export function getLabrinthBaseUrl() {
    return officialLabrinthBaseUrl
}

export const config = {
    siteUrl,
    labrinthBaseUrl: getLabrinthBaseUrl,
}
