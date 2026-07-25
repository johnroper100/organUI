'use strict';

const dgram = require('node:dgram');
const net = require('node:net');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { decodeEframe, encodeEframe } = require('./opus-udp-protocol');

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;

function getIPv4InterfaceAddresses(networkInterfaces = os.networkInterfaces()) {
    const addresses = new Set();

    for (const entries of Object.values(networkInterfaces)) {
        for (const entry of entries ?? []) {
            const isIPv4 = entry.family === 'IPv4' || entry.family === 4;
            if (isIPv4 && !entry.internal && net.isIPv4(entry.address)) {
                addresses.add(entry.address);
            }
        }
    }

    return [...addresses];
}

function buildSSDPBeacon(uuid) {
    // Opus-Two's SSDP entity parser expects UUID hex digits in the same
    // uppercase form emitted by the controller and the reference clients.
    const normalizedUUID = String(uuid).toUpperCase();

    return Buffer.from(
        'NOTIFY * HTTP/1.1\r\n'
        + `HOST:${SSDP_ADDRESS}:${SSDP_PORT}\r\n`
        + 'NT:urn:Opus-Two API\r\n'
        + 'NTS:ssdp:alive\r\n'
        + `USN:uuid:${normalizedUUID}::urn:Opus-Two API\r\n`
        + 'CACHE-CONTROL:max-age=3600\r\n\r\n',
        'ascii'
    );
}

function parseSSDPMessage(message) {
    if (!Buffer.isBuffer(message)) {
        return null;
    }

    const text = message.toString('utf8');
    const lines = text.split(/\r?\n/u);
    const firstLine = lines.shift()?.trim() ?? '';
    if (
        !firstLine.startsWith('NOTIFY ')
        && !firstLine.startsWith('HTTP/1.1 ')
    ) {
        return null;
    }

    const headers = {};
    for (const line of lines) {
        const separator = line.indexOf(':');
        if (separator <= 0) {
            continue;
        }
        headers[line.slice(0, separator).trim().toLowerCase()] =
            line.slice(separator + 1).trim();
    }

    const identity = [
        headers.nt,
        headers.st,
        headers.usn,
        headers.server
    ].filter(Boolean).join(' ').toLowerCase();

    if (!identity.includes('opus-two') || identity.includes('opus-two api')) {
        return null;
    }

    return {
        alive: headers.nts?.toLowerCase() !== 'ssdp:byebye',
        headers
    };
}

class OpusUDPTransport {
    constructor(options = {}) {
        const {
            port = 5005,
            fallbackHost = null,
            fallbackHostProvider = () => null,
            beaconIntervalMs = 5000,
            controllerTimeoutMs = 15000,
            uuid = randomUUID(),
            networkInterfaces = () => os.networkInterfaces(),
            createCommandSocket = () => dgram.createSocket({
                type: 'udp4',
                reuseAddr: true
            }),
            createSSDPSocket = () => dgram.createSocket({
                type: 'udp4',
                reuseAddr: true
            }),
            onControllerDiscovered = () => {},
            onControllerLost = () => {},
            onReply = () => {},
            onError = () => {}
        } = options;

        this.port = port;
        this.fallbackHost = fallbackHost;
        this.fallbackHostProvider = fallbackHostProvider;
        this.beaconIntervalMs = beaconIntervalMs;
        this.controllerTimeoutMs = controllerTimeoutMs;
        this.uuid = uuid;
        this.networkInterfaces = networkInterfaces;
        this.onControllerDiscovered = onControllerDiscovered;
        this.onControllerLost = onControllerLost;
        this.onReply = onReply;
        this.onError = onError;
        this.discoveredHost = null;
        this.lastAnnouncementAt = 0;
        this.sequence = 0;
        this.commandReady = false;
        this.ssdpReady = false;
        this.closing = false;
        this.pendingDatagrams = [];

        this.commandSocket = createCommandSocket();
        this.commandSocket.on('error', (error) => this.onError(error));
        this.commandSocket.on('message', (message, rinfo) => {
            const decoded = decodeEframe(message);
            const expectedAddress = net.isIPv4(this.targetHost)
                ? this.targetHost
                : null;
            if (
                decoded !== null
                && (expectedAddress === null || rinfo?.address === expectedAddress)
            ) {
                this.onReply(decoded.payload, rinfo, decoded);
            }
        });
        this.commandSocket.on('listening', () => {
            this.commandReady = true;
            const pending = this.pendingDatagrams;
            this.pendingDatagrams = [];
            for (const datagram of pending) {
                this._sendDatagram(datagram);
            }
        });
        this.commandSocket.bind(this.port, '0.0.0.0');

        const interfaceAddresses = getIPv4InterfaceAddresses(
            this.networkInterfaces()
        );
        // Keep a default socket as a fallback for unusual systems whose
        // adapters are not reported by os.networkInterfaces().
        const ssdpInterfaces = interfaceAddresses.length > 0
            ? interfaceAddresses
            : [null];
        this.ssdpSockets = ssdpInterfaces.map((interfaceAddress) =>
            this._createSSDPSocket(createSSDPSocket, interfaceAddress)
        );
        this.ssdpSocket = this.ssdpSockets[0];

        this.maintenanceTimer = setInterval(
            () => this._maintainConnection(),
            this.beaconIntervalMs
        );
        this.maintenanceTimer.unref();
    }

    get targetHost() {
        return this.discoveredHost
            ?? this.fallbackHostProvider()
            ?? this.fallbackHost;
    }

    get targetSource() {
        if (this.discoveredHost !== null) {
            return 'ssdp';
        }
        if (this.fallbackHostProvider()) {
            return 'osc';
        }
        if (this.fallbackHost !== null) {
            return 'configured';
        }
        return null;
    }

    observeAnnouncement(address, now = Date.now()) {
        if (!net.isIPv4(address)) {
            return false;
        }

        if (this.discoveredHost !== null && this.discoveredHost !== address) {
            return false;
        }

        const isNew = this.discoveredHost === null;
        this.discoveredHost = address;
        this.lastAnnouncementAt = now;
        if (isNew) {
            this.onControllerDiscovered(address);
        }
        return true;
    }

    advertise() {
        if (!this.ssdpReady || this.closing) {
            return;
        }

        for (const socket of this.ssdpSockets) {
            if (socket.ssdpReady) {
                this._advertiseOnSocket(socket);
            }
        }
    }

    send(command) {
        const host = this.targetHost;
        if (host === null) {
            this.advertise();
            return false;
        }

        const datagram = {
            buffer: encodeEframe(command, this.sequence, Date.now()),
            host
        };
        this.sequence = (this.sequence + 1) & 0xffff;

        if (!this.commandReady) {
            this.pendingDatagrams.push(datagram);
        } else {
            this._sendDatagram(datagram);
        }
        return true;
    }

    close() {
        if (this.closing) {
            return;
        }

        this.closing = true;
        clearInterval(this.maintenanceTimer);
        this.pendingDatagrams = [];
        this._closeSocket(this.commandSocket);
        for (const socket of this.ssdpSockets) {
            this._closeSocket(socket);
        }
    }

    _maintainConnection(now = Date.now()) {
        if (
            this.discoveredHost !== null
            && now - this.lastAnnouncementAt > this.controllerTimeoutMs
        ) {
            this._loseController();
        }
        this.advertise();
    }

    _loseController() {
        const host = this.discoveredHost;
        if (host === null) {
            return;
        }
        this.discoveredHost = null;
        this.lastAnnouncementAt = 0;
        this.onControllerLost(host);
    }

    _createSSDPSocket(createSSDPSocket, interfaceAddress) {
        const socket = createSSDPSocket();
        socket.ssdpReady = false;
        socket.on('error', (error) => this.onError(error));
        socket.on('message', (message, rinfo) => {
            const announcement = parseSSDPMessage(message);
            if (announcement === null || !net.isIPv4(rinfo?.address)) {
                return;
            }

            if (announcement.alive) {
                this.observeAnnouncement(rinfo.address);
            } else if (rinfo.address === this.discoveredHost) {
                this._loseController();
            }
        });
        socket.on('listening', () => {
            try {
                if (interfaceAddress === null) {
                    socket.addMembership(SSDP_ADDRESS);
                } else {
                    socket.addMembership(SSDP_ADDRESS, interfaceAddress);
                    socket.setMulticastInterface(interfaceAddress);
                }
                socket.setMulticastTTL(15);
                socket.setMulticastLoopback(false);
                socket.ssdpReady = true;
                this.ssdpReady = true;
                this._advertiseOnSocket(socket);
            } catch (error) {
                this.onError(error);
            }
        });
        socket.bind(SSDP_PORT, '0.0.0.0');
        return socket;
    }

    _advertiseOnSocket(socket) {
        socket.send(
            buildSSDPBeacon(this.uuid),
            SSDP_PORT,
            SSDP_ADDRESS,
            (error) => {
                if (error) {
                    this.onError(error);
                }
            }
        );
    }

    _sendDatagram(datagram) {
        if (this.closing) {
            return;
        }
        this.commandSocket.send(
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

    _closeSocket(socket) {
        try {
            socket.close();
        } catch (error) {
            if (error.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') {
                this.onError(error);
            }
        }
    }
}

module.exports = {
    OpusUDPTransport,
    SSDP_ADDRESS,
    SSDP_PORT,
    buildSSDPBeacon,
    getIPv4InterfaceAddresses,
    parseSSDPMessage
};
