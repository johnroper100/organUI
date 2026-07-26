'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    nextLocalMemoryLevel
} = require('../lib/memory-level-state');

test('tracks an explicitly selected local memory level', () => {
    assert.equal(
        nextLocalMemoryLevel('', '12', {
            action: 'gotoLocalLevel',
            number: 27
        }, 100),
        27
    );
});

test('steps a known local memory level and honors boundaries', () => {
    assert.equal(
        nextLocalMemoryLevel(20, '12', {
            action: 'localMemoryLevelUp',
            count: 3
        }, 100),
        23
    );
    assert.equal(
        nextLocalMemoryLevel(2, '12', {
            action: 'localMemoryLevelDown',
            count: 5
        }, 100),
        1
    );
    assert.equal(
        nextLocalMemoryLevel(99, '12', {
            action: 'localMemoryLevelUp',
            count: 5
        }, 100),
        100
    );
});

test('uses global feedback as the initial local stepping point', () => {
    assert.equal(
        nextLocalMemoryLevel('', '12', {
            action: 'localMemoryLevelDown'
        }, 100),
        11
    );
});

test('ignores unrelated commands and unknown starting levels', () => {
    assert.equal(
        nextLocalMemoryLevel(5, '12', { action: 'memoryLevelUp' }, 100),
        null
    );
    assert.equal(
        nextLocalMemoryLevel('', '', {
            action: 'localMemoryLevelUp'
        }, 100),
        null
    );
});
