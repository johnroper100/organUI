'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    createOrganProfile
} = require('../lib/organ-profile');

test('the default organ profile installs the first Opus Two adapter', () => {
    const profile = createOrganProfile();
    const adapter = profile.adapters[0];

    assert.equal(profile.integrationMode, 'control-and-monitor');
    assert.equal(adapter.adapter, 'opus-two');
    assert.equal(adapter.kind, 'control-system');
    assert.equal(adapter.manufacturer, 'Opus Two');
    assert.ok(adapter.capabilities.monitoring.includes('control-power'));
    assert.ok(adapter.capabilities.monitoring.includes('organ-state'));
    assert.ok(adapter.capabilities.control.includes('stops'));
});

test('an organ can be monitored by a sensor without a control system', () => {
    const profile = createOrganProfile({
        integrationMode: 'monitor-only',
        adapters: [{
            id: 'power-sense',
            adapter: 'gpio-contact',
            kind: 'sensor',
            manufacturer: 'Site integration',
            capabilities: {
                monitoring: ['organ-state'],
                control: ['power']
            },
            extensions: {
                inputPin: 17
            }
        }]
    });
    const adapter = profile.adapters[0];

    assert.equal(adapter.kind, 'sensor');
    assert.deepEqual(adapter.capabilities.monitoring, ['organ-state']);
    assert.deepEqual(adapter.capabilities.control, []);
    assert.equal(adapter.extensions.inputPin, 17);
});

test('multiple adapters can contribute monitoring and control features', () => {
    const profile = createOrganProfile({
        integrationMode: 'control-and-monitor',
        adapters: [
            {
                id: 'console',
                adapter: 'future-console',
                kind: 'control-system',
                capabilities: {
                    monitoring: ['uptime'],
                    control: ['stops']
                }
            },
            {
                id: 'power-sense',
                adapter: 'gpio-contact',
                kind: 'sensor',
                capabilities: {
                    monitoring: ['organ-state'],
                    control: []
                }
            }
        ]
    });

    assert.equal(profile.adapters.length, 2);
    assert.equal(profile.adapters[1].kind, 'sensor');
});

test('adapter identifiers and IDs are validated and unique', () => {
    assert.throws(
        () => createOrganProfile({
            adapters: [{ adapter: 'Not A Slug' }]
        }),
        /lowercase identifier/
    );
    assert.throws(
        () => createOrganProfile({
            adapters: [
                { id: 'same', adapter: 'one' },
                { id: 'same', adapter: 'two' }
            ]
        }),
        /must be unique/
    );
});
