import assert from 'node:assert/strict'
import test from 'node:test'

import {
    AUTOMODPACK_WIRE_SHAPE,
    emptyAutomodpackChangelog,
    isAutomodpackChangelog,
    resolveAutomodpackView,
    type AutomodpackChangelog,
} from './automodpack-payload.ts'

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
                generations: [{ seq: 3 }] as never,
                skippedLines: 2,
            },
        },
    ])

    assert.equal(view.available, true)
    assert.equal(view.instanceId, 'home')
    assert.equal(view.generations.length, 1)
    assert.equal(view.skippedLines, 2)
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
    }
    assert.equal(resolveAutomodpackView([], 'unreachable').reason, 'unreachable')
})
