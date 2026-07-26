'use strict';

function levelNumber(value, maxLevels) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= maxLevels
        ? number
        : null;
}

function nextLocalMemoryLevel(current, global, request, maxLevels = 9999) {
    const maximum = Number.isInteger(maxLevels) && maxLevels >= 1
        ? maxLevels
        : 9999;

    if (request?.action === 'gotoLocalLevel') {
        return levelNumber(request.number, maximum);
    }

    if (
        request?.action !== 'localMemoryLevelUp'
        && request?.action !== 'localMemoryLevelDown'
    ) {
        return null;
    }

    const startingLevel = levelNumber(current, maximum)
        ?? levelNumber(global, maximum);
    if (startingLevel === null) {
        return null;
    }

    const count = request.count === undefined ? 1 : Number(request.count);
    if (!Number.isInteger(count) || count < 1) {
        return null;
    }

    const direction = request.action === 'localMemoryLevelUp' ? 1 : -1;
    return Math.min(maximum, Math.max(1, startingLevel + direction * count));
}

module.exports = {
    nextLocalMemoryLevel
};
