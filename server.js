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
    trackLocked: 0
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
        } 
    }

    // Log the message for testing
    //console.log(messageParts, messageValue);
});

io.on('connection', (socket) => {
    sendSubscribeMessage();

    // Send the current data to the client
    socket.emit('trackNum', data.trackNum);
    socket.emit('trackTime', data.trackTime);
    socket.emit('trackLocked', data.trackLocked);
    socket.emit('uptime', data.uptime);
    socket.emit('magicTunerStatus', data.magicTunerStatus);

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