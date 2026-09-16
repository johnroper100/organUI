'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {buildOSCFallback, OSCFallbackQueue} = require('../lib/remote-osc-fallback');

test('maps documented API equivalents to OSC and validates before falling back', () => {
    for (const [action, number] of Object.entries({generalCancel: 2000, memoryLevelUp: 2038,
        memoryLevelDown: 2039, trackUp: 2031, trackDown: 2032, toggleTrackLock: 2034,
        recordToggle: 2035, playToggle: 2036})) {
        assert.equal(buildOSCFallback({action})[0].cmd, '/OPTICS/special' + number);
    }
    assert.equal(buildOSCFallback({action: 'playTrack', number: 23})[0].cmd, '/OPTICS/special2123');
    assert.equal(buildOSCFallback({action: 'toggleStop', number: 13})[0].cmd, '/Stops/push13');
    assert.equal(buildOSCFallback({action: 'toggleButton', number: 13})[0].cmd, '/Stops/push13');
    assert.deepEqual(buildOSCFallback({action: 'setButton', number: 13}), [{cmd: '/Stops/trigger13', state: 1}]);
    assert.deepEqual(buildOSCFallback({action: 'clearButton', number: 13}), [{cmd: '/Stops/trigger13', state: 0}]);
    assert.equal(buildOSCFallback({action: 'trackUp', count: 10}).length, 10);
    for (const action of ['pause', 'transposerUp', 'localMemoryLevelUp', 'queryOLED', 'resetDevice']) {
        assert.equal(buildOSCFallback({action}), null);
    }
    assert.throws(() => buildOSCFallback({action: 'trackUp', count: 11}));
    assert.throws(() => buildOSCFallback({action: 'playTrack', number: 20}, {numTracks: 10}));
    assert.throws(() => buildOSCFallback({action: 'toggleStop', number: 65536}));
});

test('repeated OSC commands retain ordered press/release pairs and latched states', () => {
    const sent = [], timers = [];
    const queue = new OSCFallbackQueue({send: (cmd, state) => {sent.push([cmd, state]); return true;},
        schedule: fn => {timers.push(fn); return fn;}, cancel: () => {}});
    queue.enqueue(buildOSCFallback({action: 'memoryLevelUp', count: 2}));
    assert.deepEqual(sent, [['/OPTICS/special2038', 1]]);
    timers.shift()();
    timers.shift()();
    assert.deepEqual(sent.map(item => item[1]), [1, 0, 1, 0]);
    queue.enqueue(buildOSCFallback({action: 'setButton', number: 13}));
    timers.shift()();
    assert.deepEqual(sent.at(-1), ['/Stops/trigger13', 1]);
    queue.enqueue(buildOSCFallback({action: 'trackUp', count: 2}));
    queue.close();
    assert.deepEqual(sent.at(-1), ['/OPTICS/special2031', 0]);
    assert.equal(queue.queue.length, 0);
});
