'use strict';

function positiveCount(value, name) {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 0) {
        throw new RangeError(`${name} must be a non-negative integer`);
    }
    return count;
}

function buildNameInventoryRequests(numTracks, numFolders) {
    const trackCount = positiveCount(numTracks, 'numTracks');
    const folderCount = positiveCount(numFolders, 'numFolders');
    const requests = [];

    for (let number = 1; number <= trackCount; number += 1) {
        requests.push({ action: 'getTrackName', number });
    }
    for (let number = 1; number <= folderCount; number += 1) {
        requests.push({ action: 'getFolderName', number });
    }

    return requests;
}

module.exports = {
    buildNameInventoryRequests
};
