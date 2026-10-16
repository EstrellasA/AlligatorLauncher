import type ContentInstallPreviewModal from '@/components/ui/ContentInstallPreviewModal.vue'
import { projectsProvidedByServerPack, SERVER_PACK_PROJECT_TYPE } from '@/helpers/client-mod-browse'
import { get_installed_project_ids } from '@/helpers/instance'

/** One project an install is about to put into the instance. */
export interface PackDuplicateCandidate {
    provider: string
    projectId: string | number
    contentType?: string | null
}

/**
 * Confirms an install of content the **server pack already provides** in its own
 * `mods/` folder, before anything is downloaded.
 *
 * AlligatorZone Core loads the pack's copy and shadows the player's, so
 * installing over it is a legitimate, deliberate act — that is exactly why the
 * content browser offers it — but it must not happen by accident. The pack copy
 * is read from the folder-scoped installed-project list, which means a project
 * that only exists in `clientmods/` (a genuine duplicate, already surfaced as an
 * installed/disabled state) and any non-mod content never trigger this.
 *
 * One prompt covers the whole batch: `candidates` is everything the caller is
 * about to install, and the prompt reports how many of them collide rather than
 * firing once per project.
 *
 * Resolves `true` when the install may proceed. When the answer cannot be
 * obtained at all (the lookup fails, or the modal is not mounted yet) it also
 * resolves `true`: the pre-existing behaviour is to install, and a safety prompt
 * must not be able to break every install in the app.
 */
export async function confirmServerPackDuplicates(
    modal: InstanceType<typeof ContentInstallPreviewModal> | null,
    instanceId: string,
    candidates: readonly PackDuplicateCandidate[],
): Promise<boolean> {
    const mods = candidates.filter((candidate) => candidate.contentType === 'mod')
    if (mods.length === 0) return true

    const installedInMods = await get_installed_project_ids(instanceId, [
        SERVER_PACK_PROJECT_TYPE,
    ]).catch(() => null)
    if (!installedInMods) return true

    const duplicates = projectsProvidedByServerPack(installedInMods, mods)
    if (duplicates.length === 0) return true
    if (!modal) return true

    return await modal.showPackDuplicates({ count: duplicates.length })
}
