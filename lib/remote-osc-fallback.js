'use strict';

const {buildRemoteCommands} = require('./opus-udp-protocol');
const {validateOSCCommand} = require('./osc-protocol');

function buildOSCFallback(request, limits) {
    // Apply the same validation and capacity limits as the UDP endpoint.
    buildRemoteCommands(request, limits);
    const specials = {
        generalCancel: 2000, memoryLevelUp: 2038, memoryLevelDown: 2039,
        trackUp: 2031, trackDown: 2032, toggleTrackLock: 2034,
        recordToggle: 2035, playToggle: 2036
    };
    const action = request.action.trim();
    let cmd;
    let state;
    if (Object.hasOwn(specials, action)) cmd = '/OPTICS/special' + specials[action];
    else if (action === 'playTrack') cmd = '/OPTICS/special' + (2100 + Number(request.number));
    else if (['toggleStop', 'toggleButton'].includes(action)) cmd = '/Stops/push' + Number(request.number);
    else if (['setButton', 'clearButton'].includes(action)) {
        cmd = '/Stops/trigger' + Number(request.number);
        state = action === 'setButton' ? 1 : 0;
    } else return null;

    const validation = validateOSCCommand({cmd, state: state ?? 1});
    if (!validation.ok) throw new RangeError(validation.error);
    const repeated = ['trackUp', 'trackDown', 'memoryLevelUp', 'memoryLevelDown'].includes(action);
    return Array.from({length: repeated ? Number(request.count ?? 1) : 1}, () => ({cmd, state}));
}

// Serialize presses and releases so repeated actions retain their press edges.
class OSCFallbackQueue {
    constructor({send, schedule = setTimeout, cancel = clearTimeout, onError = () => {}}) {
        Object.assign(this, {send, schedule, cancel, onError});
        this.queue = [];
        this.timer = null;
        this.pressed = null;
    }

    enqueue(commands) {
        this.queue.push(...commands);
        if (this.timer === null) this.advance();
    }

    advance() {
        this.timer = null;
        const command = this.queue.shift();
        if (!command) return;
        if (!this.send(command.cmd, command.state ?? 1)) {
            this.queue = [];
            this.onError();
            return;
        }
        this.pressed = command.state === undefined ? command.cmd : null;
        this.timer = this.schedule(() => {
            if (this.pressed !== null && !this.send(this.pressed, 0)) this.onError();
            this.pressed = null;
            this.advance();
        }, 80);
        this.timer?.unref?.();
    }

    close() {
        if (this.timer !== null) this.cancel(this.timer);
        this.timer = null;
        this.queue = [];
        if (this.pressed !== null) this.send(this.pressed, 0);
        this.pressed = null;
    }
}

module.exports = {buildOSCFallback, OSCFallbackQueue};
