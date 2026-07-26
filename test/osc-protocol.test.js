'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    colorToBinary,
    labelToBinary,
    parseIndexedToken,
    parseOSCMessage,
    validateOSCCommand
} = require('../lib/osc-protocol');

test('accepts the documented OSC command families used by the UIs', () => {
    const commands = [
        { cmd: '/Stops/push253', state: 1 },
        { cmd: '/Stops/push1', state: 0.25 },
        { cmd: '/Stops/trigger7', state: 0 },
        { cmd: '/keyboard/key25', state: 1 },
        { cmd: '/OPTICS/specialkb122', state: 1 },
        { cmd: '/OPTICS/special2052', state: 0 },
        { cmd: '/faders/fader0', state: 0.5 },
        { cmd: '/faders/fader31', state: 1 },
        { cmd: '/UserDef/inc10', state: 1 },
        { cmd: '/UserDef/dec999', state: 0 }
    ];

    for (const command of commands) {
        assert.deepEqual(validateOSCCommand(command), {
            ok: true,
            value: command
        });
    }
});

test('rejects malformed, unsupported, and non-finite commands', () => {
    const commands = [
        null,
        {},
        { cmd: '', state: 1 },
        { cmd: '/Stops/push1/extra', state: 1 },
        { cmd: '/Stops/pushx', state: 1 },
        { cmd: '/unknown/path1', state: 1 },
        { cmd: '/faders/fader0', state: 1.1 },
        { cmd: '/UserDef/inc11', state: 1 },
        { cmd: '/Stops/push1', state: Number.NaN }
    ];

    for (const command of commands) {
        assert.equal(validateOSCCommand(command).ok, false);
    }
});

test('parses valid node-osc messages and ignores malformed messages', () => {
    assert.deepEqual(parseOSCMessage(['/Stops/push42/color', 'green']), {
        address: '/Stops/push42/color',
        parts: ['Stops', 'push42', 'color'],
        value: 'green'
    });
    assert.deepEqual(parseOSCMessage(['/vibrate']), {
        address: '/vibrate',
        parts: ['vibrate'],
        value: undefined
    });

    assert.equal(parseOSCMessage(null), null);
    assert.equal(parseOSCMessage([]), null);
    assert.equal(parseOSCMessage([42, 'green']), null);
    assert.equal(parseOSCMessage(['Stops/push1', 1]), null);
    assert.equal(parseOSCMessage(['/Stops//push1', 1]), null);
});

test('parses indexed tokens exactly and enforces bounds', () => {
    assert.equal(parseIndexedToken('label253', 'label', 1, 253), 253);
    assert.equal(parseIndexedToken('label253junk', 'label', 1, 253), null);
    assert.equal(parseIndexedToken('label0', 'label', 1, 253), null);
    assert.equal(parseIndexedToken('push254', 'push', 1, 253), null);
});

test('normalizes known colors and binary labels', () => {
    assert.equal(colorToBinary('green', ['green'], ['purple']), 1);
    assert.equal(colorToBinary('purple', ['green'], ['purple']), 0);
    assert.equal(colorToBinary('red', ['green'], ['purple']), null);
    assert.equal(colorToBinary(undefined, ['green'], ['purple']), null);

    assert.equal(labelToBinary(0), 0);
    assert.equal(labelToBinary('0'), 0);
    assert.equal(labelToBinary(1), 1);
    assert.equal(labelToBinary('1'), 1);
    assert.equal(labelToBinary('protected'), null);
});
