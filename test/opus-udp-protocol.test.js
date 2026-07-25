'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    MAX_COMMAND_BYTES,
    MAX_RENAME_CHARS,
    buildRemoteCommands,
    decodeEframe,
    encodeEframe,
    mapOSCCommandToRemote
} = require('../lib/opus-udp-protocol');

test('encodes and decodes chamber-108 RTP/Eframe datagrams', () => {
    const frame = encodeEframe('RP Track Up', 0x1234, 0x89abcdef);

    assert.equal(frame[0], 0x80);
    assert.equal(frame[1], 0x64);
    assert.equal(frame.readUInt16BE(2), 0x1234);
    assert.equal(frame.readUInt32BE(4), 0x89abcdef);
    assert.equal(frame.readUInt32BE(8), 0x76543210);
    assert.equal(frame[12], 108);
    assert.equal(frame[13], 11);
    assert.deepEqual(decodeEframe(frame), {
        sequence: 0x1234,
        timestamp: 0x89abcdef,
        ssrc: 0x76543210,
        payload: 'RP Track Up'
    });
});

test('rejects malformed frames and oversized or non-ASCII payloads', () => {
    assert.equal(decodeEframe(Buffer.alloc(13)), null);

    const wrongChamber = encodeEframe('OK');
    wrongChamber[12] = 1;
    assert.equal(decodeEframe(wrongChamber), null);

    assert.throws(
        () => encodeEframe('x'.repeat(MAX_COMMAND_BYTES + 1)),
        /at most 49 bytes/u
    );
    assert.throws(() => encodeEframe('café'), /must be ASCII/u);
});

test('builds bounded high-level UDP commands', () => {
    const limits = { numTracks: 900, numFolders: 100, numLevels: 100 };

    assert.deepEqual(
        buildRemoteCommands({ action: 'trackUp', count: 3 }, limits),
        ['RP Track Up', 'RP Track Up', 'RP Track Up']
    );
    assert.deepEqual(
        buildRemoteCommands({ action: 'playTrack', number: 42 }, limits),
        ['RP Play 42']
    );
    assert.deepEqual(
        buildRemoteCommands({
            action: 'renameTrack',
            number: 42,
            name: 'Sunday Postlude'
        }, limits),
        ['CA Rename Track 42 "Sunday Postlude"']
    );
    assert.deepEqual(
        buildRemoteCommands({
            action: 'renameFolder',
            number: 7,
            name: 'Choir'
        }, limits),
        ['CA Rename Folder 7 "Choir          "']
    );
    assert.deepEqual(
        buildRemoteCommands({ action: 'gotoFolder', number: 7 }, limits),
        ['CA Goto Folder 7']
    );
});

test('rejects unsafe or out-of-range high-level UDP commands', () => {
    const limits = { numTracks: 10, numFolders: 5, numLevels: 3 };

    assert.throws(
        () => buildRemoteCommands({ action: 'playTrack', number: 11 }, limits),
        /from 1 to 10/u
    );
    assert.throws(
        () => buildRemoteCommands({
            action: 'renameFolder',
            number: 1,
            name: 'bad "name"'
        }, limits),
        /no double quotes/u
    );
    assert.throws(
        () => buildRemoteCommands({
            action: 'renameTrack',
            number: 1,
            name: 'x'.repeat(MAX_RENAME_CHARS + 1)
        }, limits),
        /at most 15 characters/u
    );
    assert.throws(
        () => buildRemoteCommands({ action: 'reset' }, limits),
        /unsupported UDP action/u
    );
});

test('maps UDP-covered OSC controls and leaves other controls for OSC', () => {
    assert.deepEqual(
        mapOSCCommandToRemote({ cmd: '/OPTICS/special2031', state: 1 }),
        {
            handled: true,
            requests: [{ action: 'trackUp' }]
        }
    );
    assert.deepEqual(
        mapOSCCommandToRemote({ cmd: '/OPTICS/special2031', state: 0 }),
        { handled: true, requests: [] }
    );
    assert.deepEqual(
        mapOSCCommandToRemote({ cmd: '/Stops/push13', state: 1 }),
        {
            handled: true,
            requests: [{ action: 'toggleStop', number: 13 }]
        }
    );
    assert.equal(
        mapOSCCommandToRemote({ cmd: '/faders/fader0', state: 0.5 }),
        null
    );
    assert.equal(
        mapOSCCommandToRemote({ cmd: '/OPTICS/special2037', state: 1 }),
        null
    );
});
