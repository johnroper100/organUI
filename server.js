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
    }
}

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    socket.on('playTrack', () => {
        oscClient.send('/OPTICS/special2036', 1, (err) => {
            if (err) console.error(err);
        });
    });
    socket.on('stopTrack', () => {
        oscClient.send('/OPTICS/special2037', 1, (err) => {
            if (err) console.error(err);
        });
    });
    socket.on('trackUp', () => {
        oscClient.send('/OPTICS/special2031', 1, (err) => {
            if (err) console.error(err);
        });
    });
    socket.on('trackUpTen', () => {
        oscClient.send('/OPTICS/special2030', 1, (err) => {
            if (err) console.error(err);
        });
    });
    socket.on('trackDown', () => {
        oscClient.send('/OPTICS/special2032', 1, (err) => {
            if (err) console.error(err);
        });
    });
    socket.on('trackDownTen', () => {
        oscClient.send('/OPTICS/special2033', 1, (err) => {
            if (err) console.error(err);
        });
    });
    socket.on('recordTrack', () => {
        oscClient.send('/OPTICS/special2035', 1, (err) => {
            if (err) console.error(err);
        });
    });
});

oscServer.on('message', (msg) => {
    let messageParts = msg[0].split('/');
    messageParts.shift();
    let messageValue = msg[1];
    if (messageParts[0] == 'RP') {
        if (messageParts[1] == 'label213') {
            messageValue = messageValue.toString();
            if (messageValue != data.trackNum[2]) {
                data.trackNum[2] = messageValue;
                io.emit('trackNumber', data.trackNum[0] + data.trackNum[1] + data.trackNum[2]);
            }
        } else if (messageParts[1] == 'label212') {
            messageValue = messageValue.toString();
            if (messageValue != data.trackNum[1]) {
                data.trackNum[1] = messageValue;
                io.emit('trackNumber', data.trackNum[0] + data.trackNum[1] + data.trackNum[2]);
            }
        } else if (messageParts[1] == 'label210') {
            messageValue = messageValue.toString();
            if (messageValue != data.trackNum[0]) {
                data.trackNum[0] = messageValue;
                io.emit('trackNumber', data.trackNum[0] + data.trackNum[1] + data.trackNum[2]);
            }
        }
    }
    console.log(messageParts, messageValue);
});

oscServer.on('listening', () => {
    console.log('OSC Server is listening on 127.0.0.1:8000');
});

httpServer.listen(3000, () => {
    console.log('HTTP Server is listening on *:3000');
});