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
    magicTunerStatus: "Off",
    trackLocked: 0,
    tunerPattern: "No Pattern",
    trackNames: { 1: "No Track", 2: "No Track", 3: "No Track", 4: "No Track", 5: "No Track", 6: "No Track", 7: "No Track", 8: "No Track", 9: "No Track", 10: "No Track" }
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
            if (data.magicTunerStatus != messageValue) {
                data.magicTunerStatus = messageValue;
                io.emit('magicTunerStatus', data.magicTunerStatus);
            }
        } else if (messageParts[1] == 'label305') {
            if (data.trackNum != messageValue) {
                data.trackNum = messageValue;
                io.emit('trackNum', data.trackNum);
            }
        } else if (messageParts[1] == 'LabelSpecial4') {
            if (data.tunerPattern != messageValue) {
                data.tunerPattern = messageValue;
                io.emit('tunerPattern', data.tunerPattern);
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
    socket.emit('tunerPattern', data.tunerPattern);
    socket.emit('trackNames', data.trackNames);

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