'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {validateOSCCommand} = require('../lib/osc-protocol');
const {mapOSCCommandToRemote} = require('../lib/opus-udp-protocol');
const {buildRemoteCommands} = require('../lib/opus-udp-protocol');
const {buildOSCFallback} = require('../lib/remote-osc-fallback');

test('keeps OSC controls and their releases native until the UDP API replies', () => {
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const dispatchSource = source.slice(source.indexOf('function dispatchOSCCommand('), source.indexOf('function handleRemoteReply('));
    const osc = [], udp = [];
    const transport = {hasReplied: false};
    const context = vm.createContext({
        validateOSCCommand, mapOSCCommandToRemote, console,
        oscFallbackPresses: new Set(), opusUdpTransport: transport, data: {udpAvailable: true},
        sendRawOSCCommand(cmd, state) { osc.push({cmd, state}); return true; },
        sendUDPRequest(request) { udp.push(request); return {ok: true}; }
    });
    vm.runInContext(dispatchSource, context);
    const dispatch = context.dispatchOSCCommand;
    const cmd = '/Stops/push13';
    assert.equal(dispatch(cmd, 1), true);
    assert.equal(udp.length, 0);
    transport.hasReplied = true;
    assert.equal(dispatch(cmd, 0), true);
    assert.deepEqual(osc, [{cmd, state: 1}, {cmd, state: 0}]);
    assert.equal(dispatch(cmd, 1), true);
    assert.equal(dispatch(cmd, 0), true);
    assert.deepEqual(udp, [{action: 'toggleStop', number: 13}]);
    assert.equal(osc.length, 2);
});

test('API actions use OSC before UDP readiness, UDP after readiness, and OSC during discovery', () => {
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const functionSource = source.slice(source.indexOf('function sendUDPRequest('), source.indexOf('function inventoryKnownCount('));
    const osc = [], udp = [];
    const transport = {hasReplied: false, targetHost: '10.0.0.20', send: command => {udp.push(command); return true;}};
    const discovery = {running: true};
    const context = vm.createContext({
        buildRemoteCommands, buildOSCFallback,
        remoteLimits: {numTracks: 999, numFolders: 999, numLevels: 999},
        opusUdpTransport: transport, capacityDiscovery: discovery,
        oscTransport: {targetHost: '10.0.0.20'},
        oscFallbackQueue: {enqueue: commands => osc.push(...commands)},
        data: {}, nextLocalMemoryLevel: () => null, updateRemoteTarget() {}
    });
    vm.runInContext(functionSource, context);
    const send = context.sendUDPRequest;
    assert.equal(send({action: 'memoryLevelUp'}).transport, 'osc');
    assert.equal(udp.length, 0);
    assert.match(send({action: 'pause'}).error, /no OSC equivalent/);
    assert.equal(send({action: 'trackUp', count: 11}).ok, false);
    transport.hasReplied = true;
    assert.equal(send({action: 'memoryLevelUp'}).transport, 'osc');
    discovery.running = false;
    assert.equal(send({action: 'memoryLevelUp'}).transport, 'udp');
    assert.deepEqual(udp, ['CA Inc Mem Level']);
    transport.hasReplied = false;
    assert.equal(send({action: 'memoryLevelUp'}).transport, 'osc');
    assert.equal(osc.length, 3);
});

test('console capability matches command readiness rather than SSDP discovery', () => {
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const functionSource = source.slice(source.indexOf('function updateUDPCapability('), source.indexOf('setInterval(updateUDPCapability'));
    const transport = {discoveredHost: '10.0.0.20', hasReplied: false};
    const discovery = {running: false};
    let available;
    const context = vm.createContext({opusUdpTransport: transport, capacityDiscovery: discovery,
        updateScalar(key, event, value) { available = value; }});
    vm.runInContext(functionSource, context);
    context.updateUDPCapability();
    assert.equal(available, false, 'announcements alone cannot enable UDP controls');
    transport.hasReplied = true;
    discovery.running = true;
    context.updateUDPCapability();
    assert.equal(available, false, 'probes temporarily reserve the remote API');
    discovery.running = false;
    context.updateUDPCapability();
    assert.equal(available, true);
    transport.hasReplied = false;
    context.updateUDPCapability();
    assert.equal(available, false, 'expired replies restore OSC even while SSDP continues');
});
