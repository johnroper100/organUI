'use strict';

const MAX_DISCOVERABLE_CAPACITY = 999;

function positiveInteger(value, name) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) {
        throw new RangeError(`${name} must be a positive integer`);
    }
    return number;
}

class CapacityDiscovery {
    constructor(options = {}) {
        const {
            sendProbe,
            onComplete = () => {},
            onFailure = () => {},
            maximum = MAX_DISCOVERABLE_CAPACITY,
            timeoutMs = 500,
            maxAttempts = 3,
            setTimer = setTimeout,
            clearTimer = clearTimeout
        } = options;

        if (typeof sendProbe !== 'function') {
            throw new TypeError('sendProbe must be a function');
        }

        this.sendProbe = sendProbe;
        this.onComplete = onComplete;
        this.onFailure = onFailure;
        this.maximum = positiveInteger(maximum, 'maximum');
        this.timeoutMs = positiveInteger(timeoutMs, 'timeoutMs');
        this.maxAttempts = positiveInteger(maxAttempts, 'maxAttempts');
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.running = false;
        this.timer = null;
        this.kind = null;
        this.pendingNumber = null;
        this.attempts = 0;
        this.results = {};
        this.lowerBound = 0;
        this.upperBound = this.maximum + 1;
    }

    start() {
        if (this.running) {
            return false;
        }

        this.running = true;
        this.results = {};
        this._startKind('track');
        return true;
    }

    cancel() {
        this._clearPendingTimer();
        this.running = false;
        this.kind = null;
        this.pendingNumber = null;
    }

    handleReply(reply) {
        if (
            !this.running
            || this.pendingNumber === null
            || typeof reply !== 'string'
        ) {
            return false;
        }

        const isOutOfRange = reply.trim() === 'Value Out of Range';
        const match = this.kind === 'track'
            ? /^Tk(\d{3})/u.exec(reply)
            : /^Fldr(\d{3})/u.exec(reply);
        const isExpectedSuccess = match !== null
            && Number(match[1]) === this.pendingNumber;

        if (!isOutOfRange && !isExpectedSuccess) {
            return false;
        }

        this._clearPendingTimer();
        if (isExpectedSuccess) {
            this.lowerBound = this.pendingNumber;
        } else {
            this.upperBound = this.pendingNumber;
        }

        if (this.upperBound - this.lowerBound <= 1) {
            this.results[this.kind] = this.lowerBound;
            if (this.kind === 'track') {
                this._startKind('folder');
            } else {
                const result = {
                    numTracks: this.results.track,
                    numFolders: this.results.folder
                };
                this.running = false;
                this.kind = null;
                this.pendingNumber = null;
                this.onComplete(result);
            }
            return true;
        }

        this._probeMidpoint();
        return true;
    }

    _startKind(kind) {
        this.kind = kind;
        this.lowerBound = 0;
        this.upperBound = this.maximum + 1;
        this._probeMidpoint();
    }

    _probeMidpoint() {
        this.pendingNumber = Math.floor(
            (this.lowerBound + this.upperBound) / 2
        );
        this.attempts = 0;
        this._sendPendingProbe();
    }

    _sendPendingProbe() {
        this.attempts += 1;
        if (!this.sendProbe(this.kind, this.pendingNumber)) {
            this._fail('no controller has been discovered');
            return;
        }

        this.timer = this.setTimer(() => {
            this.timer = null;
            if (!this.running) {
                return;
            }
            if (this.attempts < this.maxAttempts) {
                this._sendPendingProbe();
            } else {
                this._fail(
                    `${this.kind} capacity probe timed out at `
                    + `${this.pendingNumber}`
                );
            }
        }, this.timeoutMs);
        this.timer?.unref?.();
    }

    _clearPendingTimer() {
        if (this.timer !== null) {
            this.clearTimer(this.timer);
            this.timer = null;
        }
    }

    _fail(message) {
        this._clearPendingTimer();
        this.running = false;
        this.kind = null;
        this.pendingNumber = null;
        this.onFailure(new Error(message));
    }
}

module.exports = {
    CapacityDiscovery,
    MAX_DISCOVERABLE_CAPACITY
};
