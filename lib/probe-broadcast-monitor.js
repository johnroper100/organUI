'use strict';

const dgram = require('dgram');

const DEFAULT_PORT = 47612;
const MAX_PACKET_BYTES = 8192;
const SERIAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/;

function finiteNumber(value, field, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) {
        throw new Error(`Invalid probe ${field}`);
    }
    return number;
}

function optionalText(value, maximum) {
    return String(value ?? '').trim().slice(0, maximum);
}

function probeRotation(value) {
    const rotation = finiteNumber(value, 'screen rotation', 0, 270);
    if (![0, 90, 180, 270].includes(rotation)) {
        throw new Error('Invalid probe screen rotation');
    }
    return rotation;
}

function parseProbeBroadcast(packet, remote = {}, receivedAt = new Date()) {
    if (!Buffer.isBuffer(packet) || packet.length === 0 || packet.length > MAX_PACKET_BYTES) {
        throw new Error('Invalid probe broadcast size');
    }

    let payload;
    try {
        payload = JSON.parse(packet.toString('utf8'));
    } catch {
        throw new Error('Invalid probe broadcast JSON');
    }
    if (
        !payload
        || typeof payload !== 'object'
        || Array.isArray(payload)
        || payload.type !== 'plenum_probe_reading'
        || payload.version !== 1
    ) {
        throw new Error('Unsupported probe broadcast');
    }

    const serialNo = optionalText(payload.serialNo, 64);
    if (!SERIAL_PATTERN.test(serialNo)) {
        throw new Error('Invalid probe serial number');
    }

    if (!Object.prototype.hasOwnProperty.call(payload, 'name')) {
        throw new Error('Missing probe name');
    }
    const name = optionalText(payload.name, 255);

    const firmwareVersion = optionalText(payload.firmwareVersion, 40);
    if (firmwareVersion === '') {
        throw new Error('Invalid probe firmware version');
    }
    const probeType = optionalText(payload.probeType, 20).toLowerCase();
    if (!['environment', 'power', 'pressure'].includes(probeType)) {
        throw new Error('Invalid probe type');
    }

    const updateFrequency = finiteNumber(
        payload.updateFrequency,
        'update frequency',
        1,
        3600
    );
    if (!Number.isInteger(updateFrequency)) {
        throw new Error('Invalid probe update frequency');
    }

    const common = {
        probeType,
        serialNo,
        name,
        macAddress: optionalText(payload.macAddress, 32),
        ipAddress: optionalText(payload.ipAddress || remote.address, 64),
        probeUrl: optionalText(payload.probeUrl, 240),
        firmwareVersion,
        updateFrequency,
        screenRotation: probeRotation(payload.screenRotation),
        receivedAt: receivedAt.toISOString()
    };

    if (probeType === 'power') {
        if (
            payload.currentUnit !== 'A'
            || payload.sensorVoltageUnit !== 'V'
            || payload.powerUnit !== 'W'
        ) {
            throw new Error('Invalid power probe units');
        }
        const loadState = optionalText(payload.loadState, 8).toLowerCase();
        if (loadState !== 'on' && loadState !== 'off') {
            throw new Error('Invalid power probe load state');
        }

        return {
            ...common,
            currentAmps: finiteNumber(payload.currentAmps, 'current', 0, 100000),
            currentUnit: 'A',
            rawSensorVoltage: finiteNumber(
                payload.rawSensorVoltage,
                'sensor voltage',
                0,
                6.144
            ),
            sensorVoltageUnit: 'V',
            estimatedWatts: finiteNumber(
                payload.estimatedWatts,
                'estimated power',
                0,
                100000000
            ),
            powerUnit: 'W',
            loadState,
            currentScale: finiteNumber(
                payload.currentScale,
                'current scale',
                0.1,
                10000
            ),
            currentOffsetAmps: finiteNumber(
                payload.currentOffsetAmps,
                'current offset',
                -100,
                100
            ),
            lineVoltage: finiteNumber(
                payload.lineVoltage,
                'line voltage',
                1,
                1000
            ),
            powerFactor: finiteNumber(
                payload.powerFactor,
                'power factor',
                0,
                1
            ),
            onThresholdAmps: finiteNumber(
                payload.onThresholdAmps,
                'on threshold',
                0,
                10000
            )
        };
    }

    if (probeType === 'pressure') {
        if (
            payload.pressureUnit !== 'inH2O'
            || payload.sensorVoltageUnit !== 'V'
        ) {
            throw new Error('Invalid pressure probe units');
        }
        const displayPressureUnit = optionalText(
            payload.displayPressureUnit || 'inH2O',
            8
        );
        if (!['inH2O', 'mmH2O'].includes(displayPressureUnit)) {
            throw new Error('Invalid pressure probe display unit');
        }

        const pressureZeroVoltage = finiteNumber(
            payload.pressureZeroVoltage,
            'pressure zero voltage',
            0,
            3.3
        );
        const pressureFullScaleVoltage = finiteNumber(
            payload.pressureFullScaleVoltage,
            'pressure full-scale voltage',
            0,
            3.3
        );
        if (pressureFullScaleVoltage <= pressureZeroVoltage) {
            throw new Error('Invalid pressure probe voltage span');
        }

        return {
            ...common,
            pressureInH2O: finiteNumber(
                payload.pressureInH2O,
                'pressure',
                -10000,
                10000
            ),
            pressureUnit: 'inH2O',
            displayPressureUnit,
            rawSensorVoltage: finiteNumber(
                payload.rawSensorVoltage,
                'sensor voltage',
                0,
                3.3
            ),
            sensorVoltageUnit: 'V',
            pressureZeroVoltage,
            pressureFullScaleVoltage,
            pressureFullScaleInH2O: finiteNumber(
                payload.pressureFullScaleInH2O,
                'pressure full scale',
                0.1,
                10000
            )
        };
    }

    const temperatureUnit = optionalText(payload.temperatureUnit, 2).toUpperCase();
    if (temperatureUnit !== 'C' && temperatureUnit !== 'F') {
        throw new Error('Invalid probe temperature unit');
    }
    const nativeTemperatureUnit = optionalText(
        payload.nativeTemperatureUnit,
        2
    ).toUpperCase();
    if (nativeTemperatureUnit !== 'C') {
        throw new Error('Invalid probe native temperature unit');
    }

    const rawTemperatureUnit = optionalText(
        payload.rawTemperatureUnit,
        2
    ).toUpperCase();
    if (rawTemperatureUnit !== 'C') {
        throw new Error('Invalid probe raw temperature unit');
    }

    const displayTemperatureUnit = optionalText(
        payload.displayTemperatureUnit,
        2
    ).toUpperCase();
    if (
        (displayTemperatureUnit !== 'C' && displayTemperatureUnit !== 'F')
        || displayTemperatureUnit !== temperatureUnit
    ) {
        throw new Error('Invalid probe display temperature unit');
    }

    if (
        payload.humidityUnit !== '%RH'
        || payload.rawHumidityUnit !== '%RH'
    ) {
        throw new Error('Invalid probe humidity unit');
    }

    return {
        ...common,
        temperature: finiteNumber(payload.temperature, 'temperature', -150, 300),
        temperatureUnit,
        nativeTemperature: finiteNumber(
            payload.nativeTemperature,
            'native temperature',
            -100,
            200
        ),
        nativeTemperatureUnit,
        rawTemperature: finiteNumber(
            payload.rawTemperature,
            'raw temperature',
            -100,
            200
        ),
        rawTemperatureUnit,
        humidity: finiteNumber(payload.humidity, 'humidity', 0, 100),
        humidityUnit: '%RH',
        rawHumidity: finiteNumber(
            payload.rawHumidity,
            'raw humidity',
            0,
            100
        ),
        rawHumidityUnit: '%RH',
        displayTemperatureUnit,
        temperatureOffsetC: finiteNumber(
            payload.temperatureOffsetC,
            'temperature offset',
            -30,
            30
        ),
        humidityOffset: finiteNumber(
            payload.humidityOffset,
            'humidity offset',
            -100,
            100
        ),
        temperatureScale: finiteNumber(
            payload.temperatureScale,
            'temperature scale',
            0.5,
            1.5
        ),
        humidityScale: finiteNumber(
            payload.humidityScale,
            'humidity scale',
            0.5,
            1.5
        )
    };
}

class ProbeBroadcastMonitor {
    constructor(options = {}) {
        this.port = Number(options.port ?? DEFAULT_PORT);
        if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) {
            throw new Error('Probe broadcast port must be a valid port');
        }
        this.address = options.address ?? '0.0.0.0';
        this.onReading = typeof options.onReading === 'function'
            ? options.onReading
            : () => {};
        this.onError = typeof options.onError === 'function'
            ? options.onError
            : () => {};
        this.createSocket = options.createSocket
            ?? (() => dgram.createSocket({ type: 'udp4', reuseAddr: true }));
        this.socket = null;
        this.readings = new Map();
    }

    accept(packet, remote = {}, receivedAt = new Date()) {
        const reading = parseProbeBroadcast(packet, remote, receivedAt);
        this.readings.set(reading.serialNo, reading);
        this.onReading(reading, this.list(receivedAt));
        return reading;
    }

    list(now = new Date()) {
        const nowMs = now.getTime();
        return [...this.readings.values()]
            .map((reading) => {
                const ageSeconds = Math.max(
                    0,
                    Math.floor((nowMs - Date.parse(reading.receivedAt)) / 1000)
                );
                return {
                    ...reading,
                    ageSeconds,
                    online: ageSeconds <= Math.max(
                        60,
                        reading.updateFrequency * 3
                    )
                };
            })
            .sort((left, right) => left.serialNo.localeCompare(right.serialNo));
    }

    start() {
        if (this.socket !== null) {
            return false;
        }
        const socket = this.createSocket();
        this.socket = socket;
        socket.on('message', (packet, remote) => {
            try {
                this.accept(packet, remote);
            } catch (error) {
                this.onError(error);
            }
        });
        socket.on('error', (error) => this.onError(error));
        socket.bind(this.port, this.address);
        return true;
    }

    stop() {
        if (this.socket === null) {
            return;
        }
        const socket = this.socket;
        this.socket = null;
        socket.close();
    }
}

module.exports = {
    DEFAULT_PORT,
    ProbeBroadcastMonitor,
    parseProbeBroadcast
};
