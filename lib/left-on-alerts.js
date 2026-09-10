'use strict';

const fs = require('fs');
const crypto = require('crypto');

const DEFAULTS = Object.freeze({ enabled: false, minutes: 240, source: 'organ', dashboard: true, email: false, recovery: true, recipients: [] });

function validateSettings(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Provide alert settings.');
    const settings = { ...DEFAULTS, ...input };
    for (const key of ['enabled', 'dashboard', 'email', 'recovery']) {
        if (typeof settings[key] !== 'boolean') throw new Error('Invalid alert option.');
    }
    settings.minutes = Number(settings.minutes);
    if (!Number.isInteger(settings.minutes) || settings.minutes < 1 || settings.minutes > 10080) throw new Error('Choose between 1 minute and 7 days.');
    if (!['organ', 'controlPower', 'blowerPower'].includes(settings.source)) throw new Error('Choose an organ power source.');
    if (!settings.dashboard && !settings.email) throw new Error('Select dashboard or email delivery.');
    if (!Array.isArray(settings.recipients) || settings.recipients.length > 30 || settings.recipients.some(value => typeof value !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) || value.length > 254)) throw new Error('Enter up to 30 valid email addresses.');
    settings.recipients = [...new Set(settings.recipients.map(value => value.trim().toLowerCase()))];
    if (settings.email && !settings.recipients.length) throw new Error('Enter an email recipient.');
    return Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, settings[key]]));
}

class LeftOnAlerts {
    constructor({ filePath, sendEmail, now = Date.now }) {
        this.filePath = filePath;
        this.sendEmail = sendEmail;
        this.now = now;
        this.sending = false;
        this.data = { settings: { ...DEFAULTS }, lastSeen: null, active: false, observation: 'unknown', events: [], queue: [] };
        if (filePath && fs.existsSync(filePath)) {
            const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            this.data = { ...this.data, ...saved, settings: validateSettings(saved.settings) };
            this.data.observation = 'unknown';
            this.data.idleSeconds = null;
        }
    }
    persist() {
        if (!this.filePath) return;
        const temporary = this.filePath + '.tmp';
        fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), { mode: 0o600 });
        fs.renameSync(temporary, this.filePath);
    }
    configure(input) {
        const settings = validateSettings(input);
        if (settings.email && !this.sendEmail) throw new Error('Configure the Organ UI email provider before enabling email.');
        const previous = this.data.settings;
        if (['enabled', 'minutes', 'source'].some(key => settings[key] !== previous[key])) {
            this.data.lastSeen = null;
            this.data.active = false;
        }
        this.data.settings = settings;
        this.persist();
        return this.snapshot();
    }
    observe(powerStatus, idleSeconds = null, idleSecondsIsLowerBound = false) {
        const now = this.now();
        const settings = this.data.settings;
        const observation = powerStatus?.[settings.source];
        const state = observation?.observationState === 'available' ? observation.state : 'unknown';
        this.data.observation = state;
        this.data.idleSeconds = idleSeconds;
        this.data.idleSecondsIsLowerBound = idleSecondsIsLowerBound;
        if (!settings.enabled) return;
        if (this.data.lastSeen !== null && now <= this.data.lastSeen) return;
        this.data.lastSeen = now;
        if (state === 'on' && Number.isFinite(idleSeconds) && idleSeconds >= settings.minutes * 60) {
            if (!this.data.active) {
                this.data.active = true;
                this.emit('high', `Organ left on without input for at least ${settings.minutes} minutes.`);
            }
        } else {
            if ((state === 'off' || (state === 'on' && !idleSecondsIsLowerBound && Number.isFinite(idleSeconds) && idleSeconds < settings.minutes * 60)) && this.data.active) {
                this.data.active = false;
                if (settings.recovery) this.emit('normal', state === 'off' ? 'Organ power is off again.' : 'Organ input resumed.');
            }
        }
        this.persist();
    }
    emit(state, message) {
        const event = { id: crypto.randomUUID(), state, message, observedAt: this.now(), dashboard: this.data.settings.dashboard };
        this.data.events = [event, ...this.data.events].slice(0, 100);
        if (this.data.settings.email) {
            for (const recipient of this.data.settings.recipients) this.data.queue.push({ ...event, recipient, attempts: 0, nextAttempt: 0 });
        }
    }
    async flush() {
        if (this.sending || !this.sendEmail || this.data.queue.length === 0) return;
        this.sending = true;
        try {
            for (const entry of [...this.data.queue].slice(0, 30)) {
                if (entry.nextAttempt > this.now()) continue;
                if (!this.data.settings.enabled || !this.data.settings.email || !this.data.settings.recipients.includes(entry.recipient)) {
                    this.data.queue = this.data.queue.filter(item => item !== entry);
                    continue;
                }
                try {
                    await this.sendEmail(entry.recipient, entry.message, entry.observedAt);
                    this.data.queue = this.data.queue.filter(item => item !== entry);
                } catch {
                    entry.attempts++;
                    entry.nextAttempt = this.now() + Math.min(86400000, 60000 * 2 ** Math.min(11, entry.attempts - 1));
                }
                this.persist();
            }
            this.persist();
        } finally { this.sending = false; }
    }
    snapshot() {
        return { settings: this.data.settings, active: this.data.active, observation: this.data.observation,
            idleSeconds: this.data.idleSeconds ?? null, events: this.data.events.filter(event => event.dashboard),
            idleSecondsIsLowerBound: this.data.idleSecondsIsLowerBound ?? true,
            pendingEmails: this.data.queue.length, emailAvailable: !!this.sendEmail };
    }
}

module.exports = { LeftOnAlerts, validateSettings };
