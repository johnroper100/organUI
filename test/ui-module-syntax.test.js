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

    assert.doesNotMatch(html, /nav-tabs|protocol ==/u);
    for (const group of [
        'tracks',
        'folders',
        'console',
        'stops',
        'tuner',
        'system'
    ]) {
        assert.match(
            html,
            new RegExp(`<section id="${group}"`, 'u'),
            `missing unified advanced group ${group}`
        );
    }
    assert.match(html, />Organist display</u);

    const protocolSource = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'opus-udp-protocol.js'),
        'utf8'
    );
    const udpActions = [
        ...protocolSource.matchAll(/case '([^']+)':/gu)
    ].map(match => match[1]);

    const expectedUdpActions = [
        'clearButton',
        'generalCancel',
        'getFolderName',
        'getTrackName',
        'gotoFolder',
        'gotoLevel',
        'gotoLocalLevel',
        'localMemoryLevelDown',
        'localMemoryLevelUp',
        'memoryLevelDown',
        'memoryLevelUp',
        'pause',
        'playToggle',
        'playTrack',
        'queryAllOLEDs',
        'queryOLED',
        'recordToggle',
        'renameFolder',
        'renameTrack',
        'resetDevice',
        'setButton',
        'setFlag',
        'setTransportLamps',
        'showPiston',
        'showRange',
        'toggleButton',
        'toggleStop',
        'toggleTrackLock',
        'trackDown',
        'trackUp',
        'transposerDown',
        'transposerNeutral',
        'transposerUp'
    ];

    assert.deepEqual([...udpActions].sort(), expectedUdpActions);

    for (const action of udpActions) {
        assert.match(html, new RegExp(`sendUDPcmd\\('${action}'`, 'u'));
    }

    for (const oscFamily of [
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

    for (const selector of [
        1898,
        1999,
        2001,
        2010,
        2011,
        2012,
        2013,
        2014,
        2015,
        2016,
        2017,
        2037,
        2040,
        2041,
        2044,
        2045,
        2046,
        2047,
        2048,
        2049,
        2050,
        2051,
        2052
    ]) {
        assert.ok(
            html.includes(`/OPTICS/special${selector}`),
            `missing OSC special selector ${selector}`
        );
    }

    for (const udpCoveredOscCommand of [
        '/Stops/push',
        '/OPTICS/special2000',
        '/OPTICS/special2030',
        '/OPTICS/special2031',
        '/OPTICS/special2032',
        '/OPTICS/special2033',
        '/OPTICS/special2034',
        '/OPTICS/special2035',
        '/OPTICS/special2036',
        '/OPTICS/special2038',
        '/OPTICS/special2039',
        '/OPTICS/special2042',
        '/OPTICS/special2043'
    ]) {
        assert.ok(
            !html.includes(udpCoveredOscCommand),
            `UDP-covered OSC command is still exposed: ${udpCoveredOscCommand}`
        );
    }

    assert.doesNotMatch(html, /sendOSCKey\((?:14|15)\)/u);

    for (const eventName of [
        'cyclesSinceKeypress',
        'divLabels',
        'expressions',
        'folderTrackName',
        'keyboardStatus',
        'magicTunerStatus',
        'memoryLevel',
        'nameInventoryStatus',
        'namingCurrentFolder',
        'numFolders',
        'numLevels',
        'numTracks',
        'oledDisplays',
        'organistNumber',
        'oscSpecialStatus',
        'pitchStatus',
        'presetStatus',
        'queriedFolderNames',
        'remoteReply',
        'remoteTarget',
        'siteName',
        'sostActive',
        'stops',
        'tabLabels',
        'trackDupSrc',
        'trackDupTgt',
        'trackLocked',
        'trackMinutes',
        'trackNum',
        'trackSeconds',
        'trackTime',
        'transposer',
        'triggerStatus',
        'udpTrackNames',
        'uptime',
        'uptimeSeconds',
        'userVarPage',
        'userVars',
        'vibrateFeedback'
    ]) {
        assert.match(
            html,
            new RegExp(`${eventName}: "${eventName}"`, 'u'),
            `missing received-data event ${eventName}`
        );
    }

    assert.doesNotMatch(html, /^\s*trackNames: "trackNames",?$/mu);
    assert.doesNotMatch(html, /^\s*oledLines: "oledLines",?$/mu);
    assert.match(
        html,
        /Array\.from\(\{length: Number\(this\.numTracks\)/u,
        'advanced track inventory must contain every configured track'
    );
    assert.match(
        html,
        /Array\.from\(\{length: Number\(this\.numFolders\)/u,
        'advanced folder inventory must contain every configured folder'
    );
    assert.match(html, /socket\.on\("connect", \(\) => app\.refreshNameInventory\(\)\)/u);
});
