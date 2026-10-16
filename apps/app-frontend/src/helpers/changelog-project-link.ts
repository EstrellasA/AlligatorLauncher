// Relative and extension-qualified, not `@/`: this module is unit tested under
// plain `node --test`, which resolves neither path aliases nor extensionless
// specifiers. Keep it that way so the link decision stays testable.
import {
    modProjectUrl,
    modrinthProjectIdForNavigation,
    modrinthProjectSlug,
    type ModLinkSource,
} from './mod-links.ts'

/**
 * Where a mod entry on the update-notes page goes when the player clicks it.
 *
 * Two destinations, never a third:
 *
 * - `in_app` — the launcher's own project page for a project it resolved. This
 *   is the primary affordance: 「这个直接在启动器里面点开」.
 * - `external` — the mod's own site, for a row the launcher could not match to a
 *   project. The two are labelled differently so a player is never surprised by
 *   leaving the launcher.
 *
 * A row with neither is `null`, and the caller renders no button at all rather
 * than a dead one.
 */
export type ChangelogProjectAction =
    | {
          kind: 'in_app'
          /** Modrinth project id the launcher resolved; a real id, never `local:`. */
          projectId: string
          /** Slug when the project has one, else the id — what the route carries. */
          routeId: string
          /** `/project/<slug-or-id>` with the instance-content route marker. */
          path: string
          query: { i: string; from: 'instance-content' }
      }
    | {
          kind: 'external'
          /** Absolute http(s) URL. */
          url: string
          /** True when the mod declares this homepage itself (`displayURL`). */
          declared: boolean
      }

/**
 * Only the fields a link decision reads — the same source the mod list's own
 * lookups take, so a `ContentItem` from the content API is accepted as-is.
 */
export type ChangelogProjectLinkSource = ModLinkSource

/**
 * The primary destination for one changelog mod entry.
 *
 * `instanceId` is required for the in-app route: the project page reads
 * `?i=<instance>&from=instance-content` to know the mod is already part of an
 * instance's content. That marker is what withholds the install affordance —
 * without it the page would offer to install a second copy of a mod the pack
 * already owns, which is exactly the duplicate the mods list prevents.
 *
 * Returns `null` only when there is genuinely nowhere to go, so the caller can
 * omit the button instead of rendering a disabled one.
 */
export function resolveChangelogProjectAction(
    item: ChangelogProjectLinkSource,
    instanceId: string | null,
): ChangelogProjectAction | null {
    const projectId = modrinthProjectIdForNavigation(item)
    if (projectId && instanceId) {
        // The instance content list routes by slug when it has one, so a known
        // project keeps one canonical URL either way.
        const routeId = modrinthProjectSlug(item) ?? projectId
        return {
            kind: 'in_app',
            projectId,
            routeId,
            path: `/project/${routeId}`,
            query: { i: instanceId, from: 'instance-content' },
        }
    }

    const url = modProjectUrl(item)
    if (!url) return null
    return {
        kind: 'external',
        url,
        // A jar-declared homepage is the author's own site; the alternative is
        // the search fallback, which is worth naming differently in a tooltip.
        declared: Boolean(item.display_url?.trim()),
    }
}
