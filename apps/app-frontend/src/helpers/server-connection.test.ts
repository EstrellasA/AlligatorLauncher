import assert from 'node:assert/strict'
import test from 'node:test'

import {
    isServerAddressConfigured,
    isValidServerAddress,
    isValidWebMapUrl,
    isWebMapConfigured,
    normalizeServerAddress,
    PLACEHOLDER_SERVER_ADDRESS,
    resolveServerAddress,
    resolveServerMapUrl,
} from './server-connection.ts'

test('server address precedence is stored setting, then build-time value, then placeholder', () => {
    assert.equal(
        resolveServerAddress('play.example.com:25565', 'build.example.com'),
        'play.example.com:25565',
    )
    assert.equal(resolveServerAddress('', 'build.example.com'), 'build.example.com')
    assert.equal(resolveServerAddress(undefined, 'build.example.com'), 'build.example.com')
    assert.equal(resolveServerAddress('', ''), PLACEHOLDER_SERVER_ADDRESS)
})

test('an invalid stored server address behaves like not configured', () => {
    for (const invalid of ['https://play.example.com', 'play example.com', 'play.example.com/x']) {
        assert.equal(normalizeServerAddress(invalid), '')
        assert.equal(resolveServerAddress(invalid, 'build.example.com'), 'build.example.com')
        assert.equal(resolveServerAddress(invalid, ''), PLACEHOLDER_SERVER_ADDRESS)
    }
})

test('web map precedence is stored setting, then build-time value, then empty', () => {
    assert.equal(
        resolveServerMapUrl('https://stored.example.com/map', 'https://build.example.com/map'),
        'https://stored.example.com/map',
    )
    assert.equal(
        resolveServerMapUrl('', 'https://build.example.com/map'),
        'https://build.example.com/map',
    )
    assert.equal(resolveServerMapUrl('', ''), '')
    assert.equal(resolveServerMapUrl('not-a-url', ''), '')
})

test('the first-run address prompt is skipped once an address is available', () => {
    // Nothing saved and no build-time value: only the placeholder resolves, so
    // the first-run overlay asks the player for an address.
    assert.equal(isServerAddressConfigured('', ''), false)

    // A pre-configured build must behave exactly as before: no prompt.
    assert.equal(isServerAddressConfigured('', 'build.example.com'), true)

    // A returning player who saved an address must never see the prompt again.
    assert.equal(isServerAddressConfigured('play.example.com', ''), true)

    // An invalid saved value is "not configured": prompt instead of using it.
    assert.equal(isServerAddressConfigured('https://play.example.com', ''), false)
})

test('an empty resolved web map URL hides the map entry point', () => {
    const resolved = resolveServerMapUrl('', '')
    assert.equal(resolved, '')
    assert.equal(isWebMapConfigured(resolved), false)
    assert.equal(isWebMapConfigured(undefined), false)
    assert.equal(isWebMapConfigured('   '), false)

    // The same gate must leave a configured map visible.
    const configured = resolveServerMapUrl('https://map.example.com/', '')
    assert.equal(isWebMapConfigured(configured), true)
})

test('server address validation accepts bare hosts and host:port only', () => {
    for (const valid of [
        'play.example.com',
        'play.example.com:25565',
        '127.0.0.1:25565',
        '[::1]:25565',
    ]) {
        assert.equal(isValidServerAddress(valid), true, valid)
    }
    for (const invalid of [
        '',
        '   ',
        'https://play.example.com',
        'play example.com',
        'host:port',
        'host:',
        ':25565',
    ]) {
        assert.equal(isValidServerAddress(invalid), false, invalid)
    }
})

test('web map validation requires an absolute http(s) URL', () => {
    assert.equal(isValidWebMapUrl('https://map.example.com/'), true)
    assert.equal(isValidWebMapUrl('http://map.example.com'), true)
    for (const invalid of ['', 'map.example.com', 'ftp://map.example.com', 'javascript:alert(1)']) {
        assert.equal(isValidWebMapUrl(invalid), false, invalid)
    }
})
