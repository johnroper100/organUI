'use strict';

const MAX_OSC_ADDRESS_LENGTH = 128;

const COMMAND_RULES = [
    {
        pattern: /^\/Stops\/(?:push|trigger)(\d+)$/,
        validateIndex: (index) => index >= 1 && index <= 65535,
        validateState: isControlState
    },
    {
        pattern: /^\/keyboard\/key(\d+)$/,
        validateIndex: (index) => index >= 1 && index <= 255,
        validateState: isControlState
    },
    {
        pattern: /^\/OPTICS\/specialkb(\d+)$/,
        validateIndex: isSpecialKeyboardCode,
        validateState: isControlState
    },
    {
        // Special commands are controller/build dependent. Restrict the shape
        // and numeric representation without blocking site-specific selectors.
        pattern: /^\/OPTICS\/special(\d+)$/,
        validateIndex: (index) => index >= 0 && index <= 65535,
        validateState: isControlState
    },
    {
        // The supplied TouchOSC layout uses fader0..fader7 even though one
        // reference document calls this field 1-based. Preserve deployed
        // behavior until hardware compatibility has been established.
        pattern: /^\/faders\/fader(\d+)$/,
        validateIndex: (index) => index >= 0 && index <= 255,
        validateState: (state) => state >= 0 && state <= 1
    },
    {
        pattern: /^\/UserDef\/(?:inc|dec)(\d+)$/,
        validateIndex: (index) => (index >= 1 && index <= 10) || index === 999,
        validateState: isControlState
    }
];

function isControlState(state) {
    // The controller treats any non-zero int/float as pressed. Do not narrow
    // the OSC protocol to only literal 0 and 1.
    return Number.isFinite(state);
}

function isSpecialKeyboardCode(code) {
    return [8, 13, 14, 15, 27, 28, 32].includes(code)
        || (code >= 33 && code <= 122);
}

function validateOSCCommand(command) {
    if (!command || typeof command !== 'object') {
        return { ok: false, error: 'command must be an object' };
    }

    const { cmd, state } = command;

    if (typeof cmd !== 'string' || cmd.length === 0) {
        return { ok: false, error: 'cmd must be a non-empty string' };
    }

    if (cmd.length > MAX_OSC_ADDRESS_LENGTH) {
        return {
            ok: false,
            error: `cmd must be at most ${MAX_OSC_ADDRESS_LENGTH} characters`
        };
    }

    if (typeof state !== 'number' || !Number.isFinite(state)) {
        return { ok: false, error: 'state must be a finite number' };
    }

    for (const rule of COMMAND_RULES) {
        const match = rule.pattern.exec(cmd);
        if (!match) {
            continue;
        }

        const index = Number(match[1]);
        if (!Number.isSafeInteger(index) || !rule.validateIndex(index)) {
            return { ok: false, error: 'OSC object number is out of range' };
        }

        if (!rule.validateState(state)) {
            return { ok: false, error: 'state is out of range for this OSC command' };
        }

        return { ok: true, value: { cmd, state } };
    }

    return { ok: false, error: 'unsupported OSC command address' };
}

function parseOSCMessage(message) {
    if (!Array.isArray(message) || typeof message[0] !== 'string') {
        return null;
    }

    const address = message[0];
    if (
        address.length === 0
        || address.length > MAX_OSC_ADDRESS_LENGTH
        || !address.startsWith('/')
    ) {
        return null;
    }

    const parts = address.split('/').slice(1);
    if (parts.length < 2 || parts.some((part) => part.length === 0)) {
        return null;
    }

    return {
        address,
        parts,
        value: message.length > 1 ? message[1] : undefined
    };
}

function parseIndexedToken(token, prefix, minimum, maximum) {
    if (typeof token !== 'string') {
        return null;
    }

    const match = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`).exec(token);
    if (!match) {
        return null;
    }

    const number = Number(match[1]);
    if (
        !Number.isSafeInteger(number)
        || number < minimum
        || number > maximum
    ) {
        return null;
    }

    return number;
}

function colorToBinary(value, onColors, offColors) {
    if (typeof value !== 'string') {
        return null;
    }

    if (onColors.includes(value)) {
        return 1;
    }

    if (offColors.includes(value)) {
        return 0;
    }

    return null;
}

function labelToBinary(value) {
    if (value === 0 || value === '0') {
        return 0;
    }

    if (value === 1 || value === '1') {
        return 1;
    }

    return null;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
    MAX_OSC_ADDRESS_LENGTH,
    colorToBinary,
    labelToBinary,
    parseIndexedToken,
    parseOSCMessage,
    validateOSCCommand
};
