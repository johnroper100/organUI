'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    persistDiscoveredCapacity
} = require('../lib/config-capacity');

test('atomically updates discovered capacities without losing other settings', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organui-config-'));
    const configPath = path.join(directory, 'conf.json');
    const config = {
        siteName: 'Startup name',
        numFolders: 10,
        numLevels: 20,
        numTracks: 30,
        udpPort: 5005
    };

    try {
        fs.writeFileSync(configPath, JSON.stringify({
            ...config,
            siteName: 'Edited while running',
            httpPort: 3000
        }));

        persistDiscoveredCapacity(configPath, config, {
            numFolders: 100,
            numLevels: 300,
            numTracks: 900
        });

        const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.deepEqual(saved, {
            siteName: 'Edited while running',
            numFolders: 100,
            numLevels: 300,
            numTracks: 900,
            udpPort: 5005,
            httpPort: 3000
        });
        assert.deepEqual(config, {
            siteName: 'Startup name',
            numFolders: 100,
            numLevels: 300,
            numTracks: 900,
            udpPort: 5005
        });
        assert.equal(fs.existsSync(`${configPath}.${process.pid}.tmp`), false);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('rejects invalid discovered capacities without changing the file', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organui-config-'));
    const configPath = path.join(directory, 'conf.json');
    const original = '{"numFolders":10,"numLevels":20,"numTracks":30}';

    try {
        fs.writeFileSync(configPath, original);
        assert.throws(
            () => persistDiscoveredCapacity(configPath, {}, {
                numFolders: 100,
                numLevels: 0,
                numTracks: 900
            }),
            /numLevels must be a positive integer/u
        );
        assert.equal(fs.readFileSync(configPath, 'utf8'), original);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
