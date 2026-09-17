'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {buildRemoteCommands} = require('../lib/opus-udp-protocol');
const {buildOSCFallback} = require('../lib/remote-osc-fallback');
const {validateOSCCommand} = require('../lib/osc-protocol');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'tuner.html'), 'utf8');

function harness() {
    const events = {}, sent = [], pending = [];
    let app;
    const socket = {
        connected: true,
        on(name, callback) { events[name] = callback; },
        timeout() { return this; },
        emit(name, payload, callback) {
            sent.push({name, payload});
            if (callback) callback(null, {ok: true, transport: app.udpAvailable ? 'udp' : 'osc'});
        }
    };
    const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace("import { createApp } from 'vue'", '');
    vm.runInNewContext(source, {
        io: () => socket, window: {setTimeout: callback => pending.push(callback)},
        createApp(options) {
            app = options.data();
            for (const [key, method] of Object.entries(options.methods)) app[key] = method.bind(app);
            for (const [key, getter] of Object.entries(options.computed)) Object.defineProperty(app, key, {get: getter.bind(app)});
            return {mount: () => app};
        }
    });
    events.connect();
    return {app, socket, events, sent, pending};
}

async function renderer(app) {
    const vue = fs.readFileSync(path.join(root, 'static/js/vue.esm-browser.js'), 'utf8');
    const {compile} = await import('data:text/javascript;base64,' + Buffer.from(vue).toString('base64'));
    const render = compile(html.slice(html.indexOf('<div id="app"'), html.indexOf('<script src=')), {decodeEntities: text => text.replaceAll('&amp;', '&')});
    function text(node) {
        if (typeof node === 'string') return node;
        return Array.isArray(node?.children) ? node.children.map(text).join('') : node?.children || '';
    }
    return () => {
        const nodes = [];
        function walk(node) {
            if (!node || typeof node !== 'object') return;
            nodes.push(node);
            if (Array.isArray(node.children)) node.children.forEach(walk);
        }
        walk(render(app, []));
        return {
            nodes,
            button: label => nodes.find(node => node.type === 'button' && text(node).trim() === label)
        };
    };
}

test('tuner uses validated shared actions in OSC and UDP modes and blocks unsupported OSC actions', () => {
    const {app, events, sent} = harness();
    for (const command of [{action: 'recordToggle'}, {action: 'playToggle'}, {action: 'toggleTrackLock'},
        {action: 'trackUp', count: 10}, {action: 'trackDown'}, {action: 'playTrack', number: 42}]) {
        app.sendUDPcmd(command.action, command);
        assert.ok(buildOSCFallback(sent.at(-1).payload).length);
    }
    assert.equal(buildOSCFallback(sent[3].payload).length, 10);
    assert.equal(buildOSCFallback(sent[5].payload)[0].cmd, '/OPTICS/special2142');
    const count = sent.length;
    app.sendUDPcmd('pause');
    app.renameItem('renameTrack', 3);
    app.sendUDPcmd('gotoFolder', {number: 4});
    assert.equal(sent.length, count);
    events.udpAvailable(true);
    app.sendUDPcmd('pause');
    app.renameText = 'Prelude';
    app.renameItem('renameTrack', 3);
    app.sendUDPcmd('gotoFolder', {number: 4});
    assert.deepEqual(sent.slice(count).map(item => buildRemoteCommands(item.payload)), [
        ['RP Pause'], ['CA Rename Track 3 "Prelude"'], ['CA Goto Folder 4']
    ]);
    events.udpAvailable(false);
    assert.equal(app.canCommand('pause'), false);
    assert.equal(app.canCommand('playTrack'), true);
});

test('tuner naming switches between OSC keyboard and remote API controls without sending commands', async () => {
    const {app, events, sent, pending} = harness();
    app.page = 4;
    const render = await renderer(app);
    assert.ok(render().button('Previous folder'));
    assert.ok(render().button('Next track'));
    assert.ok(render().button('Clear'));
    assert.equal(render().button('Rename Track'), undefined);
    assert.equal(render().button('Go to Folder'), undefined);
    assert.equal(render().button('Save to current track').props.disabled, true);
    render().button('a').props.onClick();
    pending.shift()();
    events.folderTrackName('Prelude');
    events.namingCurrentFolder('Sunday');
    render().button('Save to current track').props.onClick();
    pending.shift()();
    render().button('Save to current folder').props.onClick();
    pending.shift()();
    assert.deepEqual(sent.map(item => item.payload.cmd), [97, 97, 14, 14, 15, 15].map(code => '/OPTICS/specialkb' + code));
    assert.deepEqual(sent.map(item => item.payload.state), [1, 0, 1, 0, 1, 0]);
    assert.ok(sent.every(item => validateOSCCommand(item.payload).ok));
    assert.equal(app.namingCurrentFolder, 'Sunday');
    const count = sent.length;
    events.udpAvailable(true);
    assert.ok(render().button('Rename Track'));
    assert.ok(render().button('Rename Folder'));
    assert.ok(render().button('Read Track Name'));
    assert.ok(render().button('Go to Folder'));
    assert.equal(render().button('Clear'), undefined);
    events.udpAvailable(false);
    assert.ok(render().button('Save to current track'));
    assert.equal(sent.length, count);
    assert.equal(app.page, 4);
});

test('tuner shows only discovered faders and keeps their original channel indices', async () => {
    const {app, events, sent} = harness();
    const render = await renderer(app);
    assert.equal(render().button('Faders'), undefined);
    events.expressions([{name: '', value: 0}, {name: '   ', value: 0}]);
    assert.equal(render().button('Faders'), undefined);
    events.expressions([{name: '', value: 0}, {name: 'Swell', value: .4}]);
    render().button('Faders').props.onClick();
    assert.equal(app.page, 5);
    const sliders = render().nodes.filter(node => node.type === 'input' && node.props.type === 'range');
    assert.equal(sliders.length, 1);
    assert.equal(sliders[0].props['aria-label'], 'Swell');
    sliders[0].props.onInput({target: {value: '.75'}});
    assert.equal(sent[0].payload.id, 1);
    assert.equal(sent[0].payload.value, .75);
    for (const value of ['NaN', '-1', '2']) app.moveFader(1, value);
    app.moveFader(0, .5);
    assert.equal(sent.length, 1);
    events.expressions([]);
    assert.equal(app.page, 0);
    assert.equal(render().button('Faders'), undefined);
});

test('tuner transport remains usable in OSC mode and enables only supported UDP additions', async () => {
    const {app, events} = harness();
    app.page = 6;
    events.trackNames({1: '', 2: 'Prelude', 3: ' '});
    const render = await renderer(app);
    for (const label of ['Record', 'Play / Toggle', 'Track Up ↑', 'Track Down ↓ 10', 'Select & Play']) assert.ok(render().button(label));
    assert.equal(render().button('Pause'), undefined);
    assert.equal(app.knownTracks.length, 1);
    events.trackLocked(1);
    assert.equal(render().button('Record').props.disabled, true);
    events.oscSpecialStatus({2035: 1, 2036: 1});
    assert.equal(render().button('Record').props.disabled, false, 'active recording can still be stopped');
    assert.equal(render().button('Play / Toggle').props['aria-pressed'], true);
    for (const number of [0, 901, 1.5, '']) {
        app.jumpTrackNumber = number;
        assert.equal(render().button('Select & Play').props.disabled, true);
    }
    events.udpAvailable(true);
    assert.ok(render().button('Pause'));
    events.udpAvailable(false);
    assert.equal(render().button('Pause'), undefined);
});

test('disconnected tuner disables organ controls and never queues commands for reconnect', async () => {
    const {app, events, socket, sent} = harness();
    events.expressions([{name: 'Swell', value: .5}]);
    events.udpAvailable(true);
    socket.connected = false;
    events.disconnect();
    assert.equal(app.connected, false);
    assert.equal(app.udpAvailable, false);
    app.sendOSCcmd('/keyboard/key1', 1);
    app.sendUDPcmd('playToggle');
    app.moveFader(0, .3);
    app.nameKey(97);
    app.sendMessage('refresh');
    assert.equal(sent.length, 0);
    const render = await renderer(app);
    app.page = 6;
    for (const label of ['Record', 'Play / Toggle', 'Stop', 'Select & Play']) assert.equal(render().button(label).props.disabled, true);
    app.page = 4;
    assert.equal(render().button('a').props.disabled, true);
    socket.connected = true;
    events.connect();
    assert.equal(sent.length, 0);
});

test('tuner copying requires destination feedback and recording to be unlocked in either mode', async () => {
    const {app, events} = harness();
    app.page = 7;
    const render = await renderer(app);
    events.trackDupSrc('[source]'); events.trackDupTgt('[target]');
    assert.equal(render().button('Copy >>').props.disabled, true);
    events.trackDupSrc('12 Prelude'); events.trackDupTgt('13 Empty');
    assert.equal(render().button('Copy >>').props.disabled, false);
    events.trackLocked(1);
    assert.equal(render().button('Copy >>').props.disabled, true);
    events.udpAvailable(true);
    events.trackLocked(0);
    assert.equal(render().button('Copy >>').props.disabled, false);
});
