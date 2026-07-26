const express = require('express');
const path = require('path');
const http = require('http');
const os = require('os');
const fs = require('fs');
const { Bonjour } = require('bonjour-service');
const { Server: SocketServer } = require('socket.io');
const { Server: OSCServer } = require('node-osc');
const {
    colorToBinary,
    labelToBinary,
    parseIndexedToken,
    parseOSCMessage,
    validateOSCCommand
} = require('./lib/osc-protocol');
const {
    OSCControllerTransport
} = require('./lib/osc-controller-transport');
const {
    OLED_DISPLAY_COUNT,
    OLED_LINE_COUNT,
    buildRemoteCommands,
    mapOSCCommandToRemote,
    parseOLEDReply
} = require('./lib/opus-udp-protocol');
const {
    OpusUDPTransport
} = require('./lib/opus-udp-transport');
const {
    buildNameInventoryRequests
} = require('./lib/name-inventory');
const {
    nextLocalMemoryLevel
} = require('./lib/memory-level-state');
const {
    CapacityDiscovery
} = require('./lib/capacity-discovery');

const app = express();
const httpServer = http.createServer(app);
const io = new SocketServer(httpServer);

app.use(express.json({ limit: '8kb' }));

const confPath = path.join(__dirname, 'conf.json');
const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));

function readPort(environmentName, configName, fallback) {
    const candidate = process.env[environmentName] ?? conf[configName] ?? fallback;
    const port = Number(candidate);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${environmentName}/${configName} must be a valid port`);
    }

    return port;
}

function readOptionalHost(environmentName, configName) {
    const candidate = process.env[environmentName] ?? conf[configName];

    if (candidate === undefined || candidate === null) {
        return null;
    }

    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
        throw new Error(`${environmentName}/${configName} must be a non-empty host`);
    }

    return candidate.trim();
}

const configuredOscTargetHost = readOptionalHost('OPUS_OSC_HOST', 'oscHost');
const oscTargetPort = readPort('OPUS_OSC_SEND_PORT', 'oscSendPort', 8000);
const oscListenPort = readPort('OPUS_OSC_LISTEN_PORT', 'oscListenPort', 9000);
const opusUdpPort = readPort('OPUS_UDP_PORT', 'udpPort', 5005);
const httpPort = readPort('ORGANUI_HTTP_PORT', 'httpPort', 3000);

const oscServer = new OSCServer(oscListenPort, '0.0.0.0');
const bonjour = new Bonjour();
const remoteActionCommands = {
    back: '/OPTICS/special2014',
    next: '/OPTICS/special2015'
};
const remoteActionHoldDurationMs = 120;
const nameInventoryQueryIntervalMs = 50;
const nameInventoryRefreshIntervalMs = 5 * 60 * 1000;
const pendingMomentaryReleases = new Map();
let capacityDiscovery = null;
let capacityDiscoveryAttempted = false;
const feedbackFamilies = new Set([
    'RP',
    'TrackDup',
    'faders',
    'keyboard',
    'Stops',
    'Tabs',
    'UserDef',
    'OPTICS',
    'vibrate'
]);

const data = {
    trackNum: 'Track Name',
    trackTime: '-- : --',
    uptime: 'Not Connected',
    magicTunerStatus: { active: 0, currentNote: 'Off', pattern: 'No Pattern' },
    sostActive: 0,
    trackLocked: 0,
    trackNames: {},
    udpTrackNames: {},
    stops: Array.from(
        { length: 253 },
        (_, index) => ({ number: index + 1, name: '', active: 0 })
    ),
    triggerStatus: Array.from({ length: 253 }, () => 0),
    tabLabels: {},
    divLabels: Array.from({ length: 36 }, () => 'Unlabeled Div'),
    presetStatus: Array.from({ length: 99 }, () => 0),
    pitchStatus: Array.from({ length: 11 }, () => 0),
    expressions: Array.from({ length: 32 }, () => ({ name: '', value: 0 })),
    keyboardStatus: Array.from({ length: 255 }, () => 0),
    folderTrackName: '',
    namingCurrentFolder: 'Current Folder',
    trackDupSrc: '[source]',
    trackDupTgt: '[target]',
    userVars: Array.from({ length: 10 }, () => ({ name: '', value: '' })),
    userVarPage: '',
    organistNumber: '',
    memoryLevel: '',
    localMemoryLevel: '',
    trackMinutes: '',
    trackSeconds: '',
    transposer: '',
    cyclesSinceKeypress: '',
    uptimeSeconds: '',
    oscSpecialStatus: {},
    vibrateFeedback: { count: 0, lastReceived: '' },
    remoteReply: '',
    remoteTarget: 'Discovering controller',
    queriedFolderNames: {},
    nameInventoryStatus: {
        phase: 'idle',
        sent: 0,
        total: conf.numTracks + conf.numFolders,
        knownTracks: 0,
        knownFolders: 0,
        lastCompletedAt: '',
        message: 'Waiting to read names from the console'
    },
    oledDisplays: Array.from(
        { length: OLED_DISPLAY_COUNT },
        () => Array.from({ length: OLED_LINE_COUNT }, () => '')
    )
};
// Preserve the original primary-display event/state for existing pages and
// third-party Socket.IO clients.
data.oledLines = data.oledDisplays[0];

for (let index = 1; index <= 10; index += 1) {
    data.trackNames[index] = '';
}

const oscTransport = new OSCControllerTransport({
    // A configured address is deliberately not installed here: both SSDP and
    // OSC discovery get the first opportunity to identify the controller.
    port: oscTargetPort,
    onControllerDiscovered: (host) => {
        console.log(`Discovered OSC controller at ${host}:${oscTargetPort}`);
        updateRemoteTarget();
        if (
            !beginCapacityDiscovery()
            &&
            nameInventoryEnabled
            && data.nameInventoryStatus.phase === 'unavailable'
        ) {
            refreshNameInventory();
        }
    },
    onControllerLost: (host) => {
        console.warn(
            `OSC controller at ${host} stopped responding; resuming discovery`
        );
        updateScalar('uptime', 'uptime', 'Not Connected');
        updateRemoteTarget();
        if (opusUdpTransport.discoveredHost === null) {
            resetCapacityDiscovery();
            beginCapacityDiscovery();
        }
    },
    onError: (error) => {
        console.error('OSC transport error:', error);
    }
});

const remoteLimits = {
    numFolders: conf.numFolders,
    numLevels: conf.numLevels,
    numTracks: conf.numTracks
};

let nameInventoryEnabled = false;
let nameInventoryTimer = null;
let nameInventoryQueue = [];

const opusUdpTransport = new OpusUDPTransport({
    port: opusUdpPort,
    fallbackHost: configuredOscTargetHost,
    fallbackHostProvider: () => oscTransport.targetHost,
    onControllerDiscovered: (host) => {
        console.log(`Discovered Opus-Two UDP controller at ${host}:${opusUdpPort}`);
        updateScalar('remoteTarget', 'remoteTarget', `${host} (SSDP)`);
        if (
            !beginCapacityDiscovery()
            &&
            nameInventoryEnabled
            && data.nameInventoryStatus.phase === 'unavailable'
        ) {
            refreshNameInventory();
        }
    },
    onControllerLost: (host) => {
        console.warn(
            `Opus-Two UDP controller at ${host} stopped announcing; using discovery fallbacks`
        );
        updateRemoteTarget();
        resetCapacityDiscovery();
        beginCapacityDiscovery();
    },
    onReply: handleRemoteReply,
    onError: (error) => {
        console.error('Opus-Two UDP transport error:', error);
    }
});

capacityDiscovery = new CapacityDiscovery({
    sendProbe: (kind, number) => {
        if (kind === 'track') {
            return opusUdpTransport.send(`Query Get Track Name ${number}`);
        }
        if (kind === 'folder') {
            return opusUdpTransport.send(`CA Get Folder Name ${number}`);
        }
        return opusUdpTransport.send(`CA Goto Local Level ${number}`);
    },
    restoreLevel: () => data.localMemoryLevel || data.memoryLevel || 1,
    onComplete: applyDiscoveredCapacity,
    onFailure: handleCapacityDiscoveryFailure
});
setImmediate(updateRemoteTarget);

function beginCapacityDiscovery() {
    if (
        capacityDiscovery === null
        || capacityDiscovery.running
        || capacityDiscoveryAttempted
        || opusUdpTransport.targetHost === null
    ) {
        return false;
    }

    capacityDiscoveryAttempted = true;
    updateNameInventoryStatus({
        phase: 'discovering',
        sent: 0,
        message: 'Discovering track, folder, and level capacity'
    });
    return capacityDiscovery.start();
}

function resetCapacityDiscovery() {
    capacityDiscovery?.cancel();
    capacityDiscoveryAttempted = false;
}

function pruneInventoryAbove(names, maximum) {
    let changed = false;
    for (const key of Object.keys(names)) {
        if (Number(key) > maximum) {
            delete names[key];
            changed = true;
        }
    }
    return changed;
}

function applyRuntimeCapacity(limits) {
    remoteLimits.numTracks = limits.numTracks;
    remoteLimits.numFolders = limits.numFolders;
    remoteLimits.numLevels = limits.numLevels;

    const trackNamesChanged = pruneInventoryAbove(
        data.udpTrackNames,
        limits.numTracks
    );
    pruneInventoryAbove(data.trackNames, limits.numTracks);
    const folderNamesChanged = pruneInventoryAbove(
        data.queriedFolderNames,
        limits.numFolders
    );

    data.nameInventoryStatus.total = limits.numTracks + limits.numFolders;
    emitState('numTracks', limits.numTracks);
    emitState('numFolders', limits.numFolders);
    emitState('numLevels', limits.numLevels);
    if (trackNamesChanged) {
        emitState('trackNames', data.trackNames);
        emitState('udpTrackNames', data.udpTrackNames);
    }
    if (folderNamesChanged) {
        emitState('queriedFolderNames', data.queriedFolderNames);
    }
}

function applyDiscoveredCapacity(limits) {
    if (
        !Number.isInteger(limits.numTracks)
        || limits.numTracks < 1
        || !Number.isInteger(limits.numFolders)
        || limits.numFolders < 1
        || !Number.isInteger(limits.numLevels)
        || limits.numLevels < 1
    ) {
        handleCapacityDiscoveryFailure(
            new Error('controller reported an empty capacity range')
        );
        return;
    }

    applyRuntimeCapacity(limits);
    console.log(
        `Discovered controller capacity: ${limits.numTracks} tracks, `
        + `${limits.numFolders} folders, and ${limits.numLevels} levels`
    );
    updateNameInventoryStatus({
        phase: 'idle',
        sent: 0,
        total: limits.numTracks + limits.numFolders,
        message: `Discovered ${limits.numTracks} tracks and `
            + `${limits.numFolders} folders; ${limits.numLevels} levels`
    });

    if (nameInventoryEnabled) {
        refreshNameInventory();
    }
}

function handleCapacityDiscoveryFailure(error) {
    console.warn(
        `Capacity discovery failed; using configured limits: ${error.message}`
    );
    applyRuntimeCapacity({
        numTracks: conf.numTracks,
        numFolders: conf.numFolders,
        numLevels: conf.numLevels
    });
    updateNameInventoryStatus({
        phase: 'idle',
        sent: 0,
        total: conf.numTracks + conf.numFolders,
        message: 'Using configured track, folder, and level capacity'
    });

    if (nameInventoryEnabled) {
        refreshNameInventory();
    }
}

// Coalesce repeated refresh updates into at most one Socket.IO event of each
// type per event-loop turn. Event names and payload shapes remain unchanged.
const pendingStateEmits = new Map();
let stateEmitScheduled = false;

function emitState(eventName, value) {
    pendingStateEmits.set(eventName, value);

    if (stateEmitScheduled) {
        return;
    }

    stateEmitScheduled = true;
    setImmediate(() => {
        stateEmitScheduled = false;

        for (const [pendingEventName, pendingValue] of pendingStateEmits) {
            io.emit(pendingEventName, pendingValue);
        }

        pendingStateEmits.clear();
    });
}

function updateScalar(eventName, key, value) {
    if (value === null || value === undefined || data[key] === value) {
        return;
    }

    data[key] = value;
    emitState(eventName, data[key]);
}

function updateObjectField(eventName, object, key, value, payload = object) {
    if (value === null || value === undefined || object[key] === value) {
        return;
    }

    object[key] = value;
    emitState(eventName, payload);
}

function updateArrayValue(eventName, values, index, value) {
    if (value === null || value === undefined || values[index] === value) {
        return;
    }

    values[index] = value;
    emitState(eventName, values);
}

function updateRemoteTarget() {
    const host = opusUdpTransport.targetHost;
    const source = opusUdpTransport.targetSource;
    const label = host === null
        ? 'Discovering controller'
        : `${host} (${source})`;
    updateScalar('remoteTarget', 'remoteTarget', label);
}

function sendRawOSCCommand(cmd, state) {
    const validation = validateOSCCommand({ cmd, state });
    if (!validation.ok) {
        console.warn(`Rejected OSC command ${String(cmd)}: ${validation.error}`);
        return false;
    }

    const preferredHost = opusUdpTransport.targetHost;
    const sent = preferredHost === null
        ? oscTransport.send(cmd, state)
        : oscTransport.sendTo(cmd, state, preferredHost);
    if (!sent) {
        console.warn(`No OSC controller is available for command ${cmd}`);
        return false;
    }

    return true;
}

const oscFallbackPresses = new Set();

function sendUDPRequest(request) {
    if (capacityDiscovery?.running) {
        return {
            ok: false,
            error: 'controller capacity discovery is in progress'
        };
    }

    let commands;
    try {
        commands = buildRemoteCommands(request, remoteLimits);
    } catch (error) {
        return { ok: false, error: error.message };
    }

    for (const command of commands) {
        if (!opusUdpTransport.send(command)) {
            return {
                ok: false,
                error: 'no controller has been discovered'
            };
        }
    }

    if (request.action === 'renameTrack') {
        updateInventoryName('track', Number(request.number), request.name.trim());
        confirmInventoryName('track', Number(request.number));
    } else if (request.action === 'renameFolder') {
        updateInventoryName('folder', Number(request.number), request.name.trim());
        confirmInventoryName('folder', Number(request.number));
    }

    const localMemoryLevel = nextLocalMemoryLevel(
        data.localMemoryLevel,
        data.memoryLevel,
        request,
        remoteLimits.numLevels
    );
    if (localMemoryLevel !== null) {
        updateScalar(
            'localMemoryLevel',
            'localMemoryLevel',
            localMemoryLevel
        );
    }

    updateRemoteTarget();
    return { ok: true, commands };
}

function inventoryKnownCount(names) {
    return Object.values(names).filter(name => typeof name === 'string').length;
}

function updateNameInventoryStatus(values) {
    Object.assign(data.nameInventoryStatus, values, {
        knownTracks: inventoryKnownCount(data.udpTrackNames),
        knownFolders: inventoryKnownCount(data.queriedFolderNames)
    });
    emitState('nameInventoryStatus', { ...data.nameInventoryStatus });
}

function updateInventoryName(kind, number, name) {
    const limit = kind === 'track'
        ? remoteLimits.numTracks
        : remoteLimits.numFolders;
    if (
        !Number.isInteger(number)
        || number < 1
        || number > limit
        || typeof name !== 'string'
    ) {
        return;
    }

    if (kind === 'track') {
        const changed = data.udpTrackNames[number] !== name;
        data.trackNames[number] = name;
        data.udpTrackNames[number] = name;
        if (changed) {
            emitState('trackNames', data.trackNames);
            emitState('udpTrackNames', data.udpTrackNames);
        }
    } else {
        const changed = data.queriedFolderNames[number] !== name;
        data.queriedFolderNames[number] = name;
        if (changed) {
            emitState('queriedFolderNames', data.queriedFolderNames);
        }
    }

    updateNameInventoryStatus({});
}

function confirmInventoryName(kind, number) {
    const confirmationTimer = setTimeout(() => {
        sendUDPRequest({
            action: kind === 'track' ? 'getTrackName' : 'getFolderName',
            number
        });
    }, 250);
    confirmationTimer.unref();
}

function finishNameInventoryRefresh(values) {
    if (nameInventoryTimer !== null) {
        clearInterval(nameInventoryTimer);
        nameInventoryTimer = null;
    }
    nameInventoryQueue = [];
    updateNameInventoryStatus(values);
}

function refreshNameInventory() {
    nameInventoryEnabled = true;
    if (capacityDiscovery?.running) {
        return {
            ok: true,
            started: true,
            discovering: true,
            status: { ...data.nameInventoryStatus }
        };
    }
    if (beginCapacityDiscovery()) {
        return {
            ok: true,
            started: true,
            discovering: true,
            status: { ...data.nameInventoryStatus }
        };
    }
    if (nameInventoryTimer !== null) {
        return {
            ok: true,
            started: false,
            status: { ...data.nameInventoryStatus }
        };
    }

    nameInventoryQueue = buildNameInventoryRequests(
        remoteLimits.numTracks,
        remoteLimits.numFolders
    );
    updateNameInventoryStatus({
        phase: 'refreshing',
        sent: 0,
        total: nameInventoryQueue.length,
        message: 'Reading track and folder names from the console'
    });

    nameInventoryTimer = setInterval(() => {
        const request = nameInventoryQueue.shift();
        if (request === undefined) {
            finishNameInventoryRefresh({
                phase: 'current',
                sent: data.nameInventoryStatus.total,
                lastCompletedAt: new Date().toISOString(),
                message: 'Console name refresh completed'
            });
            return;
        }

        const result = sendUDPRequest(request);
        if (!result.ok) {
            finishNameInventoryRefresh({
                phase: 'unavailable',
                message: 'Waiting for a console connection'
            });
            return;
        }

        const sent = data.nameInventoryStatus.sent + 1;
        data.nameInventoryStatus.sent = sent;
        if (sent % 10 === 0 || nameInventoryQueue.length === 0) {
            updateNameInventoryStatus({ sent });
        }
    }, nameInventoryQueryIntervalMs);
    nameInventoryTimer.unref();

    return {
        ok: true,
        started: true,
        status: { ...data.nameInventoryStatus }
    };
}

function sendOSCCommand(cmd, state) {
    const validation = validateOSCCommand({ cmd, state });
    if (!validation.ok) {
        console.warn(`Rejected OSC command ${String(cmd)}: ${validation.error}`);
        return false;
    }

    const mapping = mapOSCCommandToRemote(validation.value);
    if (mapping === null) {
        return sendRawOSCCommand(cmd, state);
    }

    if (state === 0 && oscFallbackPresses.has(cmd)) {
        oscFallbackPresses.delete(cmd);
        return sendRawOSCCommand(cmd, state);
    }

    for (const request of mapping.requests) {
        const result = sendUDPRequest(request);
        if (!result.ok) {
            // Preserve control if discovery has not completed yet. The release
            // is remembered so momentary OSC controls cannot remain pressed.
            if (state !== 0 && sendRawOSCCommand(cmd, state)) {
                oscFallbackPresses.add(cmd);
                return true;
            }
            return false;
        }
    }
    return true;
}

function handleRemoteReply(reply, rinfo) {
    if (typeof reply !== 'string') {
        return;
    }

    updateScalar('remoteReply', 'remoteReply', reply);
    capacityDiscovery?.handleReply(reply);
    if (netAddressIsUseful(rinfo?.address)) {
        updateScalar(
            'remoteTarget',
            'remoteTarget',
            `${rinfo.address} (${opusUdpTransport.targetSource ?? 'udp'})`
        );
    }

    const track = /^Tk(\d{3})(.*)$/u.exec(reply);
    if (track) {
        const number = Number(track[1]);
        const name = track[2].trim();
        updateInventoryName('track', number, name);
        return;
    }

    const folder = /^Fldr(\d{3})(.*)$/u.exec(reply);
    if (folder) {
        const number = Number(folder[1]);
        updateInventoryName('folder', number, folder[2].trim());
        return;
    }

    const oled = parseOLEDReply(reply);
    if (oled) {
        const display = data.oledDisplays[oled.display - 1];
        display[oled.line - 1] = oled.text;
        emitState('oledDisplays', data.oledDisplays);
        if (oled.display === 1) {
            emitState('oledLines', data.oledLines);
        }
    }
}

function netAddressIsUseful(address) {
    return typeof address === 'string' && address.length > 0;
}

function sendMomentaryOSCCommand(cmd, holdDurationMs = remoteActionHoldDurationMs) {
    if (!sendOSCCommand(cmd, 1)) {
        return false;
    }

    const existingRelease = pendingMomentaryReleases.get(cmd);
    if (existingRelease) {
        clearTimeout(existingRelease);
    }

    const releaseTimeout = setTimeout(() => {
        pendingMomentaryReleases.delete(cmd);
        sendOSCCommand(cmd, 0);
    }, holdDurationMs);
    releaseTimeout.unref();

    pendingMomentaryReleases.set(cmd, releaseTimeout);
    return true;
}

function triggerRemoteAction(action) {
    const command = remoteActionCommands[action];
    return command !== undefined && sendMomentaryOSCCommand(command);
}

function sendSubscribeMessage() {
    oscTransport.refresh();
}

function isText(value) {
    return typeof value === 'string';
}

function handleRPMessage(token, value) {
    if (!isText(value)) {
        return;
    }

    if (token === 'label328') {
        updateScalar('organistNumber', 'organistNumber', value);
    } else if (token === 'label329') {
        updateScalar('memoryLevel', 'memoryLevel', value);
    } else if (token === 'label330') {
        updateScalar('trackMinutes', 'trackMinutes', value);
    } else if (token === 'label331') {
        updateScalar('trackSeconds', 'trackSeconds', value);
    } else if (token === 'label332') {
        updateScalar('trackTime', 'trackTime', value);
    } else if (token === 'label350') {
        updateScalar('trackLocked', 'trackLocked', labelToBinary(value));
    } else if (token === 'label340') {
        updateScalar('transposer', 'transposer', value);
    }
}

function handleTrackDupMessage(token, value) {
    if (!isText(value)) {
        return;
    }

    if (token === 'SrcTrk1') {
        updateScalar('trackDupSrc', 'trackDupSrc', value);
    } else if (token === 'TgtTrk1') {
        updateScalar('trackDupTgt', 'trackDupTgt', value);
    }
}

function handleFaderMessage(token, value) {
    const expressionNumber = parseIndexedToken(token, 'expr', 1, 32);
    if (expressionNumber === null || !isText(value)) {
        return;
    }

    const expression = data.expressions[expressionNumber - 1];
    updateObjectField('expressions', expression, 'name', value, data.expressions);
}

function handleKeyboardMessage(parts, value) {
    const keyNumber = parseIndexedToken(parts[1], 'key', 1, 255);
    if (keyNumber === null || parts.length !== 3 || parts[2] !== 'color') {
        return;
    }

    const active = colorToBinary(value, ['green'], ['purple', 'brown']);
    updateArrayValue('keyboardStatus', data.keyboardStatus, keyNumber - 1, active);
}

function handleStopsMessage(parts, value) {
    const token = parts[1];

    if (token === 'label300' && isText(value)) {
        updateScalar('uptime', 'uptime', value);
        return;
    }

    if (token === 'label301' && isText(value)) {
        updateObjectField('magicTunerStatus', data.magicTunerStatus, 'currentNote', value);
        return;
    }

    if (token === 'label305' && isText(value)) {
        updateScalar('trackNum', 'trackNum', value);
        return;
    }

    if (token === 'label306' && isText(value)) {
        updateScalar('namingCurrentFolder', 'namingCurrentFolder', value);
        return;
    }

    if (token === 'label307' && isText(value)) {
        updateScalar('folderTrackName', 'folderTrackName', value);
        return;
    }

    if (token === 'LabelSpecial4' && isText(value)) {
        updateObjectField('magicTunerStatus', data.magicTunerStatus, 'pattern', value);
        return;
    }

    const labelNumber = parseIndexedToken(token, 'label', 1, 253);
    if (labelNumber !== null && isText(value)) {
        const stop = data.stops[labelNumber - 1];
        updateObjectField('stops', stop, 'name', value, data.stops);
        return;
    }

    const buttonNumber = parseIndexedToken(token, 'push', 1, 253);
    if (
        buttonNumber !== null
        && parts.length === 3
        && parts[2] === 'color'
    ) {
        const active = colorToBinary(value, ['green'], ['purple']);
        const stop = data.stops[buttonNumber - 1];
        updateObjectField('stops', stop, 'active', active, data.stops);
        return;
    }

    const triggerNumber = parseIndexedToken(token, 'trigger', 1, 253);
    if (
        triggerNumber !== null
        && parts.length === 3
        && parts[2] === 'color'
    ) {
        const active = colorToBinary(value, ['green'], ['purple']);
        updateArrayValue(
            'triggerStatus',
            data.triggerStatus,
            triggerNumber - 1,
            active
        );
        return;
    }

    const divisionNumber = parseIndexedToken(token, 'DivLabel', 1, 36);
    if (divisionNumber !== null && isText(value)) {
        const label = value.length === 0 ? 'Unlabeled Div' : value;
        updateArrayValue('divLabels', data.divLabels, divisionNumber - 1, label);
    }
}

function handleTabsMessage(token, value) {
    const labelNumber = parseIndexedToken(token, 'Label', 1, 99);
    if (
        labelNumber === null
        || !isText(value)
        || data.tabLabels[labelNumber] === value
    ) {
        return;
    }

    data.tabLabels[labelNumber] = value;
    emitState('tabLabels', data.tabLabels);
}

function handleUserDefMessage(token, value) {
    const labelNumber = parseIndexedToken(token, 'label', 1, 992);

    if (labelNumber === 991 && isText(value)) {
        updateScalar(
            'cyclesSinceKeypress',
            'cyclesSinceKeypress',
            value
        );
        return;
    }

    if (labelNumber === 992 && isText(value)) {
        updateScalar('uptimeSeconds', 'uptimeSeconds', value);
        return;
    }

    if (
        labelNumber !== null
        && labelNumber >= 981
        && labelNumber <= 990
        && isText(value)
    ) {
        const trackNumber = labelNumber - 980;
        if (
            data.trackNames[trackNumber] !== value
            || data.udpTrackNames[trackNumber] !== value
        ) {
            updateInventoryName('track', trackNumber, value);
        }
        return;
    }

    if (token === 'page1' && isText(value)) {
        updateScalar('userVarPage', 'userVarPage', value);
        return;
    }

    if (labelNumber !== null && labelNumber <= 10 && isText(value)) {
        updateObjectField(
            'userVars',
            data.userVars[labelNumber - 1],
            'name',
            value,
            data.userVars
        );
        return;
    }

    const valueNumber = parseIndexedToken(token, 'value', 1, 10);
    if (valueNumber !== null && isText(value)) {
        updateObjectField(
            'userVars',
            data.userVars[valueNumber - 1],
            'value',
            value,
            data.userVars
        );
    }
}

function handleOPTICSMessage(parts, value) {
    const itemNumber = parseIndexedToken(parts[1], 'special', 0, 65535);
    if (
        itemNumber === null
        || parts.length !== 3
        || parts[2] !== 'color'
    ) {
        return;
    }

    if (!isText(value)) {
        return;
    }

    if (data.oscSpecialStatus[itemNumber] !== value) {
        data.oscSpecialStatus[itemNumber] = value;
        emitState('oscSpecialStatus', data.oscSpecialStatus);
    }

    const active = colorToBinary(value, ['red'], ['blue', 'gray']);
    if (active === null) {
        return;
    }

    if (itemNumber === 1898) {
        updateArrayValue('pitchStatus', data.pitchStatus, 10, active);
    } else if (itemNumber === 2010) {
        updateScalar('sostActive', 'sostActive', active);
    } else if (itemNumber === 2012) {
        updateObjectField('magicTunerStatus', data.magicTunerStatus, 'active', active);
    } else if (itemNumber >= 1900 && itemNumber <= 1998) {
        updateArrayValue(
            'presetStatus',
            data.presetStatus,
            itemNumber - 1900,
            active
        );
    } else if (itemNumber >= 2020 && itemNumber <= 2029) {
        updateArrayValue(
            'pitchStatus',
            data.pitchStatus,
            itemNumber - 2020,
            active
        );
    }
}

function handleVibrateMessage() {
    data.vibrateFeedback = {
        count: data.vibrateFeedback.count + 1,
        lastReceived: new Date().toISOString()
    };
    emitState('vibrateFeedback', data.vibrateFeedback);
}

function handleOSCMessage(message, rinfo) {
    const parsed = parseOSCMessage(message);
    if (parsed === null) {
        return;
    }

    const { parts, value } = parsed;
    if (
        !feedbackFamilies.has(parts[0])
        || !oscTransport.observeFeedback(rinfo?.address)
    ) {
        return;
    }

    try {
        if (parts[0] === 'RP') {
            handleRPMessage(parts[1], value);
        } else if (parts[0] === 'TrackDup') {
            handleTrackDupMessage(parts[1], value);
        } else if (parts[0] === 'faders') {
            handleFaderMessage(parts[1], value);
        } else if (parts[0] === 'keyboard') {
            handleKeyboardMessage(parts, value);
        } else if (parts[0] === 'Stops') {
            handleStopsMessage(parts, value);
        } else if (parts[0] === 'Tabs') {
            handleTabsMessage(parts[1], value);
        } else if (parts[0] === 'UserDef') {
            handleUserDefMessage(parts[1], value);
        } else if (parts[0] === 'OPTICS') {
            handleOPTICSMessage(parts, value);
        } else if (parts[0] === 'vibrate') {
            handleVibrateMessage();
        }
    } catch (error) {
        // A malformed or unexpected UDP packet must not terminate instrument
        // control for every connected browser.
        console.error(`Failed to process OSC feedback ${parsed.address}:`, error);
    }
}

oscServer.on('message', handleOSCMessage);

oscServer.on('error', (error) => {
    console.error('OSC server error:', error);

    if (error && (error.code === 'EADDRINUSE' || error.code === 'EACCES')) {
        shutdown(1);
    }
});

io.on('connection', (socket) => {
    sendSubscribeMessage();

    const initialState = {
        trackNum: data.trackNum,
        trackTime: data.trackTime,
        trackLocked: data.trackLocked,
        uptime: data.uptime,
        magicTunerStatus: data.magicTunerStatus,
        trackNames: data.trackNames,
        udpTrackNames: data.udpTrackNames,
        stops: data.stops,
        triggerStatus: data.triggerStatus,
        tabLabels: data.tabLabels,
        sostActive: data.sostActive,
        divLabels: data.divLabels,
        presetStatus: data.presetStatus,
        pitchStatus: data.pitchStatus,
        expressions: data.expressions,
        keyboardStatus: data.keyboardStatus,
        folderTrackName: data.folderTrackName,
        namingCurrentFolder: data.namingCurrentFolder,
        trackDupSrc: data.trackDupSrc,
        trackDupTgt: data.trackDupTgt,
        userVars: data.userVars,
        userVarPage: data.userVarPage,
        organistNumber: data.organistNumber,
        memoryLevel: data.memoryLevel,
        localMemoryLevel: data.localMemoryLevel,
        trackMinutes: data.trackMinutes,
        trackSeconds: data.trackSeconds,
        transposer: data.transposer,
        cyclesSinceKeypress: data.cyclesSinceKeypress,
        uptimeSeconds: data.uptimeSeconds,
        oscSpecialStatus: data.oscSpecialStatus,
        vibrateFeedback: data.vibrateFeedback,
        remoteReply: data.remoteReply,
        remoteTarget: data.remoteTarget,
        queriedFolderNames: data.queriedFolderNames,
        nameInventoryStatus: data.nameInventoryStatus,
        oledDisplays: data.oledDisplays,
        oledLines: data.oledLines,
        numTracks: remoteLimits.numTracks,
        numFolders: remoteLimits.numFolders,
        numLevels: remoteLimits.numLevels,
        siteName: conf.siteName
    };

    for (const [eventName, value] of Object.entries(initialState)) {
        socket.emit(eventName, value);
    }

    socket.on('sendOSCcmd', (command) => {
        if (!command || typeof command !== 'object') {
            console.warn(`Rejected malformed OSC command from socket ${socket.id}`);
            return;
        }

        sendOSCCommand(command.cmd, command.state);
    });

    socket.on('sendUDPcmd', (command, acknowledge = () => {}) => {
        const result = sendUDPRequest(command);
        if (!result.ok) {
            console.warn(
                `Rejected UDP command from socket ${socket.id}: ${result.error}`
            );
        }
        if (typeof acknowledge === 'function') {
            acknowledge(result);
        }
    });

    socket.on('refreshNameInventory', (acknowledge = () => {}) => {
        const result = refreshNameInventory();
        if (typeof acknowledge === 'function') {
            acknowledge(result);
        }
    });

    socket.on('moveFader', (command) => {
        if (!command || typeof command !== 'object') {
            return;
        }

        const id = Number(command.id);
        const value = Number(command.value);
        if (
            !Number.isInteger(id)
            || id < 0
            || id >= data.expressions.length
            || !Number.isFinite(value)
            || value < 0
            || value > 1
        ) {
            console.warn(`Rejected malformed fader command from socket ${socket.id}`);
            return;
        }

        if (data.expressions[id].value === value) {
            return;
        }

        if (!sendOSCCommand(`/faders/fader${id + 1}`, value)) {
            return;
        }

        data.expressions[id].value = value;
        socket.broadcast.emit('expressions', data.expressions);
    });
});

app.post('/api/osc', (req, res) => {
    const validation = validateOSCCommand(req.body);
    if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
    }

    if (!sendOSCCommand(validation.value.cmd, validation.value.state)) {
        return res.status(503).json({
            error: 'no OSC controller has been discovered'
        });
    }

    return res.status(202).json({ ok: true });
});

app.post('/api/remote-action', (req, res) => {
    const rawAction = req.body?.action;
    const action = typeof rawAction === 'string'
        ? rawAction.trim().toLowerCase()
        : '';

    if (action.length === 0) {
        return res.status(400).json({ error: 'action must be a non-empty string' });
    }

    if (!Object.hasOwn(remoteActionCommands, action)) {
        return res.status(400).json({ error: 'unsupported action' });
    }

    if (!triggerRemoteAction(action)) {
        return res.status(503).json({
            error: 'no OSC controller has been discovered'
        });
    }

    return res.status(202).json({ ok: true });
});

app.post('/api/udp', (req, res) => {
    const result = sendUDPRequest(req.body);
    if (!result.ok) {
        const status = result.error === 'no controller has been discovered'
            ? 503
            : 400;
        return res.status(status).json({ error: result.error });
    }

    return res.status(202).json({
        ok: true,
        commands: result.commands
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'landing.html'));
});

app.get('/tuner', (req, res) => {
    res.sendFile(path.join(__dirname, 'tuner.html'));
});

app.get('/organist', (req, res) => {
    res.sendFile(path.join(__dirname, 'organist.html'));
});

app.get('/advanced', (req, res) => {
    res.sendFile(path.join(__dirname, 'advanced.html'));
});

app.get('/sequencer', (req, res) => {
    res.sendFile(path.join(__dirname, 'sequencer.html'));
});

app.use('/static', express.static(path.join(__dirname, 'static')));

oscServer.on('listening', () => {
    console.log(`OSC Server is listening on 0.0.0.0:${oscListenPort}`);
});

httpServer.on('error', (error) => {
    console.error('HTTP server error:', error);
    shutdown(1);
});

httpServer.listen(httpPort, () => {
    const serviceName = typeof conf.siteName === 'string' && conf.siteName.trim()
        ? conf.siteName.trim()
        : os.hostname();

    const service = bonjour.publish({
        name: serviceName,
        type: 'organremote',
        protocol: 'tcp',
        port: httpPort
    });
    service.on('error', (error) => {
        console.error('Bonjour service error:', error);
    });

    console.log(`HTTP Server is listening on *:${httpPort}`);
    if (configuredOscTargetHost === null) {
        console.log(
            `Discovering controllers with SSDP and OSC on ports ${opusUdpPort}/${oscTargetPort}`
        );
    } else {
        console.log(
            `Controller address fallback is ${configuredOscTargetHost}`
        );
    }
    console.log(`Bonjour service published as "${serviceName}" on _organremote._tcp`);
    beginCapacityDiscovery();
});

sendSubscribeMessage();
const subscribeInterval = setInterval(sendSubscribeMessage, 30 * 60 * 1000);
subscribeInterval.unref();
const nameInventoryRefreshInterval = setInterval(() => {
    if (nameInventoryEnabled) {
        refreshNameInventory();
    }
}, nameInventoryRefreshIntervalMs);
nameInventoryRefreshInterval.unref();

let shuttingDown = false;

function shutdown(exitCode = 0) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    clearInterval(subscribeInterval);
    clearInterval(nameInventoryRefreshInterval);
    if (nameInventoryTimer !== null) {
        clearInterval(nameInventoryTimer);
        nameInventoryTimer = null;
    }
    capacityDiscovery?.cancel();

    for (const [command, releaseTimeout] of pendingMomentaryReleases) {
        clearTimeout(releaseTimeout);
        sendOSCCommand(command, 0);
    }
    pendingMomentaryReleases.clear();

    io.close();

    try {
        bonjour.destroy();
    } catch (error) {
        console.error('Failed to stop Bonjour service:', error);
    }

    try {
        oscTransport.close();
    } catch (error) {
        console.error('Failed to close OSC transport:', error);
    }

    try {
        opusUdpTransport.close();
    } catch (error) {
        console.error('Failed to close Opus-Two UDP transport:', error);
    }

    try {
        oscServer.close();
    } catch (error) {
        console.error('Failed to close OSC server:', error);
    }

    httpServer.close(() => {
        process.exit(exitCode);
    });

    setTimeout(() => process.exit(exitCode), 2000).unref();
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));
