'use strict';

const INTEGRATION_MODES = new Set([
    'control-and-monitor',
    'monitor-only'
]);
const ADAPTER_KINDS = new Set([
    'control-system',
    'sensor',
    'bridge',
    'other'
]);
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;

const OPUS_TWO_ADAPTER = Object.freeze({
    id: 'opus-two-primary',
    adapter: 'opus-two',
    kind: 'control-system',
    manufacturer: 'Opus Two',
    model: '',
    capabilities: Object.freeze({
        monitoring: Object.freeze([
            'connection-state',
            'control-power',
            'organ-state',
            'uptime'
        ]),
        control: Object.freeze([
            'combination-action',
            'configuration',
            'expression',
            'playback',
            'recording',
            'stops',
            'tuning'
        ])
    }),
    extensions: Object.freeze({
        transports: Object.freeze(['osc', 'remote-udp'])
    })
});

function readText(value, fallback, field, maximum) {
    const text = String(value ?? fallback ?? '').trim();
    if (text.length > maximum) {
        throw new Error(`organ.${field} must be at most ${maximum} characters`);
    }
    return text;
}

function normalizeCapabilities(value, fallback, field) {
    const candidates = value === undefined ? fallback : value;
    if (!Array.isArray(candidates)) {
        throw new Error(`organ.adapters[].capabilities.${field} must be an array`);
    }

    const capabilities = [...new Set(candidates.map((candidate) => {
        const capability = String(candidate).trim().toLowerCase();
        if (!IDENTIFIER_PATTERN.test(capability)) {
            throw new Error(
                `organ.adapters[].capabilities.${field} contains an invalid capability`
            );
        }
        return capability;
    }))];
    capabilities.sort();
    return capabilities;
}

function normalizeExtensions(value, fallback) {
    const extensions = value === undefined ? fallback : value;
    if (
        extensions === null
        || typeof extensions !== 'object'
        || Array.isArray(extensions)
    ) {
        throw new Error('organ.adapters[].extensions must be an object');
    }

    const serialized = JSON.stringify(extensions);
    if (Buffer.byteLength(serialized) > 8 * 1024) {
        throw new Error('organ.adapters[].extensions must be at most 8 KB');
    }
    return JSON.parse(serialized);
}

function adapterDefaults(adapter) {
    if (adapter === OPUS_TWO_ADAPTER.adapter) {
        return OPUS_TWO_ADAPTER;
    }
    return {
        kind: 'other',
        manufacturer: '',
        model: '',
        capabilities: {
            monitoring: [],
            control: []
        },
        extensions: {}
    };
}

function normalizeAdapter(config, integrationMode, index) {
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('organ.adapters entries must be objects');
    }

    const adapter = readText(
        config.adapter,
        '',
        `adapters[${index}].adapter`,
        64
    ).toLowerCase();
    if (!IDENTIFIER_PATTERN.test(adapter)) {
        throw new Error('organ.adapters[].adapter must be a lowercase identifier');
    }
    const defaults = adapterDefaults(adapter);
    const id = readText(
        config.id,
        `${adapter}-${index + 1}`,
        `adapters[${index}].id`,
        64
    ).toLowerCase();
    if (!IDENTIFIER_PATTERN.test(id)) {
        throw new Error('organ.adapters[].id must be a lowercase identifier');
    }

    const kind = readText(
        config.kind,
        defaults.kind,
        `adapters[${index}].kind`,
        32
    ).toLowerCase();
    if (!ADAPTER_KINDS.has(kind)) {
        throw new Error(
            'organ.adapters[].kind must be control-system, sensor, bridge, or other'
        );
    }

    const capabilityConfig = config.capabilities ?? {};
    if (
        capabilityConfig === null
        || typeof capabilityConfig !== 'object'
        || Array.isArray(capabilityConfig)
    ) {
        throw new Error('organ.adapters[].capabilities must be an object');
    }

    return {
        id,
        adapter,
        kind,
        manufacturer: readText(
            config.manufacturer,
            defaults.manufacturer,
            `adapters[${index}].manufacturer`,
            100
        ),
        model: readText(
            config.model,
            defaults.model,
            `adapters[${index}].model`,
            100
        ),
        capabilities: {
            monitoring: normalizeCapabilities(
                capabilityConfig.monitoring,
                defaults.capabilities.monitoring,
                'monitoring'
            ),
            control: integrationMode === 'monitor-only'
                ? []
                : normalizeCapabilities(
                    capabilityConfig.control,
                    defaults.capabilities.control,
                    'control'
                )
        },
        extensions: normalizeExtensions(
            config.extensions,
            defaults.extensions
        )
    };
}

function createOrganProfile(config = {}) {
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('organ must be an object');
    }

    const integrationMode = readText(
        config.integrationMode,
        'control-and-monitor',
        'integrationMode',
        32
    ).toLowerCase();
    if (!INTEGRATION_MODES.has(integrationMode)) {
        throw new Error(
            'organ.integrationMode must be control-and-monitor or monitor-only'
        );
    }

    const adapterConfigs = config.adapters ?? [OPUS_TWO_ADAPTER];
    if (!Array.isArray(adapterConfigs) || adapterConfigs.length === 0) {
        throw new Error('organ.adapters must contain at least one adapter');
    }
    const adapters = adapterConfigs.map(
        (adapter, index) => normalizeAdapter(adapter, integrationMode, index)
    );
    const ids = new Set(adapters.map((adapter) => adapter.id));
    if (ids.size !== adapters.length) {
        throw new Error('organ.adapters IDs must be unique');
    }

    return {
        integrationMode,
        adapters
    };
}

module.exports = {
    ADAPTER_KINDS,
    INTEGRATION_MODES,
    OPUS_TWO_ADAPTER,
    createOrganProfile
};
