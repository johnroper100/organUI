'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

for (const file of ['organist.html', 'tuner.html']) {
    test(`${file} has valid module-script syntax and UDP controls`, () => {
        const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        const scripts = [
            ...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/gu)
        ];

        assert.equal(scripts.length, 1);
        const source = scripts[0][1].replace(
            "import { createApp } from 'vue'",
            'const createApp = null'
        );
        assert.doesNotThrow(() => new Function(source));

        assert.match(html, /sendUDPcmd\('playTrack'/u);
        assert.match(html, /renameItem\('renameTrack'/u);
        assert.match(html, /renameItem\('renameFolder'/u);
        assert.match(html, /UDP(?: target)?: \{\{remoteTarget\}\}/u);
    });
}

test('advanced protocol controls have valid module syntax and expose every UDP action', () => {
    const html = fs.readFileSync(
        path.join(__dirname, '..', 'advanced.html'),
        'utf8'
    );
    const scripts = [
        ...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/gu)
    ];

    assert.equal(scripts.length, 1);
    const source = scripts[0][1].replace(
        "import { createApp } from 'vue'",
        'const createApp = null'
    );
    assert.doesNotThrow(() => new Function(source));

    const protocolSource = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'opus-udp-protocol.js'),
        'utf8'
    );
    const udpActions = [
        ...protocolSource.matchAll(/case '([^']+)':/gu)
    ].map(match => match[1]);

    assert.ok(udpActions.length > 0);

    for (const action of udpActions) {
        assert.match(html, new RegExp(`sendUDPcmd\\('${action}'`, 'u'));
    }

    for (const oscFamily of [
        '/Stops/push',
        '/Stops/trigger',
        '/keyboard/key',
        '/OPTICS/specialkb',
        '/OPTICS/special',
        '/faders/fader',
        '/UserDef/inc',
        '/UserDef/dec'
    ]) {
        assert.ok(html.includes(oscFamily), `missing OSC family ${oscFamily}`);
    }
});
