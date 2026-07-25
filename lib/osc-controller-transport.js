'use strict';

const dgram = require('dgram');
const net = require('net');
const os = require('os');
const { Message } = require('node-osc');
const { toBuffer } = require('osc-min');

const REFRESH_ADDRESS = '/OPTICS/special2001';
const REFRESH_STATE = 1;

function ipv4ToUint32(address) {
    if (!net.isIPv4(address)) {
        return null;
    }

    return address
        .split('.')
        .reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
}

function uint32ToIPv4(value) {
    return [
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff
    ].join('.');
}

function getIPv4BroadcastAddresses(networkInterfaces = os.networkInterfaces()) {
    const addresses = new Set();

    for (const entries of Object.values(networkInterfaces)) {
        for (const entry of entries ?? []) {
            const isIPv4 = entry.family === 'IPv4' || entry.family === 4;
            if (!isIPv4 || entry.internal) {
                continue;
            }

            const address = ipv4ToUint32(entry.address);
            const netmask = ipv4ToUint32(entry.netmask);
            if (address === null || netmask === null || netmask === 0xffffffff) {
                continue;
            }

            const broadcast = (address | (~netmask >>> 0)) >>> 0;
            addresses.add(uint32ToIPv4(broadcast));
        }
    }

    // Some network stacks only deliver limited broadcasts, while others
    // require the interface's directed broadcast address.
    addresses.add('255.255.255.255');
    return [...addresses];
}

function encodeOSCMessage(address, state) {
    const message = new Message(address);
    message.append(state);
    return toBuffer(message);
}

class OSCControllerTransport {
    constructor(options = {}) {
        const {
            configuredHost = null,
            port = 8000,
            discoveryIntervalMs = 5000,
            controllerTimeoutMs = 15000,
            networkInterfaces = () => os.networkInterfaces(),
            createSocket = () => dgram.createSocket({
                type: 'udp4',
                reuseAddr: true
            }),
            onControllerDiscovered = () => {},
            onControllerLost = () => {},
            onError = () => {}
        } = options;

        this.configuredHost = configuredHost;
        this.port = port;
        this.discoveryIntervalMs = discoveryIntervalMs;
        this.controllerTimeoutMs = controllerTimeoutMs;
        this.networkInterfaces = networkInterfaces;
        this.onControllerDiscovered = onControllerDiscovered;
        this.onControllerLost = onControllerLost;
        this.onError = onError;

        this.discoveredHost = null;
        this.configuredFeedbackHost = null;
        this.lastFeedbackAt = 0;
        this.ready = false;
        this.closing = false;
        this.pendingDatagrams = [];

        this.socket = createSocket();
        this.socket.on('error', (error) => this.onError(error));
        this.socket.on('listening', () => {
            this.ready = true;

            try {
                this.socket.setBroadcast(true);
            } catch (error) {
                this.onError(error);
            }

            const pending = this.pendingDatagrams;
            this.pendingDatagrams = [];
            for (const datagram of pending) {
                this._sendDatagram(datagram);
            }
        });
        this.socket.bind(0, '0.0.0.0');

        this.maintenanceTimer = setInterval(
            () => this._maintainConnection(),
            this.discoveryIntervalMs
        );
        this.maintenanceTimer.unref();
    }

    get targetHost() {
        return this.configuredHost ?? this.discoveredHost;
    }

    refresh() {
        if (this.targetHost !== null) {
            this._send(REFRESH_ADDRESS, REFRESH_STATE, this.targetHost);
            return;
        }

        const broadcastAddresses = getIPv4BroadcastAddresses(
            this.networkInterfaces()
        );
        for (const address of broadcastAddresses) {
            this._send(REFRESH_ADDRESS, REFRESH_STATE, address);
        }
    }

    send(address, state) {
        if (this.targetHost === null) {
            this.refresh();
            return false;
        }

        this._send(address, state, this.targetHost);
        return true;
    }

    observeFeedback(address, now = Date.now()) {
        if (!net.isIPv4(address)) {
            return false;
        }

        if (this.configuredHost !== null) {
            if (net.isIPv4(this.configuredHost)) {
                if (address !== this.configuredHost) {
                    return false;
                }
            } else if (
                this.configuredFeedbackHost !== null
                && address !== this.configuredFeedbackHost
            ) {
                return false;
            } else {
                this.configuredFeedbackHost = address;
            }

            this.lastFeedbackAt = now;
            return true;
        }

        if (this.discoveredHost === null) {
            this.discoveredHost = address;
            this.lastFeedbackAt = now;
            this.onControllerDiscovered(address);
            return true;
        }

        if (address !== this.discoveredHost) {
            return false;
        }

        this.lastFeedbackAt = now;
        return true;
    }

    close() {
        if (this.closing) {
            return;
        }

        this.closing = true;
        clearInterval(this.maintenanceTimer);
        this.pendingDatagrams = [];

        try {
            this.socket.close();
        } catch (error) {
            if (error.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') {
                this.onError(error);
            }
        }
    }

    _maintainConnection(now = Date.now()) {
        if (
            this.configuredHost === null
            && this.discoveredHost !== null
            && now - this.lastFeedbackAt > this.controllerTimeoutMs
        ) {
            const lostHost = this.discoveredHost;
            this.discoveredHost = null;
            this.lastFeedbackAt = 0;
            this.onControllerLost(lostHost);
        }

        if (this.targetHost === null) {
            this.refresh();
        }
    }

    _send(address, state, host) {
        this._queueDatagram({
            buffer: encodeOSCMessage(address, state),
            host
        });
    }

    _queueDatagram(datagram) {
        if (!this.ready) {
            this.pendingDatagrams.push(datagram);
            return;
        }

        this._sendDatagram(datagram);
    }

    _sendDatagram(datagram) {
        if (this.closing) {
            return;
        }

        this.socket.send(
            datagram.buffer,
            this.port,
            datagram.host,
            (error) => {
                if (error) {
                    this.onError(error);
                }
            }
        );
    }
}

module.exports = {
    OSCControllerTransport,
    REFRESH_ADDRESS,
    REFRESH_STATE,
    getIPv4BroadcastAddresses
};
