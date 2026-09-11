'use strict';

const fs = require('node:fs');
const { validateOSCCommand } = require('./osc-protocol');
const { buildRemoteCommands } = require('./opus-udp-protocol');

function validateView(config) {
    const fail = message => { throw new Error(message); };
    const label = (value, where) => {
        if (typeof value !== 'string' || !value.trim() || value.length > 200) fail(`${where} must be a non-empty string (up to 200 characters)`);
    };
    const number = (value, min, max, where) => {
        if (!Number.isInteger(value) || value < min || value > max) fail(`${where} must be an integer from ${min} to ${max}`);
    };
    const binding = (value, where) => {
        if (!value || !['stop', 'userVariable', 'expression', 'special', 'state'].includes(value.type)) fail(`${where}: unsupported feedback type`);
        if (value.type === 'state') {
            if (!['memoryLevel', 'localMemoryLevel', 'transposer', 'trackNum', 'trackTime', 'sostActive', 'userVarPage'].includes(value.key)) fail(`${where}: unsupported state key`);
        } else {
            const limits = {stop: [1, 65535], userVariable: [1, 10], expression: [0, 255], special: [0, 65535]};
            number(value.number, ...limits[value.type], where);
        }
    };
    const action = (value, where, sample = 1) => {
        if (!value || !['osc', 'udp', 'api'].includes(value.type)) fail(`${where}: unsupported action type`);
        if (value.type === 'osc') {
            if (value.mode !== undefined && !['pulse', 'send'].includes(value.mode)) fail(`${where}: OSC mode must be pulse or send`);
            const result = validateOSCCommand({cmd: value.cmd, state: value.mode === 'send' ? (value.value === '$value' ? sample : value.value) : 1});
            if (!result.ok) fail(`${where}: ${result.error}`);
        }
        if (value.type === 'udp') {
            try { buildRemoteCommands(substitute(value.command, sample)); } catch (error) { fail(`${where}: ${error.message}`); }
        }
        if (value.type === 'api') {
            // Local API only: config is public, and is never a server-side HTTP proxy.
            if (typeof value.path !== 'string' || !/^\/api\/[a-zA-Z0-9/_-]+$/.test(value.path) || value.path.includes('//')) fail(`${where}: API path must start with /api/ and contain a local endpoint`);
            if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(value.method || 'POST')) fail(`${where}: unsupported HTTP method`);
        }
    };
    label(config.title, 'title');
    if (!Array.isArray(config.groups) || config.groups.length > 30) fail('groups must be an array of up to 30 groups');
    const ids = new Set();
    for (const group of config.groups) {
        if (!group || typeof group !== 'object') fail('Each group must be an object');
        label(group.title, 'group title');
        if (!Array.isArray(group.controls) || group.controls.length > 100) fail(`${group.title}: controls must be an array of up to 100 controls`);
        for (const control of group.controls) {
            if (!control || typeof control.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(control.id) || ids.has(control.id)) fail('Every control needs a unique id using letters, numbers, hyphens or underscores');
            ids.add(control.id);
            label(control.label, control.id);
            if (!['button', 'stop', 'userVariable', 'select', 'range', 'display'].includes(control.type)) fail(`${control.id}: unsupported control type`);
            if (control.feedback) binding(control.feedback, control.id);
            if (control.type === 'stop') number(control.number, 1, 65535, control.id);
            else if (control.type === 'userVariable') number(control.number, 1, 10, control.id);
            else if (control.type === 'display') {
                if (!control.feedback) fail(`${control.id}: display requires feedback`);
            } else if (control.type === 'select') {
                if (!Array.isArray(control.options) || !control.options.length || control.options.length > 100) fail(`${control.id}: select requires options`);
                const values = new Set();
                for (const option of control.options) {
                    if (!option || typeof option !== 'object') fail(`${control.id}: each option must be an object`);
                    label(option.label, control.id);
                    if (!['string', 'number', 'boolean'].includes(typeof option.value) || option.value === '' || values.has(String(option.value))) fail(`${control.id}: option values must be unique non-empty scalars`);
                    values.add(String(option.value));
                    action(control.action, control.id, option.value);
                }
            } else if (control.type === 'range') {
                if (![control.min, control.max, control.step].every(Number.isFinite) || control.min >= control.max || control.step <= 0) fail(`${control.id}: range requires min < max and step > 0`);
                if (control.action?.type === 'osc' && control.action.mode !== 'send') fail(`${control.id}: range OSC action requires send mode`);
                action(control.action, control.id, control.min);
                action(control.action, control.id, control.max);
            } else {
                if (JSON.stringify(control.action)?.includes('"$value"')) fail(`${control.id}: $value requires a select or range control`);
                action(control.action, control.id);
            }
        }
    }
    return config;
}

function validateConsoleControls(config) {
    if (!config || config.version !== 1) throw new Error('version must be 1');
    if (!Array.isArray(config.views) || config.views.length > 30) throw new Error('views must be an array of up to 30 views');
    const ids = new Set();
    for (const view of config.views) {
        if (!view || typeof view.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(view.id) || ids.has(view.id)) throw new Error('Every view needs a unique lowercase id using letters, numbers and hyphens');
        ids.add(view.id);
        validateView(view);
    }
    return config;
}

function substitute(value, input) {
    if (value === '$value') return input;
    if (Array.isArray(value)) return value.map(item => substitute(item, input));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, input)]));
    return value;
}

function loadConsoleControls(filename) {
    return validateConsoleControls(JSON.parse(fs.readFileSync(filename, 'utf8')));
}

module.exports = {validateConsoleControls, loadConsoleControls};
