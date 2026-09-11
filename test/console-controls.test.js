'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {validateConsoleControls, loadConsoleControls} = require('../lib/console-controls');
const root = path.join(__dirname, '..');
const config = controls => ({version: 1, views: [{id: 'test', title: 'Test', groups: [{title: 'Controls', controls}]}]});
const button = action => ({id: 'button', type: 'button', label: 'Command', action});

test('shipped controls preserve former installation controls and documented multi-view example validates', () => {
    const shipped = loadConsoleControls(path.join(root, 'console-controls.json'));
    assert.deepEqual(shipped.views[0].groups.flatMap(group => group.controls.map(control => control.number)), [13, 22]);
    const docs = fs.readFileSync(path.join(root, 'docs/console-controls.md'), 'utf8');
    const example = JSON.parse(docs.match(/```json\s*([\s\S]*?)```/)[1]);
    assert.equal(validateConsoleControls(example).views.length, 2);
    assert.deepEqual(validateConsoleControls({version: 1, views: []}).views, []);
});

test('rejects duplicate view/control IDs and malformed bindings before serving configuration', () => {
    const valid = config([{id: 'stop', label: 'Stop', type: 'stop', number: 13}]);
    assert.throws(() => validateConsoleControls({...valid, views: [...valid.views, ...valid.views]}), /unique/);
    valid.views[0].groups[0].controls.push(valid.views[0].groups[0].controls[0]);
    assert.throws(() => validateConsoleControls(valid), /unique/);
    for (const control of [
        {id: 'bad', label: 'Bad', type: 'stop', number: 0},
        {id: 'bad', label: 'Bad', type: 'userVariable', number: 11},
        {id: 'bad', label: 'Bad', type: 'display', feedback: {type: 'state', key: 'constructor'}},
        {id: 'bad', label: 'Bad', type: 'range', min: 1, max: 0, step: .1}
    ]) assert.throws(() => validateConsoleControls(config([control])));
});

test('validates existing transports and restricts API commands to local endpoints', () => {
    for (const action of [
        {type: 'osc', cmd: '/OPTICS/special2001'},
        {type: 'udp', command: {action: 'generalCancel'}},
        {type: 'api', path: '/api/udp', body: {action: 'generalCancel'}}
    ]) assert.doesNotThrow(() => validateConsoleControls(config([button(action)])));
    for (const action of [
        {type: 'osc', cmd: '/unknown/command'},
        {type: 'osc', cmd: '/faders/fader0', mode: 'send', value: 2},
        {type: 'udp', command: {action: 'unknown'}},
        {type: 'api', path: 'https://example.com/api/udp'},
        {type: 'api', path: '/api/../config'},
        {type: 'api', path: '/api/udp', method: 'TRACE'},
        {type: 'udp', command: {action: 'gotoLevel', number: '$value'}}
    ]) assert.throws(() => validateConsoleControls(config([button(action)])));
});

test('checks every select choice and range boundaries with typed substitutions', () => {
    const select = {id: 'select', label: 'Level', type: 'select', options: [{label: 'One', value: 1}], action: {type: 'udp', command: {action: 'gotoLevel', number: '$value'}}};
    assert.doesNotThrow(() => validateConsoleControls(config([select])));
    select.options.push({label: 'Invalid', value: 0});
    assert.throws(() => validateConsoleControls(config([select])));
    const range = {id: 'range', label: 'Expression', type: 'range', min: 0, max: 1, step: .01, action: {type: 'osc', mode: 'send', cmd: '/faders/fader0', value: '$value'}};
    assert.doesNotThrow(() => validateConsoleControls(config([range])));
    range.max = 2;
    assert.throws(() => validateConsoleControls(config([range])), /out of range/);
});
