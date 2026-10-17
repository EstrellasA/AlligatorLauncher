import assert from 'node:assert/strict'
import test from 'node:test'

import {
    shouldUpgradeChangelogStayOpen,
    upgradeExternalChangelogUrl,
} from './upgrade-changelog.ts'

test('external changelog links only allow HTTP protocols', () => {
    assert.equal(
        upgradeExternalChangelogUrl('https://example.com/path'),
        'https://example.com/path',
    )
    assert.equal(
        upgradeExternalChangelogUrl('https://example.com/path).'),
        'https://example.com/path',
    )
    assert.equal(upgradeExternalChangelogUrl('http://example.com/path,'), 'http://example.com/path')
    assert.equal(upgradeExternalChangelogUrl('javascript:alert(1)'), null)
})

test('changelog popover stays open while trigger or popup owns hover or focus', () => {
    const empty = {
        triggerHovered: false,
        triggerFocused: false,
        popupHovered: false,
        popupFocused: false,
    }
    assert.equal(shouldUpgradeChangelogStayOpen({ ...empty, triggerHovered: true }), true)
    assert.equal(shouldUpgradeChangelogStayOpen({ ...empty, popupHovered: true }), true)
    assert.equal(
        shouldUpgradeChangelogStayOpen({ ...empty, triggerHovered: false, popupHovered: true }),
        true,
    )
    assert.equal(shouldUpgradeChangelogStayOpen({ ...empty, popupFocused: true }), true)
    assert.equal(shouldUpgradeChangelogStayOpen(empty), false)
})
