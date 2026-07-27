'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    ProbeBroadcastMonitor,
    parseProbeBroadcast
} = require('../lib/probe-broadcast-monitor');

function packet(overrides = {}) {
    return Buffer.from(JSON.stringify({
        type: 'plenum_probe_reading',
        version: 1,
        serialNo: 'PT-1234-5678-9ABC',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        ipAddress: '192.0.2.20',
        probeUrl: 'https://app.fugara.tech/api/probeData',
        temperature: 70.5,
        temperatureUnit: 'F',
        nativeTemperature: 21.4,
        nativeTemperatureUnit: 'C',
        humidity: 43.2,
        humidityUnit: '%RH',
        updateFrequency: 300,
        ...overrides
    }));
}

test('parses the probe firmware local broadcast contract', () => {
    const reading = parseProbeBroadcast(
        packet(),
        { address: '192.0.2.21' },
        new Date('2026-07-27T12:00:00Z')
    );

    assert.equal(reading.serialNo, 'PT-1234-5678-9ABC');
    assert.equal(reading.temperature, 70.5);
    assert.equal(reading.nativeTemperatureUnit, 'C');
    assert.equal(reading.humidity, 43.2);
    assert.equal(reading.receivedAt, '2026-07-27T12:00:00.000Z');
});

test('rejects unrelated or implausible UDP packets', () => {
    assert.throws(
        () => parseProbeBroadcast(Buffer.from('{"type":"other"}')),
        /Unsupported/
    );
    assert.throws(
        () => parseProbeBroadcast(packet({ humidity: 140 })),
        /humidity/
    );
});

test('tracks the latest reading per probe and derives local reachability', () => {
    const monitor = new ProbeBroadcastMonitor();
    monitor.accept(packet(), {}, new Date('2026-07-27T12:00:00Z'));
    monitor.accept(
        packet({ temperature: 71 }),
        {},
        new Date('2026-07-27T12:01:00Z')
    );

    const current = monitor.list(new Date('2026-07-27T12:02:00Z'));
    assert.equal(current.length, 1);
    assert.equal(current[0].temperature, 71);
    assert.equal(current[0].online, true);

    const stale = monitor.list(new Date('2026-07-27T12:17:00Z'));
    assert.equal(stale[0].online, false);
});
