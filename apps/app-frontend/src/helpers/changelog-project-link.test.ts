import assert from 'node:assert/strict'
import test from 'node:test'

import type { ContentCardProject } from '@modrinth/ui'

import { resolveChangelogProjectAction } from './changelog-project-link.ts'
import type { ChangelogProjectLinkSource } from './changelog-project-link.ts'

/**
 * The update-notes page must keep a matched mod inside the launcher
 * (「这个直接在启动器里面点开」) while never pretending an unmatched one can be
 * opened there.
 *
 * These cases mirror the real payload shapes: the launcher resolves local jars
 * by sha1 against Modrinth and stores the match in its own provider-ref table,
 * so a matched row carries a genuine project id **and often no origin provider
 * at all** — which is why the decision cannot be `modProjectUrl()`'s.
 */

const INSTANCE = 'local:13043be7-d5e7-4b44-ad81-6ab3bab5c63f'

/**
 * The subset of the shared project type fixtures actually populate. `/project`
 * routes only ever read id, slug and title; the rest of `ContentCardProject`
 * belongs to the card renderer, not to this decision.
 */
type ProjectFixture = Pick<ContentCardProject, 'id' | 'title'> &
    Partial<Pick<ContentCardProject, 'slug'>>

/**
 * A row as the content API returns it.
 *
 * The project is cast because `ContentCardProject.icon_url` is non-nullable in
 * the shared type, and `icon_url` belongs to the card renderer rather than to
 * this decision — this function never reads it. The cast is confined to the
 * fixture builder; every assertion below is checked normally.
 */
function row(
    fields: Omit<Partial<ChangelogProjectLinkSource>, 'project'> & {
        file_name: string
        project?: ProjectFixture | null
    },
): ChangelogProjectLinkSource {
    return fields as ChangelogProjectLinkSource
}

test('a matched project with no origin provider still opens in-app', () => {
    // The exact shape the live content API returns for a resolved jar.
    const action = resolveChangelogProjectAction(
        row({
            project: { id: 'OypNE65K', slug: 'tacz-1.21.1', title: 'TaCZ' },
            origin_provider: null,
            provider_refs: [],
            file_name: 'tacz-neoforge-1.21.1-1.1.8-hotfix-r6.jar',
        }),
        INSTANCE,
    )

    assert.equal(action?.kind, 'in_app')
    if (action?.kind !== 'in_app') return
    assert.equal(action.projectId, 'OypNE65K')
    assert.equal(action.routeId, 'tacz-1.21.1')
    assert.equal(action.path, '/project/tacz-1.21.1')
    // The route marker that withholds the install affordance: the mod is
    // already part of this instance's content.
    assert.deepEqual(action.query, { i: INSTANCE, from: 'instance-content' })
})

test('a declared homepage does not win over a matched project', () => {
    // AppleSkin declares a GitHub homepage, but it is matched to EsAfCjCV.
    const action = resolveChangelogProjectAction(
        row({
            project: { id: 'EsAfCjCV', slug: 'appleskin', title: 'AppleSkin' },
            display_url: 'https://github.com/squeek502/AppleSkin',
            file_name: 'appleskin-neoforge-mc1.21-3.0.9.jar',
        }),
        INSTANCE,
    )

    assert.equal(action?.kind, 'in_app')
    if (action?.kind !== 'in_app') return
    assert.equal(action.projectId, 'EsAfCjCV')
    assert.equal(action.path, '/project/appleskin')
})

test('a project without a slug routes by its id', () => {
    const action = resolveChangelogProjectAction(
        row({
            project: { id: 'abcd1234', title: 'No Slug' },
            file_name: 'no-slug.jar',
        }),
        INSTANCE,
    )

    assert.equal(action?.kind, 'in_app')
    if (action?.kind !== 'in_app') return
    assert.equal(action.routeId, 'abcd1234')
    assert.equal(action.path, '/project/abcd1234')
})

test('a synthetic local project falls back to an external link', () => {
    // `local:<mod_id>` and `local:file:<hash>` name no project that exists, so
    // routing them in-app would land on a project page that cannot resolve.
    for (const id of ['local:appleskin', 'local:file:deadbeef', 'local:']) {
        const action = resolveChangelogProjectAction(
            row({
                project: { id, slug: 'appleskin', title: 'AppleSkin' },
                display_url: 'https://github.com/squeek502/AppleSkin',
                file_name: 'appleskin-neoforge-3.0.9.jar',
            }),
            INSTANCE,
        )

        assert.equal(action?.kind, 'external', `${id} must not route in-app`)
        if (action?.kind !== 'external') continue
        assert.equal(action.url, 'https://github.com/squeek502/AppleSkin')
        assert.equal(action.declared, true)
    }
})

test('a local project with no homepage falls back to the search link', () => {
    const action = resolveChangelogProjectAction(
        row({
            project: { id: 'local:aeroengineering', slug: 'aeroengineering', title: 'AeroEngine' },
            file_name: '[机械动力] AeroEngine-1.3.0.jar',
        }),
        INSTANCE,
    )

    assert.equal(action?.kind, 'external')
    if (action?.kind !== 'external') return
    assert.ok(action.url.startsWith('https://modrinth.com/mods?q='))
    assert.equal(action.declared, false)
})

test('without an instance id the route cannot be built, so it stays external', () => {
    const action = resolveChangelogProjectAction(
        row({
            project: { id: 'EsAfCjCV', slug: 'appleskin', title: 'AppleSkin' },
            file_name: 'appleskin.jar',
        }),
        null,
    )

    // Still a usable destination, just never an in-app one: the project page
    // reads the instance from the query, so a route without it would be wrong.
    assert.equal(action?.kind, 'external')
})

test('an unmatched row still gets a usable search link, not null', () => {
    // `project` is absent entirely, but a mod with a file name can always be
    // searched for — so the button stays live rather than disappearing.
    const rows: ReturnType<typeof row>[] = [
        row({ file_name: 'unknown-mod-1.0.jar' }),
        row({ project: null, file_name: 'unknown-mod-1.0.jar' }),
        row({
            project: { id: 'local:file:deadbeef', title: 'Unknown' },
            file_name: 'unknown-mod-1.0.jar',
        }),
    ]

    for (const candidate of rows) {
        const action = resolveChangelogProjectAction(candidate, INSTANCE)
        assert.equal(action?.kind, 'external', `${candidate.file_name} should search`)
        if (action?.kind !== 'external') continue
        assert.ok(action.url.startsWith('https://modrinth.com/mods?q='))
    }
})

test('only a row with no name at all resolves to null', () => {
    // Nothing to search for and no id: the caller must omit the button rather
    // than render a dead one.
    assert.equal(resolveChangelogProjectAction(row({ file_name: '' }), INSTANCE), null)
    assert.equal(
        resolveChangelogProjectAction(
            row({
                project: { id: 'local:file:x', title: '   ' },
                file_name: '',
            }),
            INSTANCE,
        ),
        null,
    )
})

test('every in-app route is a project path, never a raw URL', () => {
    const action = resolveChangelogProjectAction(
        row({
            project: { id: 'abc', slug: 'my-mod', title: 'My Mod' },
            display_url: 'https://example.com',
            file_name: 'my-mod.jar',
        }),
        INSTANCE,
    )

    assert.equal(action?.kind, 'in_app')
    if (action?.kind !== 'in_app') return
    assert.ok(action.path.startsWith('/project/'))
    assert.ok(!action.path.startsWith('http'))
})
