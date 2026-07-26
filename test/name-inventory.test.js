'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildNameInventoryRequests
} = require('../lib/name-inventory');

test('builds a complete ordered track and folder name inventory', () => {
    assert.deepEqual(
        buildNameInventoryRequests(3, 2),
        [
            { action: 'getTrackName', number: 1 },
            { action: 'getTrackName', number: 2 },
            { action: 'getTrackName', number: 3 },
            { action: 'getFolderName', number: 1 },
            { action: 'getFolderName', number: 2 }
        ]
    );
});

test('rejects invalid inventory sizes', () => {
    assert.throws(
        () => buildNameInventoryRequests(-1, 2),
        /numTracks must be a non-negative integer/u
    );
    assert.throws(
        () => buildNameInventoryRequests(1.5, 2),
        /numTracks must be a non-negative integer/u
    );
});
