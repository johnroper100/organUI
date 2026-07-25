(() => {
    const root = document.getElementById('app');
    if (!root || !window.PointerEvent) {
        return;
    }

    const activePointers = new Map();

    function isNonTouchPointer(event) {
        return event.pointerType === 'mouse' || event.pointerType === 'pen';
    }

    function dispatchTouchEvent(target, type) {
        target.dispatchEvent(new Event(type, {
            bubbles: true,
            cancelable: true
        }));
    }

    root.addEventListener('pointerdown', (event) => {
        if (!isNonTouchPointer(event)) {
            return;
        }

        activePointers.set(event.pointerId, event.target);
        dispatchTouchEvent(event.target, 'touchstart');
    });

    function releasePointer(event) {
        const target = activePointers.get(event.pointerId);
        if (!target) {
            return;
        }

        activePointers.delete(event.pointerId);
        dispatchTouchEvent(target, 'touchend');
    }

    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
})();
