'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    FugaraTelemetry,
    loadOrCreateDeviceIdentity,
    normalizeEndpoint,
    normalizeUptimeSeconds
} = require('../lib/fugara-telemetry');

test('telemetry endpoints require HTTPS except on localhost', () => {
    assert.equal(normalizeEndpoint('https://fugara.example/api/organ-ui/heartbeat').protocol, 'https:');
    assert.equal(normalizeEndpoint('http://localhost/api/organ-ui/heartbeat').protocol, 'http:');
    assert.throws(
        () => normalizeEndpoint('http://fugara.example/api/organ-ui/heartbeat'),
        /must use HTTPS/
    );
});

test('device identity is generated once and then reused', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organui-fugara-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const identityPath = path.join(directory, 'identity.json');

    const first = loadOrCreateDeviceIdentity(identityPath);
    const second = loadOrCreateDeviceIdentity(identityPath);

    assert.deepEqual(second, first);
    assert.match(first.deviceId, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
    assert.ok(first.deviceToken.length >= 32);
    assert.match(first.pairingCode, /^[A-Z0-9_-]{10,32}$/);
});

test('heartbeat reports organ adapters, normalized status, and both uptimes', async () => {
    let submitted;
    const telemetry = new FugaraTelemetry({
        endpoint: 'https://fugara.example/api/organ-ui/heartbeat',
        heartbeatSeconds: 60,
        identityPath: path.join(os.tmpdir(), `organui-fugara-${process.pid}-${Date.now()}.json`),
        deviceName: 'Test organ',
        appVersion: '1.2.3',
        organ: {
            integrationMode: 'monitor-only',
            adapters: [{
                id: 'power-sense',
                adapter: 'example-sensor',
                kind: 'sensor',
                manufacturer: 'Example Controls',
                model: 'EC-4',
                capabilities: {
                    monitoring: ['organ-state', 'uptime'],
                    control: ['stops']
                },
                extensions: {
                    apiVersion: 4
                }
            }]
        },
        getStatus: () => ({
            observationState: 'available',
            state: 'on',
            uptimeSeconds: '125',
            uptimeLabel: '2 minutes'
        }),
        request: async (endpoint, token, payload) => {
            submitted = { endpoint, token, payload };
        }
    });

    try {
        assert.equal(await telemetry.sendNow(), true);
        assert.equal(submitted.endpoint.hostname, 'fugara.example');
        assert.ok(submitted.token.length >= 32);
        assert.match(submitted.payload.pairingCode, /^[A-Z0-9_-]{10,32}$/);
        assert.equal(submitted.payload.schemaVersion, 2);
        assert.deepEqual(submitted.payload.services, [{
            id: 'organ',
            capabilities: ['monitoring']
        }]);
        assert.equal(submitted.payload.organ.integrationMode, 'monitor-only');
        assert.equal(submitted.payload.organ.adapters[0].adapter, 'example-sensor');
        assert.equal(submitted.payload.organ.adapters[0].kind, 'sensor');
        assert.deepEqual(
            submitted.payload.organ.adapters[0].capabilities.control,
            []
        );
        assert.equal(submitted.payload.organStatus.observationState, 'available');
        assert.equal(submitted.payload.organStatus.state, 'on');
        assert.equal(submitted.payload.organStatus.uptimeSeconds, 125);
        assert.equal(submitted.payload.organStatus.uptimeLabel, '2 minutes');
        assert.ok(submitted.payload.organUiStatus.uptimeSeconds >= 0);
        assert.equal(submitted.payload.heartbeatIntervalSeconds, 60);
        assert.equal('organUptimeSeconds' in submitted.payload, false);
    } finally {
        fs.rmSync(telemetry.identityPath, { force: true });
    }
});

test('invalid uptime values are not reported as zero', () => {
    assert.equal(normalizeUptimeSeconds('42'), 42);
    assert.equal(normalizeUptimeSeconds('not connected'), null);
    assert.equal(normalizeUptimeSeconds(''), null);
});

test('service descriptors require stable IDs and capabilities', () => {
    assert.throws(
        () => new FugaraTelemetry({
            services: [{ capabilities: ['monitoring'] }]
        }),
        /invalid service/
    );
    assert.throws(
        () => new FugaraTelemetry({
            services: [{ id: 'organ', capabilities: [] }]
        }),
        /invalid service/
    );
});
