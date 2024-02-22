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
    trackNum: {
        0: "",
        1: "",
        2: ""
    },
    trackTime: {
        0: "",
        1: ""
    },
    uptime: ""
}

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.use('/static', express.static(path.join(__dirname, 'static')));

oscServer.on('message', (msg) => {
    // Parse the message
    let messageParts = msg[0].split('/');
    messageParts.shift();
    let messageValue = msg[1];

    // Figure out what the message is
    if (messageParts[0] == 'RP') {
        if (messageParts[1] == 'label338') {
            messageValue = messageValue.toString();
            if (messageValue != data.trackNum[2]) {
                data.trackNum[2] = messageValue;
                io.emit('trackNumber', data.trackNum[0] + data.trackNum[1] + data.trackNum[2]);
            }
        } else if (messageParts[1] == 'label337') {
            messageValue = messageValue.toString();
            if (messageValue != data.trackNum[1]) {
                data.trackNum[1] = messageValue;
                io.emit('trackNumber', data.trackNum[0] + data.trackNum[1] + data.trackNum[2]);
            }
        } else if (messageParts[1] == 'label336') {
            messageValue = messageValue.toString();
            if (messageValue != data.trackNum[0]) {
                data.trackNum[0] = messageValue;
                io.emit('trackNumber', data.trackNum[0] + data.trackNum[1] + data.trackNum[2]);
            }
        } else if (messageParts[1] == 'label331') {
            messageValue = messageValue.toString();
            if (messageValue != data.trackTime[1]) {
                data.trackTime[1] = messageValue;
                io.emit('trackTime', data.trackTime[0] + ":" + data.trackTime[1]);
            }
        } else if (messageParts[1] == 'label330') {
            messageValue = messageValue.toString();
            if (messageValue != data.trackTime[0]) {
                data.trackTime[0] = messageValue;
                io.emit('trackTime', data.trackTime[0] + ":" + data.trackTime[1]);
            }
        }
    } else if (messageParts[0] == 'Stops'){
        if (messageParts[1] == 'label300') {
            if (data.uptime != messageValue) {
                data.uptime = messageValue;
                io.emit('uptime', data.uptime);
            }
        }
    }

    // Log the message for testing
    console.log(messageParts, messageValue);
});

io.on('connection', (socket) => {
    // Send the current data to the client
    socket.emit('trackNumber', data.trackNum[0] + data.trackNum[1] + data.trackNum[2]);
    socket.emit('trackTime', data.trackTime[0] + ":" + data.trackTime[1]);

    // Handle the client doing things
    socket.on('sendOSCcmd', (cmd) => {
        oscClient.send(cmd, 1, (err) => {
            if (err) console.error(err);
        });
    });
});

oscServer.on('listening', () => {
    console.log('OSC Server is listening on 0.0.0.0:9000');

    oscClient.send("/OPTICS/special2001", 1, (err) => {
        if (err) console.error(err);
    });
});

httpServer.listen(3000, () => {
    console.log('HTTP Server is listening on *:3000');
});