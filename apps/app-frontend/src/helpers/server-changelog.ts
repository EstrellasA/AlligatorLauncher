import {
    get_automodpack_changelog,
    type AutomodpackChangelog,
    list,
} from '@/helpers/instance'
import { isServerLinkedInstance } from '@/helpers/first-run-bootstrap'
import { get as getSettings } from '@/helpers/settings'
import type { GameInstance } from '@/helpers/types'

/**
 * Which instance supplies the update-notes page.
 *
 * `/changelog` is a global route while AutoModpack's history is per instance,
 * so the instance is resolved the same way the sidebar web map resolves its
 * address (`helpers/server-web-map.ts`): the instance linked to this server
 * first, then the player's home instance.
 *
 * The difference is that "has no history" is a normal answer here rather than a
 * configuration a player set, so the first candidate that actually has a
 * journal wins. That keeps the nav entry useful on a machine where the linked
 * instance has never synced but another profile has.
 */

/** Ordered candidates: server-linked, then home, then everything else. */
export function orderChangelogInstances(
    instances: readonly GameInstance[],
    homeInstanceId: string | null | undefined,
): GameInstance[] {
    return [
        ...instances.filter(isServerLinkedInstance),
        ...instances.filter(
            (instance) => instance.id === homeInstanceId && !isServerLinkedInstance(instance),
        ),
        ...instances.filter(
            (instance) => instance.id !== homeInstanceId && !isServerLinkedInstance(instance),
        ),
    ]
}

/** The resolved history plus the instance it belongs to. */
export interface ResolvedAutomodpackChangelog {
    instanceId: string
    changelog: AutomodpackChangelog
}

/**
 * The history of the first candidate instance that has one.
 *
 * The instance id comes back with the history because the page must resolve the
 * journal's mod paths against that same instance.
 *
 * Returns `null` when no instance can supply a history at all — including when
 * the backend cannot be reached, so the page renders its "nothing yet" state
 * instead of a failure.
 */
export async function loadAutomodpackChangelog(): Promise<ResolvedAutomodpackChangelog | null> {
    let instances: GameInstance[]
    let homeInstanceId: string | null | undefined

    try {
        const [listed, settings] = await Promise.all([list(), getSettings()])
        instances = listed
        homeInstanceId = settings.minimal_home_instance_id
    } catch {
        return null
    }

    for (const instance of orderChangelogInstances(instances, homeInstanceId)) {
        try {
            const changelog = await get_automodpack_changelog(instance.id)
            if (changelog.available) return { instanceId: instance.id, changelog }
        } catch {
            // One unreadable instance must not hide another instance's history.
        }
    }

    return null
}
