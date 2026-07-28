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
        probeType: 'environment',
        serialNo: 'PT-1234-5678-9ABC',
        name: 'Great Division',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        ipAddress: '192.0.2.20',
        probeUrl: 'https://app.fugara.tech/api/probeData',
        firmwareVersion: '1.0.0',
        temperature: 70.5,
        temperatureUnit: 'F',
        nativeTemperature: 21.4,
        nativeTemperatureUnit: 'C',
        rawTemperature: 21.1,
        rawTemperatureUnit: 'C',
        humidity: 43.2,
        humidityUnit: '%RH',
        rawHumidity: 42.7,
        rawHumidityUnit: '%RH',
        updateFrequency: 5,
        reportingFrequency: 300,
        displayTemperatureUnit: 'F',
        screenRotation: 180,
        temperatureOffsetC: 0.3,
        humidityOffset: 0.5,
        temperatureScale: 1,
        humidityScale: 1,
        ...overrides
    }));
}

function powerPacket(overrides = {}) {
    return Buffer.from(JSON.stringify({
        type: 'plenum_probe_reading',
        version: 1,
        probeType: 'power',
        serialNo: 'PW-1234-5678-9ABC',
        name: 'Main blower',
        macAddress: '02:11:22:33:44:55',
        ipAddress: '192.0.2.20',
        probeUrl: 'https://app.fugara.tech/api/probeData',
        firmwareVersion: '2.0.0',
        currentAmps: 18.25,
        currentUnit: 'A',
        rawSensorVoltage: 0.1825,
        sensorVoltageUnit: 'V',
        estimatedWatts: 1971,
        powerUnit: 'W',
        loadState: 'on',
        updateFrequency: 5,
        reportingFrequency: 300,
        screenRotation: 180,
        currentScale: 100,
        currentOffsetAmps: 0,
        lineVoltage: 120,
        powerFactor: 0.9,
        onThresholdAmps: 1,
        ...overrides
    }));
}

function pressurePacket(overrides = {}) {
    return Buffer.from(JSON.stringify({
        type: 'plenum_probe_reading',
        version: 1,
        probeType: 'pressure',
        serialNo: 'PR-1234-5678-9ABC',
        name: 'Main regulator',
        macAddress: '02:11:22:33:44:66',
        ipAddress: '192.0.2.21',
        probeUrl: 'https://app.fugara.tech/api/probeData',
        firmwareVersion: '3.0.0',
        pressureInH2O: 72.35,
        pressureUnit: 'inH2O',
        displayPressureUnit: 'inH2O',
        rawSensorVoltage: 2.34,
        sensorVoltageUnit: 'V',
        updateFrequency: 5,
        reportingFrequency: 300,
        screenRotation: 180,
        pressureZeroVoltage: 1.65,
        pressureFullScaleVoltage: 2.97,
        pressureFullScaleInH2O: 138.4,
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
    assert.equal(reading.name, 'Great Division');
    assert.equal(reading.temperature, 70.5);
    assert.equal(reading.nativeTemperatureUnit, 'C');
    assert.equal(reading.rawTemperature, 21.1);
    assert.equal(reading.humidity, 43.2);
    assert.equal(reading.rawHumidity, 42.7);
    assert.equal(reading.updateFrequency, 5);
    assert.equal(reading.reportingFrequency, 300);
    assert.equal(reading.screenRotation, 180);
    assert.equal(reading.firmwareVersion, '1.0.0');
    assert.equal(reading.receivedAt, '2026-07-27T12:00:00.000Z');
});

test('accepts legacy broadcasts with one shared update frequency', () => {
    const payload = JSON.parse(packet().toString('utf8'));
    delete payload.reportingFrequency;
    payload.updateFrequency = 300;

    const reading = parseProbeBroadcast(
        Buffer.from(JSON.stringify(payload))
    );

    assert.equal(reading.updateFrequency, 300);
    assert.equal(reading.reportingFrequency, 300);
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

test('requires the complete pre-release probe display contract', () => {
    const payload = JSON.parse(packet().toString('utf8'));
    delete payload.name;
    assert.throws(
        () => parseProbeBroadcast(Buffer.from(JSON.stringify(payload))),
        /name/
    );

    payload.name = 'Great Division';
    delete payload.rawTemperature;
    assert.throws(
        () => parseProbeBroadcast(Buffer.from(JSON.stringify(payload))),
        /raw temperature/
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

test('parses power probe current, estimated load, and calibration contract', () => {
    const reading = parseProbeBroadcast(
        powerPacket(),
        { address: '192.0.2.99' },
        new Date('2026-07-27T12:00:00Z')
    );

    assert.equal(reading.probeType, 'power');
    assert.equal(reading.currentAmps, 18.25);
    assert.equal(reading.estimatedWatts, 1971);
    assert.equal(reading.loadState, 'on');
    assert.equal(reading.currentScale, 100);
});

test('rejects malformed power probe units and load states', () => {
    assert.throws(
        () => parseProbeBroadcast(powerPacket({ currentUnit: 'mA' })),
        /units/u
    );
    assert.throws(
        () => parseProbeBroadcast(powerPacket({ loadState: 'running' })),
        /load state/u
    );
});

test('parses pressure probe differential pressure and calibration contract', () => {
    const reading = parseProbeBroadcast(
        pressurePacket(),
        { address: '192.0.2.99' },
        new Date('2026-07-27T12:00:00Z')
    );

    assert.equal(reading.probeType, 'pressure');
    assert.equal(reading.pressureInH2O, 72.35);
    assert.equal(reading.pressureUnit, 'inH2O');
    assert.equal(reading.displayPressureUnit, 'inH2O');
    assert.equal(reading.rawSensorVoltage, 2.34);
    assert.equal(reading.pressureZeroVoltage, 1.65);
    assert.equal(reading.pressureFullScaleVoltage, 2.97);
    assert.equal(reading.pressureFullScaleInH2O, 138.4);

    const metricReading = parseProbeBroadcast(
        pressurePacket({ displayPressureUnit: 'mmH2O' })
    );
    assert.equal(metricReading.displayPressureUnit, 'mmH2O');

    const legacyPayload = JSON.parse(pressurePacket().toString('utf8'));
    delete legacyPayload.displayPressureUnit;
    const legacyReading = parseProbeBroadcast(
        Buffer.from(JSON.stringify(legacyPayload))
    );
    assert.equal(legacyReading.displayPressureUnit, 'inH2O');
});

test('rejects malformed pressure probe units and calibration spans', () => {
    assert.throws(
        () => parseProbeBroadcast(pressurePacket({ pressureUnit: 'psi' })),
        /units/u
    );
    assert.throws(
        () => parseProbeBroadcast(pressurePacket({ displayPressureUnit: 'Pa' })),
        /display unit/u
    );
    assert.throws(
        () => parseProbeBroadcast(pressurePacket({
            pressureZeroVoltage: 2.97,
            pressureFullScaleVoltage: 1.65
        })),
        /voltage span/u
    );
});
