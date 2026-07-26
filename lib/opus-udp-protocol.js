'use strict';

const AD_HOC_CHAMBER = 108;
const COMMAND_BUFFER_BYTES = 50;
const MAX_COMMAND_BYTES = 49;
const MAX_RENAME_CHARS = 15;
const OLED_DISPLAY_COUNT = 4;
const OLED_LINE_COUNT = 4;
const RTP_PAYLOAD_TYPE = 100;
const RTP_SSRC = 0x76543210;

function encodeEframe(payload, sequence = 0, timestamp = Date.now()) {
    if (typeof payload !== 'string') {
        throw new TypeError('payload must be a string');
    }

    const payloadBuffer = Buffer.from(payload, 'ascii');
    if (
        payloadBuffer.length > MAX_COMMAND_BYTES
        || payloadBuffer.toString('ascii') !== payload
    ) {
        throw new RangeError(
            `payload must be ASCII and at most ${MAX_COMMAND_BYTES} bytes`
        );
    }

    // Send the controller's complete 50-byte command buffer. Buffer.alloc()
    // makes every byte after the command 0x00, so the Oberon parser always has
    // an end-of-string marker even when the UDP receiver fails to append one.
    const frame = Buffer.alloc(14 + COMMAND_BUFFER_BYTES);
    frame[0] = 0x80;
    frame[1] = RTP_PAYLOAD_TYPE;
    frame.writeUInt16BE(sequence & 0xffff, 2);
    frame.writeUInt32BE(Number(timestamp) >>> 0, 4);
    frame.writeUInt32BE(RTP_SSRC, 8);
    frame[12] = AD_HOC_CHAMBER;
    frame[13] = COMMAND_BUFFER_BYTES;
    payloadBuffer.copy(frame, 14);
    return frame;
}

function decodeEframe(frame) {
    if (
        !Buffer.isBuffer(frame)
        || frame.length < 14
        || frame[0] !== 0x80
        || frame[1] !== RTP_PAYLOAD_TYPE
        || frame[12] !== AD_HOC_CHAMBER
    ) {
        return null;
    }

    const payloadLength = frame[13];
    if (payloadLength > frame.length - 14) {
        return null;
    }

    return {
        sequence: frame.readUInt16BE(2),
        timestamp: frame.readUInt32BE(4),
        ssrc: frame.readUInt32BE(8),
        payload: frame
            .subarray(14, 14 + payloadLength)
            .toString('ascii')
            .replace(/\0+$/u, '')
    };
}

function positiveInteger(value, field, maximum = Number.MAX_SAFE_INTEGER) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
        throw new RangeError(`${field} must be an integer from 1 to ${maximum}`);
    }
    return number;
}

function boundedInteger(value, field, minimum, maximum) {
    const number = Number(value);
    if (
        !Number.isSafeInteger(number)
        || number < minimum
        || number > maximum
    ) {
        throw new RangeError(
            `${field} must be an integer from ${minimum} to ${maximum}`
        );
    }
    return number;
}

function printableName(value) {
    if (typeof value !== 'string') {
        throw new TypeError('name must be a string');
    }

    const name = value.trim();
    if (
        name.length === 0
        || !/^[\x20-\x7e]+$/u.test(name)
        || name.includes('"')
    ) {
        throw new RangeError(
            'name must contain printable ASCII characters and no double quotes'
        );
    }
    return name;
}

function renameName(value) {
    const name = printableName(value);
    if (name.length > MAX_RENAME_CHARS) {
        throw new RangeError(
            `name must be at most ${MAX_RENAME_CHARS} characters`
        );
    }
    return name;
}

function commandWithinLimit(command) {
    if (Buffer.byteLength(command, 'ascii') > MAX_COMMAND_BYTES) {
        throw new RangeError(
            `command exceeds the controller's ${MAX_COMMAND_BYTES}-byte limit`
        );
    }
    return command;
}

function buildRemoteCommands(request, limits = {}) {
    if (!request || typeof request !== 'object') {
        throw new TypeError('UDP command must be an object');
    }

    const action = typeof request.action === 'string'
        ? request.action.trim()
        : '';
    const maxTracks = positiveInteger(limits.numTracks ?? 9999, 'numTracks');
    const maxFolders = positiveInteger(limits.numFolders ?? 9999, 'numFolders');
    const maxLevels = positiveInteger(limits.numLevels ?? 9999, 'numLevels');
    const count = request.count === undefined
        ? 1
        : positiveInteger(request.count, 'count', 10);

    const repeat = (command) => Array.from({ length: count }, () => command);
    let commands;

    switch (action) {
    case 'generalCancel':
        commands = ['CA Gen Can'];
        break;
    case 'showPiston':
        commands = [`CA Show Piston ${positiveInteger(request.number, 'number')}`];
        break;
    case 'showRange':
        commands = [`CA Show Range ${positiveInteger(request.number, 'number')}`];
        break;
    case 'gotoFolder':
        commands = [
            `CA Goto Folder ${positiveInteger(request.number, 'number', maxFolders)}`
        ];
        break;
    case 'gotoLevel':
        commands = [
            `CA Goto Level ${positiveInteger(request.number, 'number', maxLevels)}`
        ];
        break;
    case 'gotoLocalLevel':
        commands = [
            `CA Goto Local Level ${positiveInteger(request.number, 'number', maxLevels)}`
        ];
        break;
    case 'memoryLevelUp':
        commands = repeat('CA Inc Mem Level');
        break;
    case 'memoryLevelDown':
        commands = repeat('CA Dec Mem Level');
        break;
    case 'localMemoryLevelUp':
        commands = repeat('CA Inc Local Mem Level');
        break;
    case 'localMemoryLevelDown':
        commands = repeat('CA Dec Local Mem Level');
        break;
    case 'toggleStop':
        commands = [`CA Toggle Stop ${positiveInteger(request.number, 'number')}`];
        break;
    case 'renameTrack': {
        const number = positiveInteger(request.number, 'number', maxTracks);
        commands = [
            `CA Rename Track ${number} "${renameName(request.name)}"`
        ];
        break;
    }
    case 'renameFolder': {
        const number = positiveInteger(request.number, 'number', maxFolders);
        commands = [
            `CA Rename Folder ${number} "${renameName(request.name)}"`
        ];
        break;
    }
    case 'transposerNeutral':
        commands = ['CA Transposer Neutral'];
        break;
    case 'transposerUp':
        commands = repeat('CA Transposer Up');
        break;
    case 'transposerDown':
        commands = repeat('CA Transposer Down');
        break;
    case 'getFolderName':
        commands = [
            `CA Get Folder Name ${positiveInteger(request.number, 'number', maxFolders)}`
        ];
        break;
    case 'toggleButton':
        commands = [`GIO Tgl Button ${positiveInteger(request.number, 'number')}`];
        break;
    case 'setButton':
        commands = [`GIO Set Button ${positiveInteger(request.number, 'number')}`];
        break;
    case 'clearButton':
        commands = [`GIO Clr Button ${positiveInteger(request.number, 'number')}`];
        break;
    case 'playToggle':
        commands = ['RP Btn Play'];
        break;
    case 'trackUp':
        commands = repeat('RP Track Up');
        break;
    case 'trackDown':
        commands = repeat('RP Track Down');
        break;
    case 'pause':
        commands = ['RP Pause'];
        break;
    case 'recordToggle':
        commands = ['RP Record'];
        break;
    case 'toggleTrackLock':
        commands = ['RP Toggle Track Lock'];
        break;
    case 'playTrack':
        commands = [
            `RP Play ${positiveInteger(request.number, 'number', maxTracks)}`
        ];
        break;
    case 'setFlag':
        commands = [
            `Flag ${boundedInteger(request.number, 'number', 0, 31)}`
        ];
        break;
    case 'setTransportLamps':
        commands = [
            `LDS Buttons ${boundedInteger(request.bitmask, 'bitmask', 0, 63)}`
        ];
        break;
    case 'getTrackName':
        commands = [
            `Query Get Track Name ${positiveInteger(request.number, 'number', maxTracks)}`
        ];
        break;
    case 'queryOLED':
        commands = request.display === undefined
            ? ['Query OLED']
            : [
                `Query OLED ${positiveInteger(
                    request.display,
                    'display',
                    OLED_DISPLAY_COUNT
                )}`
            ];
        break;
    case 'queryAllOLEDs':
        // The unnumbered command preserves compatibility with controller
        // builds that expose only their primary display. Displays 2-4 use the
        // indexed multi-display API extension documented with this client.
        commands = [
            'Query OLED',
            ...Array.from(
                { length: OLED_DISPLAY_COUNT - 1 },
                (_, index) => `Query OLED ${index + 2}`
            )
        ];
        break;
    case 'resetDevice':
        commands = ['Dev Reset'];
        break;
    default:
        throw new RangeError('unsupported UDP action');
    }

    return commands.map(commandWithinLimit);
}

function parseOLEDReply(reply) {
    if (typeof reply !== 'string') {
        return null;
    }

    // Multi-display extension: LDSD<display>L<line><20 characters>.
    // Keeping the display and line digits in the reply makes concurrently
    // requested screens unambiguous even if UDP datagrams are reordered.
    const indexed = /^LDSD([1-4])L([1-4])([\s\S]*)$/u.exec(reply);
    if (indexed) {
        return {
            display: Number(indexed[1]),
            line: Number(indexed[2]),
            text: indexed[3],
            legacy: false
        };
    }

    // Legacy controller builds return the primary display only.
    const legacy = /^LDSL([1-4])([\s\S]*)$/u.exec(reply);
    if (legacy) {
        return {
            display: 1,
            line: Number(legacy[1]),
            text: legacy[2],
            legacy: true
        };
    }

    return null;
}

function mapOSCCommandToRemote(command) {
    if (
        !command
        || typeof command.cmd !== 'string'
        || typeof command.state !== 'number'
    ) {
        return null;
    }

    const stopMatch = /^\/Stops\/push(\d+)$/u.exec(command.cmd);
    if (stopMatch) {
        return command.state === 0
            ? { handled: true, requests: [] }
            : {
                handled: true,
                requests: [{
                    action: 'toggleStop',
                    number: Number(stopMatch[1])
                }]
            };
    }

    const mappings = {
        '/OPTICS/special2030': { action: 'trackUp', count: 10 },
        '/OPTICS/special2031': { action: 'trackUp' },
        '/OPTICS/special2032': { action: 'trackDown' },
        '/OPTICS/special2033': { action: 'trackDown', count: 10 },
        '/OPTICS/special2034': { action: 'toggleTrackLock' },
        '/OPTICS/special2035': { action: 'recordToggle' },
        '/OPTICS/special2036': { action: 'playToggle' },
        '/OPTICS/special2042': { action: 'trackUp' },
        '/OPTICS/special2043': { action: 'trackDown' }
    };
    const request = mappings[command.cmd];
    if (!request) {
        return null;
    }

    return {
        handled: true,
        requests: command.state === 0 ? [] : [request]
    };
}

module.exports = {
    AD_HOC_CHAMBER,
    COMMAND_BUFFER_BYTES,
    MAX_COMMAND_BYTES,
    MAX_RENAME_CHARS,
    OLED_DISPLAY_COUNT,
    OLED_LINE_COUNT,
    RTP_PAYLOAD_TYPE,
    RTP_SSRC,
    buildRemoteCommands,
    decodeEframe,
    encodeEframe,
    mapOSCCommandToRemote,
    parseOLEDReply
};
