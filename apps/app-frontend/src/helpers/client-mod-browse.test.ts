import assert from 'node:assert/strict'
import test from 'node:test'

import {
    BROWSE_LOCKED_PROJECT_PATH,
    CLIENT_MOD_TARGET_PROJECT_TYPE,
    CLIENT_SIDE_FACET,
    clientModInstallTarget,
    installedProjectKey,
    installedSnapshotItems,
    isInstalledForContentType,
    isServerBrowseVisit,
    projectsProvidedByServerPack,
    resolveBrowseProjectType,
    withClientSideFacet,
} from './client-mod-browse.ts'

function newFiltersOf(requestParams: string) {
    return new URLSearchParams(requestParams.replace(/^\?/, '')).get('new_filters')
}

test('the content browser is locked to mods', () => {
    for (const projectType of ['resourcepack', 'datapack', 'shader', 'world', 'plugin']) {
        assert.equal(resolveBrowseProjectType(projectType, {}), 'mod')
        assert.equal(isServerBrowseVisit(projectType, {}), false)
    }
    assert.equal(resolveBrowseProjectType(undefined, {}), 'mod')
    assert.equal(BROWSE_LOCKED_PROJECT_PATH, '/browse/mod')
})

test('server and multiplayer verticals keep their own project type', () => {
    // The server creation flow pushes a bare `/browse/modpack`.
    assert.equal(resolveBrowseProjectType('modpack', {}), 'modpack')
    assert.equal(resolveBrowseProjectType('server', {}), 'server')
    // Server/world markers win even for a content project type.
    assert.equal(resolveBrowseProjectType('resourcepack', { sid: 'server-id' }), 'resourcepack')
    assert.equal(resolveBrowseProjectType('world', { from: 'world-maps' }), 'world')
    assert.equal(isServerBrowseVisit('mod', { wid: 'world-id' }), true)
})

test('the client-side facet is added to the Modrinth request', () => {
    assert.equal(newFiltersOf(withClientSideFacet('?limit=20')), CLIENT_SIDE_FACET)
    assert.equal(
        newFiltersOf(
            withClientSideFacet('?limit=20&index=relevance&new_filters=project_types = `mod`'),
        ),
        '(project_types = `mod`) AND client_side IN [`required`, `optional`]',
    )
})

test('an existing OR group stays grouped when the client-side facet is appended', () => {
    assert.equal(
        newFiltersOf(
            withClientSideFacet(
                '?new_filters=project_types = `mod` AND (categories = `a` OR categories = `b`)',
            ),
        ),
        '(project_types = `mod` AND (categories = `a` OR categories = `b`)) AND client_side IN [`required`, `optional`]',
    )
})

test('the request keeps its other parameters', () => {
    const params = new URLSearchParams(
        withClientSideFacet('?limit=50&index=downloads&query=sodium').replace(/^\?/, ''),
    )
    assert.equal(params.get('limit'), '50')
    assert.equal(params.get('index'), 'downloads')
    assert.equal(params.get('query'), 'sodium')
})

test('only mod content is redirected into clientmods', () => {
    assert.equal(clientModInstallTarget('mod'), CLIENT_MOD_TARGET_PROJECT_TYPE)
    assert.equal(clientModInstallTarget('resourcepack'), undefined)
    assert.equal(clientModInstallTarget('modpack'), undefined)
    assert.equal(clientModInstallTarget(null), undefined)
    assert.equal(clientModInstallTarget(undefined), undefined)
})

test('a server-pack copy of a mod does not count as installed', () => {
    // The player may still add their own version of a mod the pack ships.
    assert.equal(isInstalledForContentType('mods/sodium.jar', 'mod'), false)
    assert.equal(isInstalledForContentType('mods/sodium.jar.disabled', 'mod'), false)
    // The reverse still holds: anything already in clientmods counts.
    assert.equal(isInstalledForContentType('clientmods/sodium.jar', 'mod'), true)
    assert.equal(isInstalledForContentType('clientmods/sodium.jar.disabled', 'mod'), true)
    // Installs of the same project replace only their own folder.
    assert.equal(isInstalledForContentType('clientmods/sodium.jar', 'resourcepack'), true)
    assert.equal(isInstalledForContentType('resourcepacks/pack.zip', 'mod'), false)
})

test('pack mods folder entries are dropped from the installed snapshot', () => {
    const items = [
        { projectType: 'mod', expectedRelativePath: 'mods/fabric-api.jar' },
        { projectType: 'mod', expectedRelativePath: 'clientmods/sodium.jar' },
        { projectType: 'datapack', expectedRelativePath: 'datapacks/pack.zip' },
    ]
    assert.deepEqual(
        installedSnapshotItems(items).map((item) => item.expectedRelativePath),
        ['clientmods/sodium.jar', 'datapacks/pack.zip'],
    )
    // A client mod recorded without the folder prefix still counts.
    assert.deepEqual(
        installedSnapshotItems([
            { projectType: 'clientmod', expectedRelativePath: 'clientmods/iris.jar' },
        ]).length,
        1,
    )
})

test('installed project keys are provider-qualified the way the backend stores them', () => {
    assert.equal(installedProjectKey('modrinth', 'AANobbMI'), 'AANobbMI')
    assert.equal(installedProjectKey('curseforge', 238222), 'curseforge:238222')
})

test('only mods the pack ships in its own folder are reported', () => {
    const installedInMods = ['pack-api', 'curseforge:238222']
    const projects = [
        // Provided by the pack, in both provider id spaces.
        { provider: 'modrinth', projectId: 'pack-api', contentType: 'mod' },
        { provider: 'curseforge', projectId: 238222, contentType: 'mod' },
        // Not provided by the pack.
        { provider: 'modrinth', projectId: 'my-sodium', contentType: 'mod' },
        // Provided by the pack but not a mod: never shadowed by `mods/`.
        { provider: 'modrinth', projectId: 'pack-api', contentType: 'resourcepack' },
        { provider: 'modrinth', projectId: 'pack-api', contentType: undefined },
    ]
    assert.deepEqual(
        projectsProvidedByServerPack(installedInMods, projects).map(
            (project) => `${project.provider}:${project.projectId}:${project.contentType}`,
        ),
        ['modrinth:pack-api:mod', 'curseforge:238222:mod'],
    )
    // Nothing installed in `mods/` means nothing to warn about.
    assert.deepEqual(projectsProvidedByServerPack([], projects), [])
    // A copy in clientmods only is a genuine duplicate, not a pack clash.
    assert.deepEqual(projectsProvidedByServerPack(['pack-api'], []), [])
})
