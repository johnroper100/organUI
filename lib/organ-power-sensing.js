'use strict';

const POWER_STATES = new Set(['on', 'off', 'unknown']);
const OBSERVATION_STATES = new Set(['available', 'unavailable', 'unknown']);
const COMBINE_MODES = new Set(['any', 'all', 'separate']);
const CONTROL_SOURCES = new Set([
    'controller-api',
    'power-probe',
    'ignore'
]);
const BLOWER_SOURCES = new Set([
    'power-probe',
    'ignore'
]);

const DEFAULT_POWER_SENSING = Object.freeze({
    control: 'controller-api',
    blower: 'ignore',
    combine: 'separate',
    controlProbe: '',
    blowerProbe: ''
});
const PROBE_SERIAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/;

function readChoice(value, fallback, choices, field) {
    const choice = String(value ?? fallback).trim().toLowerCase();
    if (!choices.has(choice)) {
        throw new Error(
            `organ.powerSensing.${field} must be one of ${[...choices].join(', ')}`
        );
    }
    return choice;
}

function createPowerSensingConfig(config = {}) {
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('organ.powerSensing must be an object');
    }

    const normalized = {
        control: readChoice(
            config.control,
            DEFAULT_POWER_SENSING.control,
            CONTROL_SOURCES,
            'control'
        ),
        blower: readChoice(
            config.blower,
            DEFAULT_POWER_SENSING.blower,
            BLOWER_SOURCES,
            'blower'
        ),
        combine: readChoice(
            config.combine === false ? 'separate' : config.combine,
            DEFAULT_POWER_SENSING.combine,
            COMBINE_MODES,
            'combine'
        ),
        controlProbe: String(config.controlProbe ?? '').trim(),
        blowerProbe: String(config.blowerProbe ?? '').trim()
    };
    for (const field of ['controlProbe', 'blowerProbe']) {
        if (
            normalized[field] !== ''
            && !PROBE_SERIAL_PATTERN.test(normalized[field])
        ) {
            throw new Error(`organ.powerSensing.${field} must be a probe serial number`);
        }
    }
    return normalized;
}

function normalizeObservation(value) {
    if (typeof value === 'boolean') {
        return {
            observationState: 'available',
            state: value ? 'on' : 'off'
        };
    }

    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return {
            observationState: 'unavailable',
            state: 'unknown'
        };
    }

    const state = POWER_STATES.has(value.state) ? value.state : 'unknown';
    let observationState = OBSERVATION_STATES.has(value.observationState)
        ? value.observationState
        : (state === 'unknown' ? 'unknown' : 'available');
    if (observationState !== 'available') {
        return {
            observationState,
            state: 'unknown'
        };
    }

    return {
        observationState,
        state
    };
}

function metricStatus(source, observation) {
    const included = source !== 'ignore';
    const normalized = included
        ? normalizeObservation(observation)
        : {
            observationState: 'unknown',
            state: 'unknown'
        };

    return {
        source,
        included,
        observationState: normalized.observationState,
        state: normalized.state
    };
}

function combinePowerStates(metrics, mode) {
    const included = metrics.filter((metric) => metric.included);
    if (included.length === 0) {
        return {
            observationState: 'unknown',
            state: 'unknown'
        };
    }

    if (mode === 'separate' && included.length > 1) {
        return {
            observationState: 'unknown',
            state: 'unknown'
        };
    }

    const states = included.map((metric) => metric.state);
    let state = 'unknown';
    if (mode === 'any' || mode === 'separate') {
        if (states.includes('on')) {
            state = 'on';
        } else if (states.every((value) => value === 'off')) {
            state = 'off';
        }
    } else if (states.includes('off')) {
        state = 'off';
    } else if (states.every((value) => value === 'on')) {
        state = 'on';
    }

    return {
        observationState: state === 'unknown' ? 'unknown' : 'available',
        state
    };
}

function resolveOrganPowerStatus(config, observations = {}) {
    const normalizedConfig = createPowerSensingConfig(config);
    const controlObservation = normalizedConfig.control === 'controller-api'
        ? observations.controllerApiConnected
        : observations.controlPower;
    const controlPower = metricStatus(
        normalizedConfig.control,
        controlObservation
    );
    const blowerPower = metricStatus(
        normalizedConfig.blower,
        observations.blowerPower
    );

    return {
        combine: normalizedConfig.combine,
        controlPower,
        blowerPower,
        organ: combinePowerStates(
            [controlPower, blowerPower],
            normalizedConfig.combine
        )
    };
}

function resolvePowerProbeObservation(readings, serialNo = '') {
    const powerReadings = Array.isArray(readings)
        ? readings.filter((reading) => reading && reading.probeType === 'power')
        : [];
    const reading = serialNo
        ? powerReadings.find((candidate) => candidate.serialNo === serialNo)
        : (powerReadings.length === 1 ? powerReadings[0] : null);
    if (
        !reading
        || reading.online !== true
        || (reading.loadState !== 'on' && reading.loadState !== 'off')
    ) {
        return {
            observationState: 'unavailable',
            state: 'unknown'
        };
    }
    return {
        observationState: 'available',
        state: reading.loadState
    };
}

module.exports = {
    BLOWER_SOURCES,
    COMBINE_MODES,
    CONTROL_SOURCES,
    DEFAULT_POWER_SENSING,
    combinePowerStates,
    createPowerSensingConfig,
    normalizeObservation,
    resolveOrganPowerStatus,
    resolvePowerProbeObservation
};
