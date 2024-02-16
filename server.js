const express = require('express');
const app = express();
const http = require('http');
const httpServer = http.createServer(app);
const { Server: SocketServer } = require("socket.io");
const io = new SocketServer(httpServer);
const { Client, Server } = require('node-osc');

const oscClient = new Client('127.0.0.1', 9000);
var oscServer = new Server(8000, '127.0.0.1');

var data = {
    trackNum: {
        0: "",
        1: "",
        2: ""
    },
    trackTime: {
        0: "",
        1: ""
    }
}

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    // Send the current data to the client
    io.emit('trackNumber', data.trackNum[0] + data.trackNum[1] + data.trackNum[2]);
    io.emit('trackTime', data.trackTime[0] + ":" + data.trackTime[1]);

    // Handle the client doing things
    socket.on('sendOSCcmd', (cmd) => {
        oscClient.send(cmd, 1, (err) => {
            if (err) console.error(err);
        });
    });
});

oscServer.on('message', (msg) => {
    // Parse the message
    let messageValue = msg[1];
    let messageParts = msg[0].split('/').shift();

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
    }

    // Log the message for testing
    console.log(messageParts, messageValue);
});

oscServer.on('listening', () => {
    console.log('OSC Server is listening on 127.0.0.1:8000');
});

httpServer.listen(3000, () => {
    console.log('HTTP Server is listening on *:3000');
});