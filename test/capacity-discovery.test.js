'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    CapacityDiscovery
} = require('../lib/capacity-discovery');

function successfulReply(kind, number) {
    const digits = String(number).padStart(3, '0');
    return kind === 'track'
        ? `Tk${digits}Name`
        : `Fldr${digits}Name`;
}

test('discovers track and folder capacities with bounded probes', () => {
    const probes = [];
    let result = null;
    const discovery = new CapacityDiscovery({
        sendProbe(kind, number) {
            probes.push({ kind, number });
            return true;
        },
        onComplete(value) {
            result = value;
        }
    });

    assert.equal(discovery.start(), true);
    while (discovery.running) {
        const probe = probes.shift();
        const capacity = probe.kind === 'track' ? 900 : 100;
        discovery.handleReply(
            probe.number <= capacity
                ? successfulReply(probe.kind, probe.number)
                : 'Value Out of Range'
        );
    }

    assert.deepEqual(result, {
        numTracks: 900,
        numFolders: 100
    });
    assert.equal(probes.length, 0);
});

test('supports empty and maximum discoverable capacities', () => {
    const probes = [];
    let result = null;
    const discovery = new CapacityDiscovery({
        sendProbe(kind, number) {
            probes.push({ kind, number });
            return true;
        },
        onComplete(value) {
            result = value;
        }
    });

    discovery.start();
    while (discovery.running) {
        const probe = probes.shift();
        const capacity = probe.kind === 'track' ? 999 : 0;
        discovery.handleReply(
            probe.number <= capacity
                ? successfulReply(probe.kind, probe.number)
                : 'Value Out of Range'
        );
    }

    assert.deepEqual(result, {
        numTracks: 999,
        numFolders: 0
    });
});

test('ignores unrelated replies and retries timeouts before failing', () => {
    const probes = [];
    const timers = [];
    let failure = null;
    const discovery = new CapacityDiscovery({
        sendProbe(kind, number) {
            probes.push({ kind, number });
            return true;
        },
        onFailure(error) {
            failure = error;
        },
        maxAttempts: 2,
        setTimer(callback) {
            timers.push(callback);
            return { unref() {} };
        },
        clearTimer() {}
    });

    discovery.start();
    assert.equal(discovery.handleReply('OK'), false);
    assert.equal(discovery.handleReply('Tk001Other track'), false);

    timers.shift()();
    timers.shift()();

    assert.equal(probes.length, 2);
    assert.match(failure.message, /track capacity probe timed out/u);
    assert.equal(discovery.running, false);
});
