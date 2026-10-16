import type { AutomodpackCandidate, AutomodpackChangelog } from '@/helpers/automodpack-payload'
import type { AutomodpackChangelogView } from '@/helpers/automodpack-payload'
import { resolveAutomodpackView } from '@/helpers/automodpack-payload'
import { get_automodpack_changelog, list } from '@/helpers/instance'
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

/**
 * The history of the first candidate instance that has one.
 *
 * The instance id comes back with the history because the page must resolve the
 * journal's mod paths against that same instance.
 *
 * When no instance has a history, the most specific reason among the candidates
 * comes back, so the page can distinguish "AutoModpack has never run here" from
 * "the selected pack's mirror is gone". A backend that cannot be reached at all
 * reports `unreachable`. This never throws, so the page cannot crash on it.
 *
 * The fold itself lives in `resolveAutomodpackView`, which is pure and unit
 * tested; this function only gathers the candidates.
 */
export async function loadAutomodpackChangelog(): Promise<AutomodpackChangelogView> {
    let instances: GameInstance[]
    let homeInstanceId: string | null | undefined

    try {
        const [listed, settings] = await Promise.all([list(), getSettings()])
        instances = listed
        homeInstanceId = settings.minimal_home_instance_id
    } catch {
        return resolveAutomodpackView([], 'unreachable')
    }

    const candidates: AutomodpackCandidate[] = []
    for (const instance of orderChangelogInstances(instances, homeInstanceId)) {
        let changelog: AutomodpackChangelog | null = null
        try {
            changelog = await get_automodpack_changelog(instance.id)
        } catch {
            // One unreadable instance must not hide another instance's history.
        }
        candidates.push({ instanceId: instance.id, changelog })
    }

    return resolveAutomodpackView(candidates)
}
