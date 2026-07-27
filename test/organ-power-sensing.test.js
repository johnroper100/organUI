'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    createPowerSensingConfig,
    resolveOrganPowerStatus
} = require('../lib/organ-power-sensing');

test('default sensing treats the controller API connection as control power', () => {
    const status = resolveOrganPowerStatus({}, {
        controllerApiConnected: true
    });

    assert.deepEqual(createPowerSensingConfig(), {
        control: 'controller-api',
        blower: 'ignore',
        combine: 'separate'
    });
    assert.equal(status.controlPower.included, true);
    assert.equal(status.controlPower.state, 'on');
    assert.equal(status.blowerPower.included, false);
    assert.equal(status.organ.state, 'on');
});

test('a blower-only organ can ignore control power', () => {
    const status = resolveOrganPowerStatus({
        control: 'ignore',
        blower: 'power-monitor'
    }, {
        blowerPower: {
            observationState: 'available',
            state: 'on'
        }
    });

    assert.equal(status.controlPower.included, false);
    assert.equal(status.blowerPower.state, 'on');
    assert.equal(status.organ.state, 'on');
});

test('any mode reports on when either included circuit is powered', () => {
    const status = resolveOrganPowerStatus({
        control: 'controller-api',
        blower: 'power-monitor',
        combine: 'any'
    }, {
        controllerApiConnected: false,
        blowerPower: true
    });

    assert.equal(status.controlPower.state, 'off');
    assert.equal(status.blowerPower.state, 'on');
    assert.equal(status.organ.state, 'on');
});

test('all mode requires every included circuit to be powered', () => {
    const status = resolveOrganPowerStatus({
        control: 'controller-api',
        blower: 'power-monitor',
        combine: 'all'
    }, {
        controllerApiConnected: true,
        blowerPower: false
    });

    assert.equal(status.organ.state, 'off');
});

test('separate mode does not invent a combined organ state', () => {
    const status = resolveOrganPowerStatus({
        control: 'controller-api',
        blower: 'power-monitor',
        combine: 'separate'
    }, {
        controllerApiConnected: true,
        blowerPower: true
    });

    assert.equal(status.controlPower.state, 'on');
    assert.equal(status.blowerPower.state, 'on');
    assert.equal(status.organ.state, 'unknown');
    assert.equal(status.organ.observationState, 'unknown');
});

test('combine false is accepted as a convenient separate-mode setting', () => {
    const config = createPowerSensingConfig({ combine: false });

    assert.equal(config.combine, 'separate');
});

test('unimplemented power-monitor inputs remain unknown', () => {
    const status = resolveOrganPowerStatus({
        control: 'power-monitor',
        blower: 'ignore'
    });

    assert.equal(status.controlPower.observationState, 'unavailable');
    assert.equal(status.controlPower.state, 'unknown');
    assert.equal(status.organ.state, 'unknown');
});

test('invalid sensing choices fail during startup configuration', () => {
    assert.throws(
        () => createPowerSensingConfig({ blower: 'controller-api' }),
        /organ\.powerSensing\.blower/
    );
    assert.throws(
        () => createPowerSensingConfig({ combine: 'sometimes' }),
        /organ\.powerSensing\.combine/
    );
});
