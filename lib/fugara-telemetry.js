'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const {
    createOrganProfile
} = require('./organ-profile');

const DEFAULT_HEARTBEAT_SECONDS = 60;
const MIN_HEARTBEAT_SECONDS = 15;
const MAX_HEARTBEAT_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 10000;

function readHeartbeatSeconds(value, fallback = DEFAULT_HEARTBEAT_SECONDS) {
    const seconds = Number(value ?? fallback);
    if (
        !Number.isInteger(seconds)
        || seconds < MIN_HEARTBEAT_SECONDS
        || seconds > MAX_HEARTBEAT_SECONDS
    ) {
        throw new Error(
            `Fugara heartbeat interval must be between ${MIN_HEARTBEAT_SECONDS} and ${MAX_HEARTBEAT_SECONDS} seconds`
        );
    }
    return seconds;
}

function normalizeEndpoint(value) {
    if (value === undefined || value === null || String(value).trim() === '') {
        return null;
    }

    const endpoint = new URL(String(value).trim());
    const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
    if (
        endpoint.protocol !== 'https:'
        && !(endpoint.protocol === 'http:' && localHosts.has(endpoint.hostname))
    ) {
        throw new Error(
            'Fugara telemetry must use HTTPS (HTTP is allowed only for localhost)'
        );
    }
    if (endpoint.username || endpoint.password || endpoint.hash) {
        throw new Error('Fugara telemetry URL must not contain credentials or a fragment');
    }
    return endpoint;
}

function createDeviceIdentity() {
    return {
        deviceId: crypto.randomUUID(),
        deviceToken: crypto.randomBytes(32).toString('base64url'),
        pairingCode: crypto.randomBytes(9).toString('base64url').toUpperCase()
    };
}

function validDeviceIdentity(identity) {
    return Boolean(
        identity
        && typeof identity.deviceId === 'string'
        && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(identity.deviceId)
        && typeof identity.deviceToken === 'string'
        && identity.deviceToken.length >= 32
        && identity.deviceToken.length <= 255
        && typeof identity.pairingCode === 'string'
        && /^[A-Z0-9_-]{10,32}$/.test(identity.pairingCode)
    );
}

function loadOrCreateDeviceIdentity(identityPath) {
    try {
        const existing = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
        if (!validDeviceIdentity(existing)) {
            throw new Error('identity file has invalid contents');
        }
        return existing;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw new Error(`Unable to read Fugara device identity: ${error.message}`);
        }
    }

    const identity = createDeviceIdentity();
    fs.mkdirSync(path.dirname(identityPath), { recursive: true });
    fs.writeFileSync(
        identityPath,
        `${JSON.stringify(identity, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600, flag: 'wx' }
    );
    return identity;
}

function normalizeUptimeSeconds(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0
        ? Math.floor(seconds)
        : null;
}

function normalizeObservationState(value) {
    if (value === 'available' || value === 'unavailable' || value === 'unknown') {
        return value;
    }
    return 'unknown';
}

function normalizeOrganState(value) {
    if (value === 'on' || value === 'off' || value === 'unknown') {
        return value;
    }
    return 'unknown';
}

function normalizePowerMetric(value) {
    const metric = (
        value
        && typeof value === 'object'
        && !Array.isArray(value)
    ) ? value : {};
    const source = String(metric.source ?? '').trim().toLowerCase();

    return {
        source: /^[a-z0-9][a-z0-9._-]{1,63}$/.test(source)
            ? source
            : 'unknown',
        included: metric.included === true,
        observationState: normalizeObservationState(metric.observationState),
        state: normalizeOrganState(metric.state)
    };
}

function normalizePowerStatus(value) {
    if (
        value === undefined
        || value === null
        || typeof value !== 'object'
        || Array.isArray(value)
    ) {
        return null;
    }

    return {
        combine: (
            value.combine === 'all'
            || value.combine === 'separate'
        ) ? value.combine : 'any',
        controlPower: normalizePowerMetric(value.controlPower),
        blowerPower: normalizePowerMetric(value.blowerPower)
    };
}

function normalizeServices(value, organ) {
    const fallbackCapabilities = organ.integrationMode === 'control-and-monitor'
        ? ['monitoring', 'control']
        : ['monitoring'];
    const services = value ?? [{
        id: 'organ',
        capabilities: fallbackCapabilities
    }];
    if (
        !Array.isArray(services)
        || services.length === 0
        || services.length > 32
    ) {
        throw new Error('Organ UI services must contain at least one service');
    }

    const normalized = services.map((service) => {
        const id = String(service?.id ?? '').trim().toLowerCase();
        if (
            service === null
            || typeof service !== 'object'
            || Array.isArray(service)
            || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)
            || !Array.isArray(service.capabilities)
            || service.capabilities.length === 0
            || service.capabilities.length > 100
        ) {
            throw new Error('Organ UI services contain an invalid service');
        }
        const capabilities = [...new Set(service.capabilities.map((value) => {
            const capability = String(value).trim().toLowerCase();
            if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(capability)) {
                throw new Error('Organ UI services contain an invalid capability');
            }
            return capability;
        }))];
        capabilities.sort();
        return {
            id,
            capabilities
        };
    });
    if (new Set(normalized.map((service) => service.id)).size !== normalized.length) {
        throw new Error('Organ UI service IDs must be unique');
    }
    return normalized;
}

function postJson(endpoint, token, payload, timeoutMs = REQUEST_TIMEOUT_MS) {
    const body = JSON.stringify(payload);
    const transport = endpoint.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const request = transport.request(endpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'X-OrganUI-Token': token,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'User-Agent': `organUI/${payload.appVersion || 'unknown'}`
            }
        }, (response) => {
            const chunks = [];
            let receivedBytes = 0;

            response.on('data', (chunk) => {
                receivedBytes += chunk.length;
                if (receivedBytes <= 64 * 1024) {
                    chunks.push(chunk);
                }
            });
            response.on('end', () => {
                const responseBody = Buffer.concat(chunks).toString('utf8');
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    const error = new Error(
                        `Fugara returned HTTP ${response.statusCode}`
                    );
                    error.statusCode = response.statusCode;
                    error.responseBody = responseBody;
                    reject(error);
                    return;
                }
                resolve({
                    statusCode: response.statusCode,
                    body: responseBody
                });
            });
        });

        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error('Fugara telemetry request timed out'));
        });
        request.on('error', reject);
        request.end(body);
    });
}

class FugaraTelemetry {
    constructor(options = {}) {
        this.endpoint = normalizeEndpoint(options.endpoint);
        this.heartbeatSeconds = readHeartbeatSeconds(options.heartbeatSeconds);
        this.identityPath = options.identityPath
            ?? path.join(__dirname, '..', 'fugara-device.json');
        this.deviceName = String(options.deviceName || os.hostname()).trim().slice(0, 255);
        this.appVersion = String(options.appVersion || '').trim().slice(0, 40);
        this.organ = createOrganProfile(options.organ);
        this.services = normalizeServices(options.services, this.organ);
        this.getStatus = typeof options.getStatus === 'function'
            ? options.getStatus
            : () => ({});
        this.request = options.request ?? postJson;
        this.log = options.log ?? console;
        this.identity = null;
        this.timer = null;
        this.inFlight = false;
        this.lastErrorMessage = null;
    }

    get enabled() {
        return this.endpoint !== null;
    }

    start() {
        if (!this.enabled || this.timer !== null) {
            return false;
        }

        try {
            this.identity = loadOrCreateDeviceIdentity(this.identityPath);
        } catch (error) {
            this.log.warn(`Unable to initialize Fugara telemetry: ${error.message}`);
            return false;
        }
        this.sendNow();
        this.timer = setInterval(
            () => this.sendNow(),
            this.heartbeatSeconds * 1000
        );
        this.timer.unref();
        return true;
    }

    stop() {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    buildPayload() {
        if (!this.identity) {
            this.identity = loadOrCreateDeviceIdentity(this.identityPath);
        }
        const status = this.getStatus() || {};
        const observationState = normalizeObservationState(
            status.observationState
        );
        const organState = normalizeOrganState(status.state);
        const organUptimeSeconds = normalizeUptimeSeconds(status.uptimeSeconds);
        const organUptimeLabel = String(status.uptimeLabel ?? '').slice(0, 100);
        const organUiUptimeSeconds = Math.floor(process.uptime());
        const powerStatus = normalizePowerStatus(status.powerStatus);

        return {
            schemaVersion: 2,
            deviceId: this.identity.deviceId,
            pairingCode: this.identity.pairingCode,
            deviceName: this.deviceName,
            sentAt: new Date().toISOString(),
            services: this.services,
            organ: this.organ,
            organStatus: {
                observationState,
                state: organState,
                uptimeSeconds: organUptimeSeconds,
                uptimeLabel: organUptimeLabel
            },
            ...(powerStatus === null ? {} : { powerStatus }),
            organUiStatus: {
                uptimeSeconds: organUiUptimeSeconds
            },
            heartbeatIntervalSeconds: this.heartbeatSeconds,
            appVersion: this.appVersion
        };
    }

    async sendNow() {
        if (!this.enabled || this.inFlight) {
            return false;
        }

        this.inFlight = true;
        try {
            const payload = this.buildPayload();
            await this.request(
                this.endpoint,
                this.identity.deviceToken,
                payload
            );
            if (this.lastErrorMessage !== null) {
                this.log.info('Fugara telemetry connection restored');
            }
            this.lastErrorMessage = null;
            return true;
        } catch (error) {
            if (this.lastErrorMessage !== error.message) {
                this.log.warn(`Unable to send Fugara telemetry: ${error.message}`);
            }
            this.lastErrorMessage = error.message;
            return false;
        } finally {
            this.inFlight = false;
        }
    }
}

module.exports = {
    DEFAULT_HEARTBEAT_SECONDS,
    FugaraTelemetry,
    createDeviceIdentity,
    loadOrCreateDeviceIdentity,
    normalizeEndpoint,
    normalizeObservationState,
    normalizeOrganState,
    normalizePowerMetric,
    normalizePowerStatus,
    normalizeServices,
    normalizeUptimeSeconds,
    postJson,
    readHeartbeatSeconds,
    validDeviceIdentity
};
