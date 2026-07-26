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
const pendingMomentaryReleases = new Map();
const feedbackFamilies = new Set([
    'RP',
    'TrackDup',
    'faders',
    'keyboard',
    'Stops',
    'UserDef',
    'OPTICS'
]);

const data = {
    trackNum: 'Track Name',
    trackTime: '-- : --',
    uptime: 'Not Connected',
    magicTunerStatus: { active: 0, currentNote: 'Off', pattern: 'No Pattern' },
    sostActive: 0,
    trackLocked: 0,
    trackNames: {},
    stops: Array.from(
        { length: 253 },
        (_, index) => ({ number: index + 1, name: '', active: 0 })
    ),
    divLabels: Array.from({ length: 36 }, () => 'Unlabeled Div'),
    presetStatus: Array.from({ length: 12 }, () => 0),
    pitchStatus: Array.from({ length: 11 }, () => 0),
    expressions: Array.from({ length: 32 }, () => ({ name: '', value: 0 })),
    keyboardStatus: Array.from({ length: 25 }, () => 0),
    folderTrackName: '',
    namingCurrentFolder: 'Current Folder',
    trackDupSrc: '[source]',
    trackDupTgt: '[target]',
    userVars: Array.from({ length: 10 }, () => ({ name: '', value: '' })),
    userVarPage: '',
    remoteReply: '',
    remoteTarget: 'Discovering controller',
    queriedFolderNames: {},
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
    },
    onControllerLost: (host) => {
        console.warn(
            `OSC controller at ${host} stopped responding; resuming discovery`
        );
        updateScalar('uptime', 'uptime', 'Not Connected');
        updateRemoteTarget();
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

const opusUdpTransport = new OpusUDPTransport({
    port: opusUdpPort,
    fallbackHost: configuredOscTargetHost,
    fallbackHostProvider: () => oscTransport.targetHost,
    onControllerDiscovered: (host) => {
        console.log(`Discovered Opus-Two UDP controller at ${host}:${opusUdpPort}`);
        updateScalar('remoteTarget', 'remoteTarget', `${host} (SSDP)`);
    },
    onControllerLost: (host) => {
        console.warn(
            `Opus-Two UDP controller at ${host} stopped announcing; using discovery fallbacks`
        );
        updateRemoteTarget();
    },
    onReply: handleRemoteReply,
    onError: (error) => {
        console.error('Opus-Two UDP transport error:', error);
    }
});
setImmediate(updateRemoteTarget);

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

    updateRemoteTarget();
    return { ok: true, commands };
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
        data.trackNames[number] = track[2].trim();
        emitState('trackNames', data.trackNames);
        return;
    }

    const folder = /^Fldr(\d{3})(.*)$/u.exec(reply);
    if (folder) {
        const number = Number(folder[1]);
        data.queriedFolderNames[number] = folder[2].trim();
        emitState('queriedFolderNames', data.queriedFolderNames);
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
    if (token === 'label332' && isText(value)) {
        updateScalar('trackTime', 'trackTime', value);
    } else if (token === 'label350') {
        updateScalar('trackLocked', 'trackLocked', labelToBinary(value));
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
    const keyNumber = parseIndexedToken(parts[1], 'key', 1, 25);
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

    const divisionNumber = parseIndexedToken(token, 'DivLabel', 1, 36);
    if (divisionNumber !== null && isText(value)) {
        const label = value.length === 0 ? 'Unlabeled Div' : value;
        updateArrayValue('divLabels', data.divLabels, divisionNumber - 1, label);
    }
}

function handleUserDefMessage(token, value) {
    const labelNumber = parseIndexedToken(token, 'label', 1, 990);
    if (labelNumber !== null && labelNumber >= 981 && isText(value)) {
        const trackNumber = labelNumber - 980;
        if (data.trackNames[trackNumber] !== value) {
            data.trackNames[trackNumber] = value;
            emitState('trackNames', data.trackNames);
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

    const active = colorToBinary(value, ['red'], ['blue']);
    if (active === null) {
        return;
    }

    if (itemNumber === 1898) {
        updateArrayValue('pitchStatus', data.pitchStatus, 10, active);
    } else if (itemNumber === 2010) {
        updateScalar('sostActive', 'sostActive', active);
    } else if (itemNumber === 2012) {
        updateObjectField('magicTunerStatus', data.magicTunerStatus, 'active', active);
    } else if (itemNumber >= 1900 && itemNumber <= 1911) {
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
        } else if (parts[0] === 'UserDef') {
            handleUserDefMessage(parts[1], value);
        } else if (parts[0] === 'OPTICS') {
            handleOPTICSMessage(parts, value);
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
        stops: data.stops,
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
        remoteReply: data.remoteReply,
        remoteTarget: data.remoteTarget,
        queriedFolderNames: data.queriedFolderNames,
        oledDisplays: data.oledDisplays,
        oledLines: data.oledLines,
        numTracks: conf.numTracks,
        numFolders: conf.numFolders,
        numLevels: conf.numLevels ?? 9999,
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
});

sendSubscribeMessage();
const subscribeInterval = setInterval(sendSubscribeMessage, 30 * 60 * 1000);
subscribeInterval.unref();

let shuttingDown = false;

function shutdown(exitCode = 0) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    clearInterval(subscribeInterval);

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
