const express = require('express');
const app = express();
const path = require('path');
const http = require('http');
const httpServer = http.createServer(app);
const { Server: SocketServer } = require("socket.io");
const io = new SocketServer(httpServer);
const { Client, Server } = require('node-osc');

const oscClient = new Client('192.168.50.78', 8000);
var oscServer = new Server(9000, '0.0.0.0');

var data = {
    trackNum: "",
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

    // Handle the client doing things
    socket.on('sendOSCcmd', (cmd) => {
        oscClient.send(cmd.cmd, cmd.state, (err) => {
            if (err) console.error(err);
        });
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

httpServer.listen(3000, () => {
    console.log('HTTP Server is listening on *:3000');
});