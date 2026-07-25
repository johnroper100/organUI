'use strict';

const { EventEmitter } = require('node:events');
const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeEframe } = require('../lib/opus-udp-protocol');
const {
    OpusUDPTransport,
    SSDP_ADDRESS,
    SSDP_PORT,
    buildSSDPBeacon,
    getIPv4InterfaceAddresses,
    parseSSDPMessage
} = require('../lib/opus-udp-transport');

class FakeSocket extends EventEmitter {
    constructor() {
        super();
        this.sent = [];
        this.closed = false;
        this.memberships = [];
        this.multicastInterfaces = [];
    }

    bind() {
        queueMicrotask(() => this.emit('listening'));
    }

    addMembership(address, interfaceAddress) {
        this.memberships.push({ address, interfaceAddress });
    }

    setMulticastInterface(address) {
        this.multicastInterfaces.push(address);
    }

    setMulticastTTL() {}

    setMulticastLoopback() {}

    send(buffer, port, host, callback) {
        this.sent.push({ buffer, port, host });
        callback();
    }

    close() {
        this.closed = true;
    }
}

function nextTurn() {
    return new Promise((resolve) => setImmediate(resolve));
}

test('builds API beacons and recognizes controller announcements', () => {
    const beacon = buildSSDPBeacon(
        '45f2565f-6e7e-4004-a845-3ca4758054f8'
    ).toString('ascii');
    assert.match(beacon, /NT:urn:Opus-Two API/u);
    assert.match(
        beacon,
        /USN:uuid:45F2565F-6E7E-4004-A845-3CA4758054F8::urn:Opus-Two API/u
    );
    assert.equal(parseSSDPMessage(Buffer.from(beacon)), null);

    const controller = Buffer.from(
        'NOTIFY * HTTP/1.1\r\n'
        + 'NT:urn:Opus-Two CVE\r\n'
        + 'NTS:ssdp:alive\r\n'
        + 'USN:uuid:console::urn:Opus-Two CVE\r\n\r\n'
    );
    assert.deepEqual(parseSSDPMessage(controller), {
        alive: true,
        headers: {
            nt: 'urn:Opus-Two CVE',
            nts: 'ssdp:alive',
            usn: 'uuid:console::urn:Opus-Two CVE'
        }
    });
});

test('selects active non-loopback IPv4 interfaces for SSDP', () => {
    const addresses = getIPv4InterfaceAddresses({
        Ethernet: [
            {
                address: '192.168.68.119',
                family: 'IPv4',
                internal: false
            }
        ],
        Internal: [
            {
                address: '127.0.0.1',
                family: 'IPv4',
                internal: true
            }
        ],
        IPv6: [
            {
                address: 'fe80::1',
                family: 'IPv6',
                internal: false
            }
        ]
    });

    assert.deepEqual(addresses, ['192.168.68.119']);
});

test('discovers with SSDP, advertises, and sends framed commands', async () => {
    const commandSocket = new FakeSocket();
    const ssdpSocket = new FakeSocket();
    const discovered = [];
    const replies = [];
    const transport = new OpusUDPTransport({
        uuid: 'test-uuid',
        beaconIntervalMs: 60000,
        networkInterfaces: () => ({
            Ethernet: [{
                address: '10.0.0.10',
                family: 'IPv4',
                internal: false
            }]
        }),
        createCommandSocket: () => commandSocket,
        createSSDPSocket: () => ssdpSocket,
        onControllerDiscovered: (host) => discovered.push(host),
        onReply: (reply) => replies.push(reply)
    });

    await nextTurn();
    assert.deepEqual(ssdpSocket.memberships, [{
        address: SSDP_ADDRESS,
        interfaceAddress: '10.0.0.10'
    }]);
    assert.deepEqual(ssdpSocket.multicastInterfaces, ['10.0.0.10']);
    assert.equal(ssdpSocket.sent[0].port, SSDP_PORT);
    assert.equal(ssdpSocket.sent[0].host, SSDP_ADDRESS);

    ssdpSocket.emit(
        'message',
        Buffer.from(
            'NOTIFY * HTTP/1.1\r\n'
            + 'NT:urn:Opus-Two CVE\r\n'
            + 'NTS:ssdp:alive\r\n\r\n'
        ),
        { address: '10.0.0.20' }
    );
    assert.deepEqual(discovered, ['10.0.0.20']);
    assert.equal(transport.targetHost, '10.0.0.20');
    assert.equal(transport.targetSource, 'ssdp');

    assert.equal(transport.send('RP Track Up'), true);
    const datagram = commandSocket.sent.at(-1);
    assert.equal(datagram.host, '10.0.0.20');
    assert.equal(datagram.port, 5005);

    commandSocket.emit(
        'message',
        encodeEframe('OK'),
        { address: '10.0.0.20' }
    );
    assert.deepEqual(replies, ['OK']);

    transport.close();
    assert.equal(commandSocket.closed, true);
    assert.equal(ssdpSocket.closed, true);
});

test('prefers SSDP over OSC discovery and configured fallback addresses', () => {
    const commandSocket = new FakeSocket();
    const ssdpSocket = new FakeSocket();
    let oscHost = '10.0.0.30';
    const transport = new OpusUDPTransport({
        fallbackHost: '10.0.0.40',
        fallbackHostProvider: () => oscHost,
        beaconIntervalMs: 60000,
        networkInterfaces: () => ({
            Ethernet: [{
                address: '10.0.0.10',
                family: 4,
                internal: false
            }]
        }),
        createCommandSocket: () => commandSocket,
        createSSDPSocket: () => ssdpSocket
    });

    assert.equal(transport.targetHost, '10.0.0.30');
    assert.equal(transport.targetSource, 'osc');
    oscHost = null;
    assert.equal(transport.targetHost, '10.0.0.40');
    assert.equal(transport.targetSource, 'configured');
    transport.observeAnnouncement('10.0.0.20', 1000);
    assert.equal(transport.targetHost, '10.0.0.20');
    assert.equal(transport.targetSource, 'ssdp');

    transport.close();
});
