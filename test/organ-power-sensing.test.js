'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    createPowerSensingConfig,
    resolveOrganPowerStatus,
    resolvePowerProbeObservation
} = require('../lib/organ-power-sensing');

test('default sensing treats the controller API connection as control power', () => {
    const status = resolveOrganPowerStatus({}, {
        controllerApiConnected: true
    });

    assert.deepEqual(createPowerSensingConfig(), {
        control: 'controller-api',
        blower: 'ignore',
        combine: 'separate',
        controlProbe: '',
        blowerProbe: ''
    });
    assert.equal(status.controlPower.included, true);
    assert.equal(status.controlPower.state, 'on');
    assert.equal(status.blowerPower.included, false);
    assert.equal(status.organ.state, 'on');
});

test('a blower-only organ can ignore control power', () => {
    const status = resolveOrganPowerStatus({
        control: 'ignore',
        blower: 'power-probe'
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
        blower: 'power-probe',
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
        blower: 'power-probe',
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
        blower: 'power-probe',
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

test('unavailable power probes remain unknown', () => {
    const status = resolveOrganPowerStatus({
        control: 'power-probe',
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
    assert.throws(
        () => createPowerSensingConfig({ blowerProbe: 'not a serial!' }),
        /organ\.powerSensing\.blowerProbe/
    );
});

test('selects configured Plenum power probes and auto-selects a sole probe', () => {
    const readings = [
        { probeType: 'environment', serialNo: 'PT-1', online: true },
        { probeType: 'power', serialNo: 'PW-CONTROL', online: true, loadState: 'off' },
        { probeType: 'power', serialNo: 'PW-BLOWER', online: true, loadState: 'on' }
    ];

    assert.deepEqual(resolvePowerProbeObservation(readings, 'PW-BLOWER'), {
        observationState: 'available',
        state: 'on'
    });
    assert.equal(resolvePowerProbeObservation(readings).state, 'unknown');
    assert.equal(resolvePowerProbeObservation([readings[2]]).state, 'on');
    assert.equal(
        resolvePowerProbeObservation([{ ...readings[2], online: false }]).state,
        'unknown'
    );
});
