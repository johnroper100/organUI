'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildRemoteCommands } = require('../lib/opus-udp-protocol');
const root = path.join(__dirname, '..');

function harness({fetch: fetchMock, pathname = '/console', hash = ''} = {}) {
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
        io: () => socket, Date: {now: () => now}, fetch: fetchMock, AbortSignal, document: {},
        window: {location: {pathname, hash}, setTimeout: fn => pending.push(fn)},
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

test('tab navigation defaults to overview and browsing tracks sends no controller commands', () => {
    const {app, events, sent} = harness();
    assert.equal(app.activeTab, 'overview');
    events.trackNum(12);
    events.udpTrackNames({12: 'Bach', 34: 'Widor'});
    app.openSheet('tracks');
    assert.equal(app.activeTab, 'tracks');
    assert.equal(app.selectedNumber, 12);
    assert.equal(app.sheet, '');
    app.trackSearch = 'widor';
    assert.equal(app.filteredTracks.length, 1);
    assert.equal(app.filteredTracks[0].number, 34);
    app.selectedNumber = 34;
    app.selectTab('settings');
    app.selectTab('overview');
    assert.equal(sent.length, 0);
});

test('tab keyboard navigation wraps, focuses the selected tab, and preserves the timer', () => {
    const {app, advance} = harness();
    let focused = -1, prevented = false;
    const event = {key: 'ArrowLeft', preventDefault() { prevented = true; },
        currentTarget: {parentElement: {querySelectorAll() { return app.tabs.map((_, index) => ({focus() { focused = index; }})); }}}};
    app.startTimer();
    app.tabKeydown(event, 'overview');
    advance(2000);
    assert.equal(app.activeTab, 'settings');
    assert.equal(focused, 3);
    assert.equal(prevented, true);
    assert.equal(app.timerText, '00:00:02');
    event.key = 'Home';
    app.tabKeydown(event, 'settings');
    assert.equal(app.activeTab, 'overview');
    assert.equal(focused, 0);
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

test('probe readings retain stale values but never appear live while disconnected', () => {
    const {app, events} = harness();
    events.connect();
    events.probeReadings([{serialNo: 'env-1', online: true}, {serialNo: 'power-1', online: false}]);
    assert.equal(app.panelSummary('probes'), '1 / 2 live');
    assert.equal(app.probeStatus(app.probes[1]), 'Stale');
    events.disconnect();
    assert.equal(app.liveProbeCount, 0);
    assert.equal(app.probeStatus(app.probes[0]), 'Disconnected');
    assert.equal(app.probes.length, 2);
    events.connect();
    events.probeReadings([{serialNo: 'env-1', online: false}]);
    assert.equal(app.panelSummary('probes'), '0 / 1 live');
    events.probeReadings(null);
    assert.equal(app.probeSummary, 'Waiting');
});

test('probe readouts preserve missing measurements and convert pressure and power units', () => {
    const {app} = harness();
    const environment = app.probeMeasurements({probeType: 'environment', temperature: 20.25, temperatureUnit: 'C', humidity: null});
    assert.equal(environment[0].value, '20.3° C');
    assert.equal(environment[1].value, '--% RH');
    assert.equal(app.probeMeasurements({probeType: 'pressure', pressureInH2O: 4, displayPressureUnit: 'mmH2O'})[0].value, '101.6 mmH2O');
    assert.equal(app.probeMeasurements({probeType: 'pressure', pressureInH2O: null, displayPressureUnit: 'mmH2O'})[0].value, '-- mmH2O');
    assert.equal(app.probeMeasurements({probeType: 'power', estimatedWatts: 1500})[1].value, '1.50 kW');
    assert.equal(app.probeMeasurements({probeType: 'power', currentAmps: 0, estimatedWatts: 0})[0].value, '0.00 A');
});

test('console and landing Vue templates compile without errors', async () => {
    const vueSource = fs.readFileSync(path.join(root, 'static/js/vue.esm-browser.js'), 'utf8');
    const {compile} = await import('data:text/javascript;base64,' + Buffer.from(vueSource).toString('base64'));
    for (const file of ['console.html', 'landing.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
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
    }
});

test('multiple custom tabs reload without duplication and standalone views select only their own controls', async () => {
    let config = {views: [{id: 'installation', title: 'Installation', groups: []}, {id: 'settings', title: 'Organ settings', groups: []}]};
    const fetch = async () => ({ok: true, json: async () => config});
    const {app, sent} = harness({fetch});
    await app.loadCustomViews(); await app.loadCustomViews();
    assert.equal(app.tabs.length, 6);
    assert.equal(app.tabs[3].id, 'custom-installation');
    app.selectTab('custom-settings');
    assert.equal(app.activeTab, 'custom-settings');
    assert.equal(sent.length, 0);
    const {app: standalone} = harness({fetch, pathname: '/console/custom/settings'});
    await standalone.loadCustomViews();
    assert.equal(standalone.activeTab, 'custom-settings');
    assert.equal(standalone.visibleCustomViews.length, 1);
    assert.equal(standalone.visibleCustomViews[0].id, 'settings');
    config = {views: []};
    await standalone.loadCustomViews();
    assert.match(standalone.customError, /not configured/);
    assert.equal(standalone.visibleCustomViews.length, 0);
    await app.loadCustomViews();
    assert.equal(app.activeTab, 'overview');
    assert.equal(app.tabs.length, 4);
});

test('invalid custom configuration removes stale controls and displays the server error', async () => {
    const {app} = harness({fetch: async () => ({ok: false, json: async () => ({error: 'Invalid control'})})});
    app.customViews = [{id: 'old'}];
    app.activeTab = 'custom-old';
    await app.loadCustomViews();
    assert.equal(app.customViews.length, 0);
    assert.equal(app.activeTab, 'settings');
    assert.equal(app.customError, 'Invalid control');
    assert.equal(app.customLoading, false);
});

test('custom stop and user-variable controls use live feedback and paired commands', async () => {
    const {app, events, sent, pending, socket} = harness();
    const stop = {id: 'nazard', type: 'stop', number: 13};
    const variable = {id: 'setting', type: 'userVariable', number: 2};
    assert.equal(app.customReadout(stop), 'Awaiting feedback');
    events.stops([{number: 13, active: 1}]);
    events.userVars([{value: '10'}, {value: '20'}]);
    assert.equal(app.customActive(stop), true);
    assert.equal(app.customReadout(stop), 'On');
    assert.equal(app.customReadout(variable), '20');
    await app.runCustom({id: 'test'}, stop);
    await app.runCustom({id: 'test'}, variable, 'down');
    pending.shift()();
    assert.deepEqual(buildRemoteCommands(sent[0].payload), ['CA Toggle Stop 13']);
    assert.equal(sent[1].payload.cmd, '/UserDef/dec2');
    assert.equal(sent[2].payload.state, 0);
    socket.connected = false;
    await app.runCustom({id: 'test'}, stop);
    assert.equal(sent.length, 3);
});

test('selectors preserve option types, sliders validate limits, and API failures clear pending state', async () => {
    const requests = [];
    let ok = true;
    const {app, sent} = harness({fetch: async (url, request) => {
        requests.push({url, request});
        return {ok, status: ok ? 202 : 503, json: async () => ok ? {ok: true} : {error: 'No controller'}};
    }});
    const view = {id: 'test'};
    const select = {id: 'level', type: 'select', options: [{label: 'Ten', value: 10}], action: {type: 'udp', command: {action: 'gotoLevel', number: '$value'}}};
    await app.runCustom(view, select, '10');
    assert.equal(sent[0].payload.number, 10);
    await app.runCustom(view, select, '99');
    assert.equal(sent.length, 1);
    const range = {id: 'expression', type: 'range', min: 0, max: 1, action: {type: 'osc', mode: 'send', cmd: '/faders/fader0', value: '$value'}};
    await app.runCustom(view, range, '.5');
    assert.equal(requests[0].url, '/api/osc');
    assert.deepEqual(JSON.parse(requests[0].request.body), {cmd: '/faders/fader0', state: .5});
    await app.runCustom(view, range, '2');
    assert.equal(requests.length, 1);
    ok = false;
    await app.runCustom(view, {id: 'api', type: 'button', action: {type: 'api', path: '/api/udp', body: {action: 'generalCancel'}}});
    assert.equal(app.commandStatus, 'No controller');
    assert.equal(app.customPending['test/api'], false);
});
