import assert from 'node:assert/strict'
import test from 'node:test'

import {
    AUTOMODPACK_WIRE_SHAPE,
    emptyAutomodpackChangelog,
    isAutomodpackChangelog,
    isSilentGeneration,
    renderableGenerations,
    resolveAutomodpackView,
    type AutomodpackChangelog,
    type AutomodpackGeneration,
} from './automodpack-payload.ts'

/**
 * A generation as the reader emits one. Defaults describe a published
 * generation that changed something, which is the case the page must keep.
 */
function generation(fields: Partial<AutomodpackGeneration> = {}): AutomodpackGeneration {
    return {
        seq: 1,
        createdAt: '2026-10-01T07:58:53.977887468Z',
        notes: '',
        contentToken: 'a'.repeat(40),
        changedFiles: 1,
        modPaths: ['mods/A.jar'],
        changes: [],
        directories: [],
        ...fields,
    }
}

/**
 * The update-notes page crashed on this payload:
 *
 *     Cannot read properties of undefined (reading 'length')
 *
 * The Rust command serialises camelCase while the page read snake_case, so
 * `generation.modPaths` arrived as `undefined` and `.length` threw. These tests
 * pin the two things that let it through: a payload that is not the promised
 * shape, and the key spellings themselves.
 */

test('a payload whose keys drifted to snake_case is still only shape-checked', () => {
    // Exactly the drift that shipped: the command answered, but with keys the
    // page did not read. The guard checks the envelope, not every field, so this
    // is accepted — the protection against *that* is `AUTOMODPACK_WIRE_SHAPE`
    // below plus the read sites defaulting their arrays.
    const snakeCasePayload = {
        available: true,
        modpack_id: 'bm859uj',
        unavailable_reason: undefined,
        generations: [
            {
                seq: 1,
                created_at: '2026-10-01T07:58:53.977887468Z',
                notes: '',
                content_token: 'a'.repeat(40),
                changed_files: 2,
                mod_paths: ['mods/A.jar'],
                changes: [],
                directories: [],
            },
        ],
        skipped_lines: 0,
    }

    assert.equal(isAutomodpackChangelog(snakeCasePayload), true)

    // What the page would have done with it before the fix.
    const generation = snakeCasePayload.generations[0] as { modPaths?: string[] }
    assert.equal(generation.modPaths, undefined)
    assert.equal((generation.modPaths ?? []).length, 0)
})

test('a payload without generations is rejected', () => {
    assert.equal(isAutomodpackChangelog(undefined), false)
    assert.equal(isAutomodpackChangelog(null), false)
    assert.equal(isAutomodpackChangelog('nope'), false)
    assert.equal(isAutomodpackChangelog({}), false)
    assert.equal(isAutomodpackChangelog({ available: true }), false)
    assert.equal(isAutomodpackChangelog({ generations: [] }), false)
})

test('the promised payload shape is accepted, empty history included', () => {
    assert.equal(isAutomodpackChangelog({ available: false, generations: [], skippedLines: 0 }), true)
    assert.equal(
        isAutomodpackChangelog({
            available: true,
            modpackId: 'bm859uj',
            generations: [],
            skippedLines: 0,
        }),
        true,
    )
})

/**
 * The wire shape is pinned by `AUTOMODPACK_WIRE_SHAPE`, which is itself checked
 * against the interfaces by `satisfies`. This test states the spellings a reader
 * of the payload relies on, so a rename has to be a deliberate edit here too.
 */
test('the wire shape is camelCase, never snake_case', () => {
    const allFields = [
        ...AUTOMODPACK_WIRE_SHAPE.changelog,
        ...AUTOMODPACK_WIRE_SHAPE.generation,
        ...AUTOMODPACK_WIRE_SHAPE.change,
        ...AUTOMODPACK_WIRE_SHAPE.directoryGroup,
    ]

    for (const field of allFields) {
        assert.ok(
            !field.includes('_'),
            `${field} is snake_case; the Rust structs serialise camelCase`,
        )
    }

    // The exact fields the crash involved, and the ones that silently fell
    // through to the wrong state.
    assert.ok(AUTOMODPACK_WIRE_SHAPE.generation.includes('modPaths'))
    assert.ok(AUTOMODPACK_WIRE_SHAPE.generation.includes('createdAt'))
    assert.ok(AUTOMODPACK_WIRE_SHAPE.generation.includes('restoreOf'))
    assert.ok(AUTOMODPACK_WIRE_SHAPE.changelog.includes('skippedLines'))
    assert.ok(AUTOMODPACK_WIRE_SHAPE.changelog.includes('unavailableReason'))
    assert.ok(AUTOMODPACK_WIRE_SHAPE.changelog.includes('modpackId'))
    assert.ok(AUTOMODPACK_WIRE_SHAPE.directoryGroup.includes('samplePaths'))
    assert.ok(AUTOMODPACK_WIRE_SHAPE.directoryGroup.includes('samplesTruncated'))
    assert.ok(AUTOMODPACK_WIRE_SHAPE.change.includes('fromSha1'))
    assert.ok(AUTOMODPACK_WIRE_SHAPE.change.includes('fromSize'))
})

/**
 * What the page does with a payload it cannot trust: it must reach the empty
 * state. `generations` is read as a possibly-absent array, which is what turns
 * an unexpected payload into an empty page rather than a thrown error.
 */
test('an untrusted payload still yields an iterable generations list', () => {
    const fromGarbage = (payload: unknown): AutomodpackChangelog =>
        isAutomodpackChangelog(payload) ? payload : emptyAutomodpackChangelog()

    for (const payload of [undefined, null, 42, 'x', {}, { available: true }]) {
        const changelog = fromGarbage(payload)
        assert.equal(changelog.generations.length, 0)
        assert.equal(changelog.available, false)
    }

    // A rejected payload names an ordinary state rather than an error, so the
    // page shows its "nothing published here yet" copy instead of failing.
    assert.equal(emptyAutomodpackChangelog().unavailableReason, 'not_installed')

    // And a generation whose optional arrays are absent must not break a read
    // that was written to tolerate it.
    const partial = { available: true, generations: [{ seq: 1 }], skippedLines: 0 }
    const generation = partial.generations[0] as { modPaths?: string[]; changes?: unknown[] }
    assert.equal((generation.modPaths ?? []).length, 0)
    assert.equal((generation.changes ?? []).length, 0)
})

/**
 * The page's whole state decision. This is the path that must reach the empty
 * state instead of throwing when the payload is not what was promised.
 */
test('a healthy first candidate wins', () => {
    const view = resolveAutomodpackView([
        { instanceId: 'linked', changelog: { available: false, generations: [], skippedLines: 0 } },
        {
            instanceId: 'home',
            changelog: {
                available: true,
                generations: [generation({ seq: 3, changedFiles: 2 })],
                skippedLines: 2,
            },
        },
    ])

    assert.equal(view.available, true)
    assert.equal(view.instanceId, 'home')
    assert.equal(view.generations.length, 1)
    assert.equal(view.skippedLines, 2)
    assert.equal(view.silentGenerations, 0)
})

/** The crash path: a rejected or malformed payload must not produce a throw. */
test('rejected and malformed answers fall through to the empty state', () => {
    const view = resolveAutomodpackView([
        { instanceId: 'a', changelog: null },
        { instanceId: 'b', changelog: { available: true } as AutomodpackChangelog },
        { instanceId: 'c', changelog: { available: 'yes', generations: [] } as never },
    ])

    assert.equal(view.available, false)
    assert.equal(view.generations.length, 0)
    assert.equal(view.skippedLines, 0)
    assert.equal(view.reason, 'not_installed')
})

test('the most specific unavailable reason is kept', () => {
    const view = resolveAutomodpackView([
        { instanceId: 'a', changelog: { available: false, generations: [], skippedLines: 0 } },
        {
            instanceId: 'b',
            changelog: {
                available: false,
                unavailableReason: 'history_missing',
                generations: [],
                skippedLines: 0,
            },
        },
        {
            instanceId: 'c',
            changelog: {
                available: false,
                unavailableReason: 'no_selected_pack',
                generations: [],
                skippedLines: 0,
            },
        },
    ])

    // The first reason that was actually reported wins; a later candidate's
    // generic answer does not overwrite it.
    assert.equal(view.reason, 'history_missing')
    assert.equal(view.available, false)
})

test('no candidates at all still yields a renderable state', () => {
    for (const view of [
        resolveAutomodpackView([]),
        resolveAutomodpackView([], 'unreachable'),
        resolveAutomodpackView([{ instanceId: 'a', changelog: null }], 'unreachable'),
    ]) {
        assert.equal(view.generations.length, 0)
        assert.equal(view.skippedLines, 0)
        assert.equal(view.silentGenerations, 0)
    }
    assert.equal(resolveAutomodpackView([], 'unreachable').reason, 'unreachable')
})

/**
 * Policy-only republishes: `contentToken` unmoved, `changes` empty. The real
 * pack has two of them, and rendering each produced a large card reading "no
 * files changed" over "no patch notes were published" — the noise the user
 * objected to with 「这两个啥都没有为什么要显示」.
 */
test('a generation with no changes and no notes is silent', () => {
    assert.equal(isSilentGeneration(generation({ changedFiles: 0, changes: [], notes: '' })), true)
    assert.equal(
        isSilentGeneration(generation({ changedFiles: 0, changes: [], notes: '   \n ' })),
        true,
    )
})

test('a silent republish the operator annotated is NOT hidden', () => {
    // The requirement: only hide a generation when *both* are empty. Notes are
    // the whole reason this generation exists.
    assert.equal(
        isSilentGeneration(generation({ changedFiles: 0, changes: [], notes: 'Rules only.' })),
        false,
    )
})

test('a generation with changes but no notes is NOT hidden', () => {
    assert.equal(
        isSilentGeneration(generation({ changedFiles: 3, changes: [], notes: '' })),
        false,
    )
})

test('only the silent generations are dropped from the list', () => {
    const kept = generation({ seq: 1, changedFiles: 1108 })
    const silent = generation({ seq: 2, changedFiles: 0, changes: [], notes: '' })
    const silentWithNotes = generation({ seq: 3, changedFiles: 0, changes: [], notes: 'Rollback.' })

    const renderable = renderableGenerations([kept, silent, silentWithNotes])
    assert.deepEqual(
        renderable.map((entry) => entry.seq),
        [1, 3],
    )
})

test('the view drops silent generations but counts them', () => {
    const view = resolveAutomodpackView([
        {
            instanceId: 'home',
            changelog: {
                available: true,
                skippedLines: 0,
                generations: [
                    generation({ seq: 3, changedFiles: 0, changes: [], notes: '' }),
                    generation({ seq: 2, changedFiles: 0, changes: [], notes: '' }),
                    generation({ seq: 1, changedFiles: 1108 }),
                ],
            },
        },
    ])

    assert.equal(view.available, true)
    assert.deepEqual(
        view.generations.map((entry) => entry.seq),
        [1],
    )
    // Counted, not swallowed: the page says how many were hidden.
    assert.equal(view.silentGenerations, 2)
})

test('a history of only silent republishes renders the empty state, not a blank page', () => {
    const view = resolveAutomodpackView([
        {
            instanceId: 'home',
            changelog: {
                available: true,
                skippedLines: 0,
                generations: [
                    generation({ seq: 2, changedFiles: 0, changes: [], notes: '' }),
                    generation({ seq: 1, changedFiles: 0, changes: [], notes: '' }),
                ],
            },
        },
    ])

    // No cards to draw, and the page's `generations.length === 0` branch is
    // reachable — with `silentGenerations > 0` it says the history exists but
    // carries nothing, rather than claiming nothing was ever published.
    assert.equal(view.generations.length, 0)
    assert.equal(view.silentGenerations, 2)
    assert.equal(view.available, true)
})
