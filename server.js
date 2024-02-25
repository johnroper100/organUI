const express = require('express');
const app = express();
const path = require('path');
const http = require('http');
const httpServer = http.createServer(app);
const { Server: SocketServer } = require("socket.io");
const io = new SocketServer(httpServer);
const { Client, Server } = require('node-osc');

const oscClient = new Client('192.168.175.12', 8000);
var oscServer = new Server(9000, '0.0.0.0');

var data = {
    trackNum: "No Track",
    trackTime: "-- : --",
    uptime: "No Uptime",
    magicTunerStatus: {active: 0, currentNote: "Off", pattern: "No Pattern"},
    sostActive: 0,
    trackLocked: 0,
    trackNames: {},
    stops: [],
    divLabels: []
}

for (let i = 1; i <= 10; i++) {
    data.trackNames[i] = "No Track";
}

for (let i = 1; i <= 252; i++) {
    data.stops.push({name: "Stop "+i.toString(), active: 0});
}

for (let i = 1; i <= 36; i++) {
    data.divLabels.push("Div Label "+i.toString());
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
        } else if (messageParts[1] == 'LabelSpecial4') {
            if (data.magicTunerStatus.pattern != messageValue) {
                data.magicTunerStatus.pattern = messageValue;
                io.emit('magicTunerStatus', data.magicTunerStatus);
            }
        } else if (messageParts[1].startsWith('label')) {
            let labelNum = parseInt(messageParts[1].substring(5));
            if (labelNum >= 1 && labelNum <= 252) {
                if (data.stops[labelNum-1].name != messageValue) {
                    data.stops[labelNum-1].name = messageValue;
                    io.emit('stops', data.stops);
                }
            }
        } else if (messageParts[1].startsWith('push')) {
            let btnNum = parseInt(messageParts[1].substring(4));
            if (btnNum >= 1 && btnNum <= 252) {
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
            if (labelNum >= 1 && labelNumNum <= 36) {
                if (data.divLabels[labelNumNum-1] != messageValue) {
                    data.divLabels[labelNumNum-1] = messageValue;
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
        }
    } else if (messageParts[0] == 'OPTICS'){
        if (messageParts[1] == 'special2012') {
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
        } else if (messageParts[1] == 'special2010') {
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

    // Handle the client doing things
    socket.on('sendOSCcmd', (cmd) => {
        oscClient.send(cmd, 1, (err) => {
            if (err) console.error(err);
        });
    });
});

oscServer.on('listening', () => {
    console.log('OSC Server is listening on 0.0.0.0:9000');
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.use('/static', express.static(path.join(__dirname, 'static')));

httpServer.listen(3000, () => {
    console.log('HTTP Server is listening on *:3000');
});