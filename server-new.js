const express = require('express');
<<<<<<< HEAD
const path = require('path');
const http = require('http');
=======
const app = express();
const path = require('path');
const http = require('http');
const os = require('os');
const httpServer = http.createServer(app);
const { Server: SocketServer } = require("socket.io");
const io = new SocketServer(httpServer);
const { Client, Server } = require('node-osc');
const { FSDB } = require("file-system-db");
const { Bonjour } = require('bonjour-service');
>>>>>>> 6aa93221009fb83a9a816fc10271ab353e8e8381
const fs = require('fs');
const { Server: SocketServer } = require('socket.io');
const { Client: OSCClient, Server: OSCServer } = require('node-osc');
const {
    colorToBinary,
    labelToBinary,
    parseIndexedToken,
    parseOSCMessage,
    validateOSCCommand
} = require('./lib/osc-protocol');

const app = express();
const httpServer = http.createServer(app);
const io = new SocketServer(httpServer);

<<<<<<< HEAD
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

function readHost(environmentName, configName, fallback) {
    const candidate = process.env[environmentName] ?? conf[configName] ?? fallback;

    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
        throw new Error(`${environmentName}/${configName} must be a non-empty host`);
    }

    return candidate.trim();
}

const oscTargetHost = readHost('OPUS_OSC_HOST', 'oscHost', '192.168.175.12');
const oscTargetPort = readPort('OPUS_OSC_SEND_PORT', 'oscSendPort', 8000);
const oscListenPort = readPort('OPUS_OSC_LISTEN_PORT', 'oscListenPort', 9000);
const httpPort = readPort('ORGANUI_HTTP_PORT', 'httpPort', 3000);

const oscClient = new OSCClient(oscTargetHost, oscTargetPort);
const oscServer = new OSCServer(oscListenPort, '0.0.0.0');

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
    userVarPage: ''
};

for (let index = 1; index <= 10; index += 1) {
    data.trackNames[index] = '';
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

=======
const oscClient = new Client('192.168.50.78', 8000);
var oscServer = new Server(9000, '0.0.0.0');
const db = new FSDB("./database.json", true);
let conf = JSON.parse(fs.readFileSync('conf.json'));
const httpPort = Number(process.env.PORT || 3000);
const bonjour = new Bonjour();
const remoteActionCommands = {
    back: "/OPTICS/special2014",
    next: "/OPTICS/special2015"
};
const remoteActionHoldDurationMs = 120;
const pendingMomentaryReleases = new Map();

var data = {
    trackNum: "Track Name",
    trackTime: "-- : --",
    uptime: "Not Connected",
    magicTunerStatus: {active: 0, currentNote: "Off", pattern: "No Pattern"},
    sostActive: 0,
    trackLocked: 0,
    trackNames: {},
    stops: [],
    divLabels: [],
    presetStatus: [],
    pitchStatus: [],
    expressions: [],
    keyboardStatus: [],
    folderTrackName: "",
    namingCurrentFolder: "Current Folder",
    trackDupSrc: "[source]",
    trackDupTgt: "[target]",
    userVars: [],
    userVarPage: ""
}

// 220 user variables
// presets are buttons 1900-1998

for (let i = 1; i <= 10; i++) {
    data.trackNames[i] = "";
}

for (let i = 1; i <= 253; i++) {
    data.stops.push({name: "", active: 0});
}

for (let i = 1; i <= 36; i++) {
    data.divLabels.push("Unlabeled Div");
}

for (let i = 1; i <= 12; i++) {
    data.presetStatus.push(0);
}

for (let i = 1; i <= 32; i++) {
    data.expressions.push({name: "", value: 0});
}

for (let i = 1; i <= 11; i++) {
    data.pitchStatus.push(0);
}

for (let i = 1; i <= 25; i++) {
    data.keyboardStatus.push(0);
}

for (let i = 1; i <= 10; i++) {
    data.userVars.push({name: "", value: ""});
}

function sendSubscribeMessage() {
    oscClient.send("/OPTICS/special2001", 1, (err) => {
        if (err) console.error(err);
    });
}

>>>>>>> 6aa93221009fb83a9a816fc10271ab353e8e8381
function sendOSCCommand(cmd, state) {
    const validation = validateOSCCommand({ cmd, state });
    if (!validation.ok) {
        console.warn(`Rejected OSC command ${String(cmd)}: ${validation.error}`);
        return false;
    }

    oscClient.send(cmd, state, (error) => {
        if (error) {
            console.error(`Failed to send OSC command ${cmd}:`, error);
        }
    });

    return true;
}

<<<<<<< HEAD
function sendSubscribeMessage() {
    sendOSCCommand('/OPTICS/special2001', 1);
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

function handleOSCMessage(message) {
    const parsed = parseOSCMessage(message);
    if (parsed === null) {
        return;
    }

    const { parts, value } = parsed;

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

        if (!sendOSCCommand(`/faders/fader${id}`, value)) {
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

    sendOSCCommand(validation.value.cmd, validation.value.state);
    return res.status(202).json({ ok: true });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'landing.html'));
});

app.get('/tuner', (req, res) => {
    res.sendFile(path.join(__dirname, 'tuner.html'));
=======
function sendMomentaryOSCCommand(cmd, holdDurationMs = remoteActionHoldDurationMs) {
    sendOSCCommand(cmd, 1);

    const existingRelease = pendingMomentaryReleases.get(cmd);
    if (existingRelease) {
        clearTimeout(existingRelease);
    }

    const releaseTimeout = setTimeout(() => {
        pendingMomentaryReleases.delete(cmd);
        sendOSCCommand(cmd, 0);
    }, holdDurationMs);

    pendingMomentaryReleases.set(cmd, releaseTimeout);
}

function triggerRemoteAction(action) {
    const cmd = remoteActionCommands[action];

    if (!cmd) {
        return false;
    }

    sendMomentaryOSCCommand(cmd);
    return true;
}

sendSubscribeMessage();

setInterval(sendSubscribeMessage, 30 * 60 * 1000);

oscServer.on('message', (msg) => {
    // Parse the message
    let messageParts = msg[0].split('/');
    messageParts.shift();
    let messageValue = msg[1];

    // Figure out what the message is
    if (messageParts[0] == 'RP') {
        if (messageParts[1] == 'label332') {
            if (data.trackTime != messageValue) {
                data.trackTime = messageValue;
                io.emit('trackTime', data.trackTime);
            }
        } else if (messageParts[1] == 'label350') {
            if (data.trackLocked != messageValue) {
                data.trackLocked = messageValue;
                io.emit('trackLocked', data.trackLocked);
            }
        }
    } else if (messageParts[0] == 'TrackDup') {
        if (messageParts[1] == 'SrcTrk1') {
            if (data.trackDupSrc != messageValue) {
                data.trackDupSrc = messageValue;
                io.emit('trackDupSrc', data.trackDupSrc);
            }
        } else if (messageParts[1] == 'TgtTrk1') {
            if (data.trackDupTgt != messageValue) {
                data.trackDupTgt = messageValue;
                io.emit('trackDupTgt', data.trackDupTgt);
            }
        }
    } else if (messageParts[0] == 'faders') {
        if (messageParts[1].startsWith('expr')) {
            let exprNum = parseInt(messageParts[1].substring(4));
            if (exprNum >= 1 && exprNum <= 32) {
                if (data.expressions[exprNum-1].name != messageValue) {
                    data.expressions[exprNum-1].name = messageValue;
                    io.emit('expressions', data.expressions);
                }
            }
        }
    } else if (messageParts[0] == 'keyboard') {
        if (messageParts[1].startsWith('key')) {
            let keyNum = parseInt(messageParts[1].substring(3));
            if (keyNum >= 1 && keyNum <= 25) {
                if (messageParts.length == 3 && messageParts[2] == 'color') {
                    let active = messageValue;
                    if (active == 'purple' || active == 'brown') {
                        active = 0;
                    } else if (active == 'green') {
                        active = 1;
                    }
                    if (data.keyboardStatus[keyNum-1] != active) {
                        data.keyboardStatus[keyNum-1] = active;
                        io.emit('keyboardStatus', data.keyboardStatus);
                    }
                }
            }
        }
    } else if (messageParts[0] == 'Stops'){
        if (messageParts[1] == 'label300') {
            if (data.uptime != messageValue) {
                data.uptime = messageValue;
                io.emit('uptime', data.uptime);
            }
        } else if (messageParts[1] == 'label301') {
            if (data.magicTunerStatus.currentNote != messageValue) {
                data.magicTunerStatus.currentNote = messageValue;
                io.emit('magicTunerStatus', data.magicTunerStatus);
            }
        } else if (messageParts[1] == 'label305') {
            if (data.trackNum != messageValue) {
                data.trackNum = messageValue;
                io.emit('trackNum', data.trackNum);
            }
        } else if (messageParts[1] == 'label306') {
            if (data.namingCurrentFolder != messageValue) {
                data.namingCurrentFolder = messageValue;
                io.emit('namingCurrentFolder', data.namingCurrentFolder);
            }
        } else if (messageParts[1] == 'label307') {
            if (data.folderTrackName != messageValue) {
                data.folderTrackName = messageValue;
                io.emit('folderTrackName', data.folderTrackName);
            }
        } else if (messageParts[1] == 'LabelSpecial4') {
            if (data.magicTunerStatus.pattern != messageValue) {
                data.magicTunerStatus.pattern = messageValue;
                io.emit('magicTunerStatus', data.magicTunerStatus);
            }
        } else if (messageParts[1].startsWith('label')) {
            let labelNum = parseInt(messageParts[1].substring(5));
            if (labelNum >= 1 && labelNum <= 253) {
                if (data.stops[labelNum-1].name != messageValue) {
                    data.stops[labelNum-1].name = messageValue;
                    data.stops[labelNum-1].number = labelNum;
                    io.emit('stops', data.stops);
                }
            }
        } else if (messageParts[1].startsWith('push')) {
            let btnNum = parseInt(messageParts[1].substring(4));
            if (btnNum >= 1 && btnNum <= 253) {
                if (messageParts.length == 3 && messageParts[2] == 'color') {
                    let active = messageValue;
                    if (active == 'purple') {
                        active = 0;
                    } else if (active == 'green') {
                        active = 1;
                    }
                    if (data.stops[btnNum-1].active != active) {
                        data.stops[btnNum-1].active = active;
                        io.emit('stops', data.stops);
                    }
                }
            }
        } else if (messageParts[1].startsWith('DivLabel')) {
            let labelNum = parseInt(messageParts[1].substring(8));
            if (labelNum >= 1 && labelNum <= 36) {
                if (data.divLabels[labelNum-1] != messageValue) {
                    if (messageValue == "") {
                        messageValue = "Unlabeled Div"
                    }
                    data.divLabels[labelNum-1] = messageValue;
                    io.emit('divLabels', data.divLabels);
                }
            }
        }
    } else if (messageParts[0] == 'UserDef'){
        if (messageParts[1] == 'label981') {
            if (data.trackNames[1] != messageValue) {
                data.trackNames[1] = messageValue;
                io.emit('trackNames', data.trackNames);
            }
        } else if (messageParts[1] == 'label982') {
            if (data.trackNames[2] != messageValue) {
                data.trackNames[2] = messageValue;
                io.emit('trackNames', data.trackNames);
            }
        } else if (messageParts[1] == 'label983') {
            if (data.trackNames[3] != messageValue) {
                data.trackNames[3] = messageValue;
                io.emit('trackNames', data.trackNames);
            }
        } else if (messageParts[1] == 'label984') {
            if (data.trackNames[4] != messageValue) {
                data.trackNames[4] = messageValue;
                io.emit('trackNames', data.trackNames);
            }
        } else if (messageParts[1] == 'label985') {
            if (data.trackNames[5] != messageValue) {
                data.trackNames[5] = messageValue;
                io.emit('trackNames', data.trackNames);
            }
        } else if (messageParts[1] == 'label986') {
            if (data.trackNames[6] != messageValue) {
                data.trackNames[6] = messageValue;
                io.emit('trackNames', data.trackNames);
            }
        } else if (messageParts[1] == 'label987') {
            if (data.trackNames[7] != messageValue) {
                data.trackNames[7] = messageValue;
                io.emit('trackNames', data.trackNames);
            }
        } else if (messageParts[1] == 'label988') {
            if (data.trackNames[8] != messageValue) {
                data.trackNames[8] = messageValue;
                io.emit('trackNames', data.trackNames);
            }
        } else if (messageParts[1] == 'label989') {
            if (data.trackNames[9] != messageValue) {
                data.trackNames[9] = messageValue;
                io.emit('trackNames', data.trackNames);
            }
        } else if (messageParts[1] == 'label990') {
            if (data.trackNames[10] != messageValue) {
                data.trackNames[10] = messageValue;
                io.emit('trackNames', data.trackNames);
            }
        } else if (messageParts[1] == 'page1') {
            if (data.userVarPage != messageValue) {
                data.userVarPage = messageValue;
                io.emit('userVarPage', data.userVarPage);
            }
        } else if (messageParts[1].startsWith('label')) {
            let labelNum = parseInt(messageParts[1].substring(5));
            if (labelNum >= 1 && labelNum <= 10) {
                if (data.userVars[labelNum-1].name != messageValue) {
                    data.userVars[labelNum-1].name = messageValue;
                    io.emit('userVars', data.userVars);
                }
            }
        } else if (messageParts[1].startsWith('value')) {
            let valueNum = parseInt(messageParts[1].substring(5));
            if (valueNum >= 1 && valueNum <= 10) {
                if (data.userVars[valueNum-1].value != messageValue) {
                    data.userVars[valueNum-1].value = messageValue;
                    io.emit('userVars', data.userVars);
                }
            }
        }
    } else if (messageParts[0] == 'OPTICS'){
        if (messageParts[1].startsWith('special')) {
            let itemNum = parseInt(messageParts[1].substring(7));
            if (itemNum == 1898) {
                if (messageParts.length == 3 && messageParts[2] == 'color') {
                    let active = messageValue;
                    if (active == 'blue') {
                        active = 0;
                    } else if (active == 'red') {
                        active = 1;
                    }
                    if (data.pitchStatus[10] != active) {
                        data.pitchStatus[10] = active;
                        io.emit('pitchStatus', data.pitchStatus);
                    }
                }
            } else if (itemNum == 2010) {
                if (messageParts.length == 3 && messageParts[2] == 'color') {
                    let active = messageValue;
                    if (active == 'blue') {
                        active = 0;
                    } else if (active == 'red') {
                        active = 1;
                    }
                    if (data.sostActive != active) {
                        data.sostActive = active;
                        io.emit('sostActive', data.sostActive);
                    }
                }
            } else if (itemNum == 2012) {
                if (messageParts.length == 3 && messageParts[2] == 'color') {
                    let active = messageValue;
                    if (active == 'blue') {
                        active = 0;
                    } else if (active == 'red') {
                        active = 1;
                    }
                    if (data.magicTunerStatus.active != active) {
                        data.magicTunerStatus.active = active;
                        io.emit('magicTunerStatus', data.magicTunerStatus);
                    }
                }
            } else if (itemNum >= 1900 && itemNum <= 1911) {
                if (messageParts.length == 3 && messageParts[2] == 'color') {
                    let active = messageValue;
                    if (active == 'blue') {
                        active = 0;
                    } else if (active == 'red') {
                        active = 1;
                    }
                    if (data.presetStatus[itemNum-1900] != active) {
                        data.presetStatus[itemNum-1900] = active;
                        io.emit('presetStatus', data.presetStatus);
                    }
                }
            } else if (itemNum >= 2020 && itemNum <= 2029) {
                if (messageParts.length == 3 && messageParts[2] == 'color') {
                    let active = messageValue;
                    if (active == 'blue') {
                        active = 0;
                    } else if (active == 'red') {
                        active = 1;
                    }
                    if (data.pitchStatus[itemNum-2020] != active) {
                        data.pitchStatus[itemNum-2020] = active;
                        io.emit('pitchStatus', data.pitchStatus);
                    }
                }
            }
        }
    }

    // Log the message for testing
    //console.log(messageParts, messageValue);
});

oscServer.on('error', (err) => {
    console.error(err);
});

io.on('connection', (socket) => {
    sendSubscribeMessage();

    // Send the current data to the client
    socket.emit('trackNum', data.trackNum);
    socket.emit('trackTime', data.trackTime);
    socket.emit('trackLocked', data.trackLocked);
    socket.emit('uptime', data.uptime);
    socket.emit('magicTunerStatus', data.magicTunerStatus);
    socket.emit('trackNames', data.trackNames);
    socket.emit('stops', data.stops);
    socket.emit('sostActive', data.sostActive);
    socket.emit('divLabels', data.divLabels);
    socket.emit('presetStatus', data.presetStatus);
    socket.emit('pitchStatus', data.pitchStatus);
    socket.emit('expressions', data.expressions);
    socket.emit('keyboardStatus', data.keyboardStatus);
    socket.emit('folderTrackName', data.folderTrackName);
    socket.emit('namingCurrentFolder', data.namingCurrentFolder);
    socket.emit('trackDupSrc', data.trackDupSrc);
    socket.emit('trackDupTgt', data.trackDupTgt);
    socket.emit('userVars', data.userVars);
    socket.emit('userVarPage', data.userVarPage);
    socket.emit('siteName', conf.siteName);

    // Handle the client doing things
    socket.on('sendOSCcmd', (cmd) => {
        sendOSCCommand(cmd.cmd, cmd.state);
    });

    socket.on('moveFader', (cmd) => {
        if (data.expressions[cmd.id].value != cmd.value) {
            data.expressions[cmd.id].value = cmd.value;
            oscClient.send("/faders/fader"+cmd.id.toString(), cmd.value, (err) => {
                if (err) console.error(err);
            });
            socket.broadcast.emit('expressions', data.expressions);
        }
    });
});

app.post('/api/osc', (req, res) => {
    const { cmd, state } = req.body ?? {};
    console.log("Received OSC command via HTTP:", cmd, state);

    if (typeof cmd !== 'string' || cmd.length === 0) {
        return res.status(400).json({ error: 'cmd must be a non-empty string' });
    }

    if (typeof state !== 'number') {
        return res.status(400).json({ error: 'state must be a number' });
    }

    sendOSCCommand(cmd, state);
    return res.status(202).json({ ok: true });
});

app.post('/api/remote-action', (req, res) => {
    const rawAction = req.body?.action;
    const action = typeof rawAction === 'string' ? rawAction.trim().toLowerCase() : "";
    console.log("Received remote action via HTTP:", action);

    if (!action) {
        return res.status(400).json({ error: 'action must be a non-empty string' });
    }

    if (!triggerRemoteAction(action)) {
        return res.status(400).json({ error: 'unsupported action' });
    }

    return res.status(202).json({ ok: true });
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/landing.html');
});

app.get('/tuner', (req, res) => {
    res.sendFile(__dirname + '/tuner.html');
});

app.get('/organist', (req, res) => {
    res.sendFile(__dirname + '/organist.html');
});

app.get('/sequencer', (req, res) => {
    res.sendFile(__dirname + '/sequencer.html');
});

app.use('/static', express.static(path.join(__dirname, 'static')));

oscServer.on('listening', () => {
    console.log('OSC Server is listening on 0.0.0.0:9000');
});

httpServer.listen(httpPort, () => {
    const serviceName = (conf.siteName || "").trim() || os.hostname();

    bonjour.publish({
        name: serviceName,
        type: 'organremote',
        protocol: 'tcp',
        port: httpPort
    });

    console.log(`HTTP Server is listening on *:${httpPort}`);
    console.log(`Bonjour service published as "${serviceName}" on _organremote._tcp`);
>>>>>>> 6aa93221009fb83a9a816fc10271ab353e8e8381
});

app.get('/organist', (req, res) => {
    res.sendFile(path.join(__dirname, 'organist.html'));
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
    console.log(`HTTP Server is listening on *:${httpPort}`);
    console.log(`OSC commands are being sent to ${oscTargetHost}:${oscTargetPort}`);
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

    io.close();

    try {
        oscClient.close();
    } catch (error) {
        console.error('Failed to close OSC client:', error);
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
