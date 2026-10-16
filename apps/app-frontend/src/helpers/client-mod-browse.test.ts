import assert from 'node:assert/strict'
import test from 'node:test'

import {
    BROWSE_LOCKED_PROJECT_PATH,
    CLIENT_MOD_SAFE_ENVIRONMENT,
    CLIENT_MOD_SAFE_FACET,
    CLIENT_MOD_TARGET_PROJECT_TYPE,
    clientModInstallBlockReason,
    clientModInstallTarget,
    installedProjectKey,
    installedSnapshotItems,
    isClientModSafeEnvironment,
    isClientModSafeSides,
    isInstalledForContentType,
    isLockedClientModBrowseVisit,
    isServerBrowseVisit,
    projectsProvidedByServerPack,
    resolveBrowseProjectType,
    withClientModSafeFacet,
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

test('the lock constrains both sides, not just the client', () => {
    // The facet must not be reducible to a client-side test: a mod the server
    // requires passes `client_side IN [required, optional]` and would break the
    // game once it lands in `clientmods/`.
    assert.match(CLIENT_MOD_SAFE_FACET, /server_side = `unsupported`/)
    assert.match(CLIENT_MOD_SAFE_FACET, /client_side = `required`/)
    assert.doesNotMatch(CLIENT_MOD_SAFE_FACET, /optional/)
})

test('the safety facet is added to the Modrinth request', () => {
    assert.equal(newFiltersOf(withClientModSafeFacet('?limit=20')), CLIENT_MOD_SAFE_FACET)
    assert.equal(
        newFiltersOf(
            withClientModSafeFacet('?limit=20&index=relevance&new_filters=project_types = `mod`'),
        ),
        '(project_types = `mod`) AND ' + CLIENT_MOD_SAFE_FACET,
    )
})

test('an existing OR group stays grouped when the safety facet is appended', () => {
    assert.equal(
        newFiltersOf(
            withClientModSafeFacet(
                '?new_filters=project_types = `mod` AND (categories = `a` OR categories = `b`)',
            ),
        ),
        '(project_types = `mod` AND (categories = `a` OR categories = `b`)) AND ' +
            CLIENT_MOD_SAFE_FACET,
    )
})

test('the request keeps its other parameters', () => {
    const params = new URLSearchParams(
        withClientModSafeFacet('?limit=50&index=downloads&query=sodium').replace(/^\?/, ''),
    )
    assert.equal(params.get('limit'), '50')
    assert.equal(params.get('index'), 'downloads')
    assert.equal(params.get('query'), 'sodium')
})

test('server-required mods are not safe to install client-only', () => {
    // Create: blocks and machines the server has to have.
    assert.equal(isClientModSafeSides({ client_side: 'required', server_side: 'required' }), false)
    // `optional` is supported on a server, so it is not the guaranteed-safe case.
    assert.equal(isClientModSafeSides({ client_side: 'required', server_side: 'optional' }), false)
    // Sodium / Iris / Mod Menu.
    assert.equal(
        isClientModSafeSides({ client_side: 'required', server_side: 'unsupported' }),
        true,
    )
    // A client side that is only `optional` is not something to install either.
    assert.equal(
        isClientModSafeSides({ client_side: 'optional', server_side: 'unsupported' }),
        false,
    )
    // Missing or unknown metadata is not proof of safety.
    assert.equal(isClientModSafeSides({}), false)
    assert.equal(isClientModSafeSides({ client_side: 'required' }), false)
    assert.equal(
        isClientModSafeSides({ client_side: 'unknown', server_side: 'unsupported' }),
        false,
    )
    // The list shape the search index returns.
    assert.equal(
        isClientModSafeSides({ client_side: ['required'], server_side: ['unsupported'] }),
        true,
    )
})

test('the v3 environment fallback only accepts a plain client_only', () => {
    assert.equal(CLIENT_MOD_SAFE_ENVIRONMENT, 'client_only')
    assert.equal(isClientModSafeEnvironment(['client_only']), true)
    assert.equal(isClientModSafeEnvironment('client_only'), true)
    // The values the old client-usable set wrongly accepted.
    assert.equal(isClientModSafeEnvironment(['client_and_server']), false)
    assert.equal(isClientModSafeEnvironment(['client_only_server_optional']), false)
    assert.equal(isClientModSafeEnvironment(['client_or_server']), false)
    assert.equal(isClientModSafeEnvironment(['client_or_server_prefers_both']), false)
    // Measured: 14 of 15 `singleplayer_only` mods report server_side = required.
    assert.equal(isClientModSafeEnvironment(['singleplayer_only']), false)
    // Extra values make the project unverifiable, so it stays out.
    assert.equal(isClientModSafeEnvironment(['client_only', 'unknown']), false)
    assert.equal(isClientModSafeEnvironment(['client_only', 'client_and_server']), false)
    assert.equal(isClientModSafeEnvironment([]), false)
    assert.equal(isClientModSafeEnvironment(undefined), false)
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

test('only the locked client-mod list counts as the locked Browse', () => {
    assert.equal(isLockedClientModBrowseVisit('/browse/mod'), true)
    assert.equal(isLockedClientModBrowseVisit('/browse/mod?i=instance-id'), true)
    // Favorites is a Browse tab too, but it is not the filtered list.
    assert.equal(isLockedClientModBrowseVisit('/browse/favorites?i=instance-id'), false)
    assert.equal(isLockedClientModBrowseVisit('/browse/resourcepack'), false)
    assert.equal(isLockedClientModBrowseVisit('/project/create'), false)
    assert.equal(isLockedClientModBrowseVisit(undefined), false)
    assert.equal(isLockedClientModBrowseVisit(null), false)
    assert.equal(isLockedClientModBrowseVisit(['/browse/mod']), false)
})

test('a server-required mod exposes no install button on a project page', () => {
    // Create, Terralith: the server has to run them.
    assert.equal(
        clientModInstallBlockReason({
            contentType: 'mod',
            fromLockedBrowse: false,
            sides: { client_side: 'required', server_side: 'required' },
        }),
        'server-required',
    )
    // Opened as a deep link or from Favorites, `optional` is still unproven.
    assert.equal(
        clientModInstallBlockReason({
            contentType: 'mod',
            fromLockedBrowse: false,
            sides: { client_side: 'required', server_side: 'optional' },
        }),
        'unverified',
    )
    assert.equal(
        clientModInstallBlockReason({
            contentType: 'mod',
            fromLockedBrowse: false,
            sides: { client_side: 'unknown', server_side: 'unknown' },
        }),
        'unverified',
    )
    // A source that publishes nothing (CurseForge, MCArchive, Planet Minecraft).
    assert.equal(
        clientModInstallBlockReason({
            contentType: 'mod',
            fromLockedBrowse: false,
            sides: null,
        }),
        'unverified',
    )
    assert.equal(
        clientModInstallBlockReason({ contentType: 'mod', fromLockedBrowse: false }),
        'unverified',
    )
})

test('the gate never blocks a client-safe mod, non-mods, the locked list or the server', () => {
    const safeSides = { client_side: 'required', server_side: 'unsupported' }
    // Sodium, Iris, Mod Menu: installable from anywhere.
    assert.equal(
        clientModInstallBlockReason({
            contentType: 'mod',
            fromLockedBrowse: false,
            sides: safeSides,
        }),
        null,
    )
    // Resource packs, shaders, data packs and modpacks have their own folders.
    for (const contentType of ['resourcepack', 'shader', 'datapack', 'modpack']) {
        assert.equal(
            clientModInstallBlockReason({
                contentType,
                fromLockedBrowse: false,
                sides: { client_side: 'required', server_side: 'required' },
            }),
            null,
        )
    }
    // Inside the locked Browse the list is already filtered, so even a source
    // with no side data keeps the install button the player just asked for.
    assert.equal(
        clientModInstallBlockReason({
            contentType: 'mod',
            fromLockedBrowse: true,
            sides: { client_side: 'required', server_side: 'required' },
        }),
        null,
    )
    assert.equal(
        clientModInstallBlockReason({
            contentType: 'mod',
            fromLockedBrowse: true,
            sides: null,
        }),
        null,
    )
    // The server vertical installs server-side on purpose.
    assert.equal(
        clientModInstallBlockReason({
            contentType: 'mod',
            fromLockedBrowse: false,
            serverVertical: true,
            sides: { client_side: 'required', server_side: 'required' },
        }),
        null,
    )
})
