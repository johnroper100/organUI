'use strict';

// Observe resets of the controller's cycles-since-keypress counter without
// assuming a firmware-specific duration for one cycle.
class OrganActivity {
    constructor(now = Date.now) { this.now = now; this.reset(); }
    reset() { this.counter = null; this.counterAt = null; this.idleSince = null; this.idleIsLowerBound = true; }
    recordInput() { this.idleSince = this.now(); this.idleIsLowerBound = false; }
    observeCounter(value) {
        if (value === '' || value === null || !/^\d+$/.test(String(value).trim())) return;
        const counter = Number(value);
        if (!Number.isSafeInteger(counter)) return;
        const now = this.now();
        if (this.counterAt === null || now - this.counterAt > 90000) {
            this.idleSince = now;
            this.idleIsLowerBound = counter !== 0;
        } else if (counter <= this.counter) {
            this.recordInput();
        }
        this.counter = counter;
        this.counterAt = now;
    }
    idleSeconds({ available, uptimeSeconds, keysHeld = false }) {
        const now = this.now();
        if (!available || this.counterAt === null || now - this.counterAt > 90000 || this.idleSince === null) return null;
        if (keysHeld) this.recordInput();
        const idle = Math.max(0, Math.floor((now - this.idleSince) / 1000));
        return Number.isFinite(uptimeSeconds) ? Math.min(idle, uptimeSeconds) : idle;
    }
}

module.exports = { OrganActivity };
