'use strict';

const { EventEmitter } = require('node:events');
const test = require('node:test');
const assert = require('node:assert/strict');
const { fromBuffer } = require('osc-min');

const {
    OSCControllerTransport,
    getIPv4BroadcastAddresses
} = require('../lib/osc-controller-transport');

class FakeSocket extends EventEmitter {
    constructor() {
        super();
        this.broadcastEnabled = false;
        this.sent = [];
        this.closed = false;
    }

    bind() {
        queueMicrotask(() => this.emit('listening'));
    }

    setBroadcast(enabled) {
        this.broadcastEnabled = enabled;
    }

    send(buffer, port, host, callback) {
        this.sent.push({
            message: fromBuffer(buffer),
            port,
            host
        });
        callback();
    }

    close() {
        this.closed = true;
    }
}

function nextTurn() {
    return new Promise((resolve) => setImmediate(resolve));
}

test('calculates directed broadcast addresses for active IPv4 interfaces', () => {
    const addresses = getIPv4BroadcastAddresses({
        Ethernet: [
            {
                address: '192.168.68.119',
                netmask: '255.255.255.0',
                family: 'IPv4',
                internal: false
            }
        ],
        Internal: [
            {
                address: '127.0.0.1',
                netmask: '255.0.0.0',
                family: 'IPv4',
                internal: true
            }
        ]
    });

    assert.deepEqual(addresses, ['192.168.68.255', '255.255.255.255']);
});

test('discovers a controller by broadcast and directs later commands to it', async () => {
    const socket = new FakeSocket();
    const discovered = [];
    const transport = new OSCControllerTransport({
        createSocket: () => socket,
        networkInterfaces: () => ({
            Ethernet: [
                {
                    address: '10.20.30.4',
                    netmask: '255.255.255.0',
                    family: 4,
                    internal: false
                }
            ]
        }),
        discoveryIntervalMs: 60000,
        onControllerDiscovered: (host) => discovered.push(host)
    });

    transport.refresh();
    await nextTurn();

    assert.equal(socket.broadcastEnabled, true);
    assert.deepEqual(
        socket.sent.map(({ host }) => host),
        ['10.20.30.255', '255.255.255.255']
    );
    assert.equal(socket.sent[0].message.address, '/OPTICS/special2001');
    assert.equal(socket.sent[0].message.args[0].value, 1);

    assert.equal(transport.observeFeedback('10.20.30.12', 1000), true);
    assert.deepEqual(discovered, ['10.20.30.12']);
    assert.equal(transport.send('/Stops/push1', 1), true);
    assert.equal(socket.sent.at(-1).host, '10.20.30.12');
    assert.equal(socket.sent.at(-1).message.address, '/Stops/push1');

    assert.equal(transport.observeFeedback('10.20.30.13', 1001), false);
    assert.equal(
        transport.sendTo('/OPTICS/special2037', 1, '10.20.30.99'),
        true
    );
    assert.equal(socket.sent.at(-1).host, '10.20.30.99');
    transport.close();
    assert.equal(socket.closed, true);
});

test('resumes discovery when an automatically discovered controller is stale', async () => {
    const socket = new FakeSocket();
    const lost = [];
    const transport = new OSCControllerTransport({
        createSocket: () => socket,
        networkInterfaces: () => ({}),
        discoveryIntervalMs: 60000,
        controllerTimeoutMs: 5000,
        onControllerLost: (host) => lost.push(host)
    });

    await nextTurn();
    transport.observeFeedback('192.168.1.20', 1000);
    transport._maintainConnection(7001);

    assert.equal(transport.targetHost, null);
    assert.deepEqual(lost, ['192.168.1.20']);
    assert.equal(socket.sent.at(-1).host, '255.255.255.255');
    transport.close();
});

test('an explicit host override bypasses discovery', async () => {
    const socket = new FakeSocket();
    const transport = new OSCControllerTransport({
        configuredHost: '172.16.1.12',
        createSocket: () => socket,
        discoveryIntervalMs: 60000
    });

    transport.refresh();
    await nextTurn();

    assert.deepEqual(socket.sent.map(({ host }) => host), ['172.16.1.12']);
    assert.equal(transport.observeFeedback('172.16.1.99'), false);
    assert.equal(transport.observeFeedback('172.16.1.12'), true);
    transport.close();
});
