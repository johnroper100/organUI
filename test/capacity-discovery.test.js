'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    CapacityDiscovery
} = require('../lib/capacity-discovery');

function successfulReply(kind, number) {
    if (kind === 'level' || kind === 'restore') {
        return 'OK';
    }
    const digits = String(number).padStart(3, '0');
    return kind === 'track'
        ? `Tk${digits}Name`
        : `Fldr${digits}Name`;
}

test('discovers track, folder, and level capacities with bounded probes', () => {
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
        const capacity = {
            track: 900,
            folder: 100,
            level: 300
        }[probe.kind];
        discovery.handleReply(
            probe.kind === 'restore' || probe.number <= capacity
                ? successfulReply(probe.kind, probe.number)
                : 'Value Out of Range'
        );
    }

    assert.deepEqual(result, {
        numTracks: 900,
        numFolders: 100,
        numLevels: 300
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
        const capacity = {
            track: 999,
            folder: 0,
            level: 999
        }[probe.kind];
        discovery.handleReply(
            probe.kind === 'restore' || probe.number <= capacity
                ? successfulReply(probe.kind, probe.number)
                : 'Value Out of Range'
        );
    }

    assert.deepEqual(result, {
        numTracks: 999,
        numFolders: 0,
        numLevels: 999
    });
});

test('restores the prior local level after discovery', () => {
    const probes = [];
    let result = null;
    let currentLevel = 42;
    const discovery = new CapacityDiscovery({
        sendProbe(kind, number) {
            probes.push({ kind, number });
            return true;
        },
        restoreLevel: () => currentLevel,
        onComplete(value) {
            result = value;
        }
    });

    discovery.start();
    currentLevel = 99;
    while (discovery.running) {
        const probe = probes.shift();
        const capacity = { track: 5, folder: 5, level: 100 }[probe.kind];
        discovery.handleReply(
            probe.kind === 'restore' || probe.number <= capacity
                ? successfulReply(probe.kind, probe.number)
                : 'Value Out of Range'
        );
        if (probe.kind === 'restore') {
            assert.equal(probe.number, 42);
        }
    }

    assert.equal(result.numLevels, 100);
});

test('makes a best-effort level restore if level discovery fails', () => {
    const probes = [];
    let failure = null;
    const discovery = new CapacityDiscovery({
        sendProbe(kind, number) {
            probes.push({ kind, number });
            return kind !== 'level';
        },
        restoreLevel: 7,
        onFailure(error) {
            failure = error;
        }
    });

    discovery.start();
    while (discovery.running) {
        const probe = probes.shift();
        discovery.handleReply(
            probe.number <= 1
                ? successfulReply(probe.kind, probe.number)
                : 'Value Out of Range'
        );
    }

    assert.deepEqual(probes.slice(-2), [
        { kind: 'level', number: 500 },
        { kind: 'restore', number: 7 }
    ]);
    assert.match(failure.message, /no controller has been discovered/u);
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
