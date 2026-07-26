'use strict';

const fs = require('fs');

function positiveInteger(value, name) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) {
        throw new RangeError(`${name} must be a positive integer`);
    }
    return number;
}

function persistDiscoveredCapacity(configPath, config, limits) {
    if (typeof configPath !== 'string' || configPath.length === 0) {
        throw new TypeError('configPath must be a non-empty string');
    }
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
        throw new TypeError('config must be an object');
    }

    const capacity = {
        numFolders: positiveInteger(limits?.numFolders, 'numFolders'),
        numLevels: positiveInteger(limits?.numLevels, 'numLevels'),
        numTracks: positiveInteger(limits?.numTracks, 'numTracks')
    };

    // Re-read immediately before saving so unrelated settings edited while the
    // server is running are not replaced by the startup snapshot.
    const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const nextConfig = {
        ...diskConfig,
        ...capacity
    };
    const temporaryPath = `${configPath}.${process.pid}.tmp`;

    // Keep the same-process fallback current even if persistence subsequently
    // fails because of a filesystem problem.
    Object.assign(config, capacity);

    try {
        fs.writeFileSync(
            temporaryPath,
            `${JSON.stringify(nextConfig, null, 4)}\n`,
            'utf8'
        );
        fs.renameSync(temporaryPath, configPath);
    } catch (error) {
        try {
            fs.unlinkSync(temporaryPath);
        } catch (cleanupError) {
            if (cleanupError.code !== 'ENOENT') {
                error.cleanupError = cleanupError;
            }
        }
        throw error;
    }

    return nextConfig;
}

module.exports = {
    persistDiscoveredCapacity
};
