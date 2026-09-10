'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildRemoteCommands } = require('../lib/opus-udp-protocol');
const root = path.join(__dirname, '..');

function harness() {
    const sent = [], events = {}, pending = [];
    let app, now = 1000;
    const socket = {
        connected: true,
        on(name, callback) { events[name] = callback; },
        timeout() { return this; },
        emit(name, payload, callback) {
            sent.push({name, payload});
            if (typeof callback === 'function') callback(null, {ok: true});
        }
    };
    const source = fs.readFileSync(path.join(root, 'static/js/console.js'), 'utf8').replace(/^import .*;\r?\n/u, '');
    vm.runInNewContext(source, {
        io: () => socket, Date: {now: () => now},
        window: {setTimeout: fn => pending.push(fn)},
        createApp(options) {
            app = options.data();
            for (const [key, fn] of Object.entries(options.methods)) app[key] = fn.bind(app);
            for (const [key, fn] of Object.entries(options.computed)) Object.defineProperty(app, key, {get: fn.bind(app)});
            return {mount: () => app};
        }
    });
    return {app, socket, sent, events, pending, advance(ms) { now += ms; app.now = now; }};
}

test('console maps memory, library and recording selection to valid controller commands', () => {
    const {app, sent} = harness();
    app.changeMemory('Down');
    app.localMemory = true;
    app.changeMemory('Up');
    app.levelNumber = 20;
    app.goMemory();
    app.sheet = 'library'; app.selectedNumber = 3; app.chooseItem();
    app.sheet = 'tracks'; app.selectedNumber = 12; app.chooseItem();
    assert.deepEqual(sent.map(item => buildRemoteCommands(item.payload)), [
        ['CA Dec Mem Level'], ['CA Inc Local Mem Level'], ['CA Goto Local Level 20'],
        ['CA Goto Folder 3'], ['RP Play 12']
    ]);
});

test('console sends paired OSC pulses and preserves expression channel indices', () => {
    const {app, sent, pending} = harness();
    app.tap(2010); pending.shift()();
    assert.equal(sent[0].payload.cmd, '/OPTICS/special2010');
    assert.equal(sent[0].payload.state, 1);
    assert.equal(sent[1].payload.state, 0);
    app.expressions = [{name: '', value: 0}, {name: 'Swell', value: .3}];
    app.moveFader(app.namedExpressions[0].id, '.7');
    assert.equal(sent[2].name, 'moveFader');
    assert.equal(sent[2].payload.id, 1);
    assert.equal(sent[2].payload.value, .7);
});

test('disconnected console does not queue organ commands for later replay', () => {
    const {app, socket, sent, events} = harness();
    socket.connected = false; events.disconnect();
    app.udp('recordToggle'); app.tap(2010); app.moveFader(0, .5); app.refreshNames();
    assert.equal(sent.length, 0);
    assert.equal(app.connected, false);
    assert.match(app.commandStatus, /not sent/);
});

test('timer pauses and resumes without counting paused time', () => {
    const {app, advance} = harness();
    app.startTimer(); advance(65000); assert.equal(app.timerText, '00:01:05');
    app.stopTimer(); advance(10000); assert.equal(app.timerText, '00:01:05');
    app.startTimer(); advance(2000); assert.equal(app.timerText, '00:01:07');
    app.resetTimer(); assert.equal(app.timerText, '00:00:00');
});

test('controller feedback drives names, transposer and site-specific crescendo controls', () => {
    const {app, events} = harness();
    events.trackNum(4); events.udpTrackNames({4: 'BACH543A'});
    events.transposer(2); events.sostActive(1);
    events.stops([{number: 22, name: 'Crescendo B', active: 1}, {number: 23, name: 'Flute', active: 0}]);
    assert.equal(app.currentTrackName, 'BACH543A');
    assert.equal(app.transposeText, '+2');
    assert.equal(app.panelSummary('sostenuto'), 'On');
    assert.equal(app.crescendoStops.length, 1);
    assert.equal(app.crescendoStops[0].number, 22);
});

test('console Vue template compiles without errors', async () => {
    const vueSource = fs.readFileSync(path.join(root, 'static/js/vue.esm-browser.js'), 'utf8');
    const {compile} = await import('data:text/javascript;base64,' + Buffer.from(vueSource).toString('base64'));
    const html = fs.readFileSync(path.join(root, 'console.html'), 'utf8');
    const template = html.slice(html.indexOf('<div id="app"'), html.indexOf('<script src="/socket.io'));
    const errors = [];
    // This template uses literal Unicode, with no encoded HTML entities.
    assert.doesNotMatch(template, /&(?:#\d+|#x[\da-f]+|[a-z]+);/i);
    try {
        compile(template, {decodeEntities: text => text, onError: error => errors.push(error.message)});
    } catch (error) {
        // Avoid printing the bundled Vue data URL in a compiler stack trace.
        assert.fail(error.message);
    }
    assert.deepEqual(errors, []);
});
