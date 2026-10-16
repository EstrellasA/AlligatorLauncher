export interface BrowseProjectTabLabels {
    modpacks: string
    mods: string
    resourcepacks: string
    datapacks: string
    maps: string
    shaders: string
    servers: string
    favorites: string
}

export interface BrowseProjectTab {
    label: string
    href: string
    shown?: boolean
    onboardingId?: string
}

export interface BrowseProjectTabOptions {
    modpacks?: boolean
    mods?: boolean
    datapacks?: boolean
    servers?: boolean
    favorites?: boolean
    /**
     * The launcher's content browser only offers client-side mods. When set,
     * only the `Mods` tab (and Favorites, which is not a project type) is
     * produced, so no other project type is reachable from Browse.
     */
    modsOnly?: boolean
}

export interface BrowseProjectTabVisibilityInput {
    instance?: {
        game_version?: string
        loader?: string
    } | null
    hasInstanceContext?: boolean
    isServerInstance?: boolean
}

export function supportsDataPacks(gameVersion: string | undefined): boolean {
    const match = gameVersion?.match(/^1\.(\d+)/)
    return match ? Number(match[1]) >= 13 : false
}

export function getBrowseProjectTabOptions({
    instance,
    hasInstanceContext = false,
    isServerInstance = false,
}: BrowseProjectTabVisibilityInput): BrowseProjectTabOptions {
    const hasInstance = !!instance
    return {
        modpacks: !hasInstanceContext,
        mods: !hasInstance || instance?.loader !== 'vanilla',
        datapacks: !hasInstance || (!isServerInstance && supportsDataPacks(instance?.game_version)),
        servers: !hasInstanceContext,
    }
}

export function createBrowseProjectTabs(
    labels: BrowseProjectTabLabels,
    suffix = '',
    options: BrowseProjectTabOptions = {},
): BrowseProjectTab[] {
    if (options.modsOnly) {
        return [
            {
                label: labels.mods,
                href: `/browse/mod${suffix}`,
                shown: true,
            },
            {
                label: labels.favorites,
                href: `/browse/favorites${suffix}`,
                shown: options.favorites ?? true,
                onboardingId: 'browse-favorites-tab',
            },
        ]
    }

    return [
        {
            label: labels.modpacks,
            href: `/browse/modpack${suffix}`,
            shown: options.modpacks ?? true,
        },
        {
            label: labels.mods,
            href: `/browse/mod${suffix}`,
            shown: options.mods ?? true,
        },
        { label: labels.resourcepacks, href: `/browse/resourcepack${suffix}` },
        {
            label: labels.datapacks,
            href: `/browse/datapack${suffix}`,
            shown: options.datapacks ?? true,
        },
        { label: labels.maps, href: `/browse/world${suffix}` },
        { label: labels.shaders, href: `/browse/shader${suffix}` },
        {
            label: labels.servers,
            href: `/browse/server${suffix}`,
            shown: options.servers ?? true,
        },
        {
            label: labels.favorites,
            href: `/browse/favorites${suffix}`,
            shown: options.favorites ?? true,
            onboardingId: 'browse-favorites-tab',
        },
    ]
}
