'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LeftOnAlerts, validateSettings } = require('../lib/left-on-alerts');
const { OrganActivity } = require('../lib/organ-activity');
const power = state => ({ organ: { state, observationState: state === 'unknown' ? 'unknown' : 'available' } });

test('organ left on uses inactivity and recovers when input resumes', () => {
    let time = 100000;
    const alerts = new LeftOnAlerts({ now: () => time });
    alerts.configure({ enabled: true, minutes: 1 });
    alerts.observe(power('on'), 0);
    time += 60000; alerts.observe(power('on'), 0);
    assert.equal(alerts.snapshot().active, false, 'long uptime while playing is normal');
    time += 60000; alerts.observe(power('on'), 60);
    assert.equal(alerts.snapshot().active, true);
    time += 30000; alerts.observe(power('on'), 90);
    assert.equal(alerts.snapshot().events.length, 1, 'same incident does not repeat');
    time += 30000; alerts.observe(power('unknown'), null);
    assert.equal(alerts.snapshot().active, true, 'missing observation does not recover');
    time += 30000; alerts.observe(power('on'), 0, true);
    assert.equal(alerts.snapshot().active, true, 'reconnection baseline is not input');
    time += 30000; alerts.observe(power('on'), 0);
    assert.equal(alerts.snapshot().active, false);
    assert.match(alerts.snapshot().events[0].message, /input resumed/);
});

test('unknown activity cannot trigger and power off clears an incident', () => {
    let time = 0;
    const alerts = new LeftOnAlerts({ now: () => time });
    alerts.configure({ enabled: true, minutes: 1 });
    alerts.observe(power('on'), null);
    time += 600000; alerts.observe(power('on'), null);
    assert.equal(alerts.snapshot().active, false);
    time++; alerts.observe(power('on'), 600);
    time++; alerts.observe(power('off'), null);
    assert.equal(alerts.snapshot().active, false);
    assert.equal(alerts.snapshot().events.length, 2);
});

test('mail retries retain only failed recipients and email-only alerts stay off dashboard', async () => {
    let time = 0; const sent = []; let fail = true;
    const alerts = new LeftOnAlerts({ now: () => time, sendEmail: async to => { if (to === 'b@example.test' && fail) throw new Error('temporary'); sent.push(to); } });
    alerts.configure({ enabled: true, minutes: 1, dashboard: false, email: true, recipients: ['a@example.test', 'b@example.test'] });
    alerts.observe(power('on'), 60);
    await alerts.flush();
    assert.deepEqual(sent, ['a@example.test']);
    assert.equal(alerts.snapshot().pendingEmails, 1);
    assert.equal(alerts.snapshot().events.length, 0);
    fail = false; time += 60000; await alerts.flush();
    assert.deepEqual(sent, ['a@example.test', 'b@example.test']);
    assert.equal(alerts.snapshot().pendingEmails, 0);
});

test('activity counter observation handles input, held keys, stale feedback and reconnects', () => {
    let time = 0; const activity = new OrganActivity(() => time);
    const read = extra => activity.idleSeconds({ available: true, uptimeSeconds: 10000, ...extra });
    assert.equal(read(), null);
    activity.observeCounter('100');
    time += 30000; activity.observeCounter('200');
    assert.equal(read(), 30);
    activity.recordInput(); assert.equal(read(), 0);
    time += 30000; activity.observeCounter('10'); assert.equal(read(), 0);
    time += 30000; activity.observeCounter('20'); assert.equal(read({ keysHeld: true }), 0);
    time += 100000; assert.equal(read(), null);
    activity.observeCounter('1000'); assert.equal(read(), 0);
    assert.equal(read({ available: false }), null);
    activity.reset(); assert.equal(read(), null);
    activity.observeCounter('garbage'); assert.equal(read(), null);
});

test('invalid settings are rejected', () => {
    assert.throws(() => validateSettings({ minutes: 0 }));
    assert.throws(() => validateSettings({ source: 'bad' }));
    assert.throws(() => validateSettings({ dashboard: false, email: false }));
    assert.throws(() => validateSettings({ email: true, recipients: ['bad'] }));
});
