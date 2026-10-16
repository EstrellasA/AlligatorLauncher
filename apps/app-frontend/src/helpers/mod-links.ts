import { defineMessages, type ContentItem } from '@modrinth/ui'

/**
 * Labels for the two lookup buttons on a mod row. Both name the mod, because
 * the visible content of each button is only an icon.
 */
export const modLinkMessages = defineMessages({
    projectPage: {
        id: 'app.mods.link.project',
        defaultMessage: 'Open the project page for {name}',
    },
    mcmod: {
        id: 'app.mods.link.mcmod',
        defaultMessage: 'Search {name} on the MC Mod wiki',
    },
})

/**
 * Only the fields the lookups need, so a file read straight from disk (which
 * has no project metadata at all) can use the same helpers.
 */
export type ModLinkSource = Pick<ContentItem, 'file_name'> &
    Partial<Pick<ContentItem, 'project' | 'display_url' | 'origin_provider' | 'provider_refs'>>

/** Trailing version and loader tokens: `-1.21.1`, `+mc1.21.1`, `-fabric`. */
const MOD_FILE_NOISE = /(?:[-_+. ](?:v?\d[\w.+-]*|mc[\d.]*|fabric|forge|neoforge|quilt))+$/i

/**
 * The name to look a mod up by: the matched project title when there is one,
 * otherwise the file name with the version/loader noise stripped.
 */
export function modDisplayName(item: ModLinkSource): string {
    const title = item.project?.title?.trim()
    if (title) return title

    const stem = (item.file_name ?? '')
        .replace(/\.disabled$/i, '')
        .replace(/\.[a-z0-9]+$/i, '')
    const stripped = stem.replace(MOD_FILE_NOISE, '').replace(/[-_]+/g, ' ').trim()
    return stripped || stem || item.file_name || ''
}

/**
 * `displayURL` comes out of the jar's own metadata, so it can be a bare host, a
 * template placeholder or empty. Only an absolute http(s) URL is usable.
 */
function normalizeDeclaredUrl(value: string | null | undefined): string | null {
    const trimmed = value?.trim()
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null
    return trimmed
}

function curseForgeSlug(item: ModLinkSource): string | null {
    const slug = item.project?.slug?.trim()
    return slug ? slug : null
}

/**
 * Where the mod is published, in order of trust:
 *
 * 1. the homepage the mod declares in its own jar metadata (`displayURL`);
 * 2. the Modrinth or CurseForge page of the project the launcher matched it to;
 * 3. a Modrinth search for its display name.
 *
 * Returns `null` only when even a search would be meaningless.
 */
export function modProjectUrl(item: ModLinkSource): string | null {
    const declared = normalizeDeclaredUrl(item.display_url)
    if (declared) return declared

    const provider = item.origin_provider ?? item.provider_refs?.[0]?.provider ?? null
    const projectId = item.project?.id ?? ''
    const isLocalProject = !projectId || projectId.startsWith('local:')

    if (provider === 'modrinth' && !isLocalProject) {
        return `https://modrinth.com/mod/${item.project?.slug ?? projectId}`
    }
    if (provider === 'curseforge') {
        const slug = curseForgeSlug(item)
        if (slug && !slug.startsWith('local:')) {
            return `https://www.curseforge.com/minecraft/mc-mods/${slug}`
        }
    }

    const name = modDisplayName(item)
    return name ? `https://modrinth.com/mods?q=${encodeURIComponent(name)}` : null
}

/**
 * mcmod.cn has no public API and a hand-kept mod → page table would rot with
 * every pack update, so the wiki button is deliberately a search. `www.mcmod.cn/s`
 * redirects here, and the search host is the stable entry point.
 */
export function modMcmodUrl(item: ModLinkSource): string | null {
    const name = modDisplayName(item).trim()
    if (!name) return null
    return `https://search.mcmod.cn/s?key=${encodeURIComponent(name)}`
}
