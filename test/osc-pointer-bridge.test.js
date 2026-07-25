'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

class FakeEvent {
    constructor(type, options = {}) {
        this.type = type;
        this.bubbles = options.bubbles ?? false;
        this.cancelable = options.cancelable ?? false;
        this.pointerId = options.pointerId;
        this.pointerType = options.pointerType;
        this.target = options.target;
    }
}

class FakeEventTarget {
    constructor(parent = null) {
        this.parent = parent;
        this.listeners = new Map();
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    dispatchEvent(event) {
        if (!event.target) {
            event.target = this;
        }

        for (const listener of this.listeners.get(event.type) ?? []) {
            listener(event);
        }

        if (event.bubbles && this.parent) {
            this.parent.dispatchEvent(event);
        }

        return true;
    }
}

function loadBridge() {
    const window = new FakeEventTarget();
    window.PointerEvent = class PointerEvent {};
    const root = new FakeEventTarget(window);
    const document = {
        getElementById(id) {
            return id === 'app' ? root : null;
        }
    };
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'static', 'js', 'osc-pointer-bridge.js'),
        'utf8'
    );

    vm.runInNewContext(source, { document, window, Event: FakeEvent });
    return { root, window };
}

test('bridges mouse press and release to existing touch handlers', () => {
    const { root, window } = loadBridge();
    const button = new FakeEventTarget(root);
    const received = [];

    button.addEventListener('touchstart', () => received.push('press'));
    button.addEventListener('touchend', () => received.push('release'));

    root.dispatchEvent(new FakeEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'mouse',
        target: button
    }));
    window.dispatchEvent(new FakeEvent('pointerup', {
        pointerId: 1,
        pointerType: 'mouse'
    }));

    assert.deepEqual(received, ['press', 'release']);
});

test('leaves native touch pointers alone', () => {
    const { root, window } = loadBridge();
    const button = new FakeEventTarget(root);
    const received = [];

    button.addEventListener('touchstart', () => received.push('press'));
    button.addEventListener('touchend', () => received.push('release'));

    root.dispatchEvent(new FakeEvent('pointerdown', {
        pointerId: 2,
        pointerType: 'touch',
        target: button
    }));
    window.dispatchEvent(new FakeEvent('pointerup', {
        pointerId: 2,
        pointerType: 'touch'
    }));

    assert.deepEqual(received, []);
});

test('releases the original control when the pointer ends elsewhere', () => {
    const { root, window } = loadBridge();
    const button = new FakeEventTarget(root);
    const elsewhere = new FakeEventTarget(root);
    let releases = 0;

    button.addEventListener('touchend', () => {
        releases += 1;
    });

    root.dispatchEvent(new FakeEvent('pointerdown', {
        pointerId: 3,
        pointerType: 'pen',
        target: button
    }));
    window.dispatchEvent(new FakeEvent('pointercancel', {
        pointerId: 3,
        pointerType: 'pen',
        target: elsewhere
    }));

    assert.equal(releases, 1);
});
