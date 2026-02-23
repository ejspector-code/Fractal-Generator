/**
 * iOS Audio Unlock — handles Safari's strict autoplay policy.
 */

/** @type {Set<AudioContext>} All registered contexts */
const contexts = new Set();
let unlocked = false;
let listenersInstalled = false;

function dlog(msg) {
    if (window.__audioDebugLog) window.__audioDebugLog(msg);
    else console.log('[iosUnlock]', msg);
}

export function registerContext(ctx) {
    if (ctx) contexts.add(ctx);
    dlog(`registerContext: state=${ctx?.state}, total=${contexts.size}`);
    installListeners();
}

export function unregisterContext(ctx) {
    contexts.delete(ctx);
}

function unlockContextSync(ctx) {
    if (!ctx || ctx.state === 'closed') return false;
    if (ctx.state === 'running') {
        dlog('unlockContext: already running');
        return true;
    }

    dlog(`unlockContext: state=${ctx.state}, attempting sync resume...`);

    // 1. Sync resume attempt (fire and forget)
    ctx.resume().then(() => {
        dlog(`unlockContext: resume resolved, state=${ctx.state}`);
    }).catch(e => {
        dlog(`unlockContext: resume error: ${e.message}`);
    });

    // 2. Play a silent buffer SYNCHRONOUSLY — key trick for iOS Safari
    try {
        const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        source.stop(ctx.currentTime + 0.001);
        dlog(`unlockContext: silent buffer played, state=${ctx.state}`);
    } catch (e) {
        dlog(`unlockContext: silent buffer error: ${e.message}`);
    }

    // 3. One more sync resume attempt just in case
    if (ctx.state !== 'running') {
        ctx.resume().catch(e => dlog(`unlockContext: 2nd resume error: ${e.message}`));
    }

    return ctx.state === 'running';
}

export function ensureUnlocked(ctx) {
    if (!ctx) return;
    dlog(`ensureUnlocked: starting, ctx.state=${ctx.state}`);
    registerContext(ctx);
    const ok = unlockContextSync(ctx);
    if (ok) unlocked = true;
    dlog(`ensureUnlocked: result=${ok}, unlocked=${unlocked}`);
    // Return a resolved promise for backwards compatibility since it used to be async
    return Promise.resolve(ok);
}

export function isUnlocked() {
    return unlocked;
}

let dummyCtx = null;

function onUserGesture() {
    dlog(`onUserGesture: ${contexts.size} contexts registered`);

    // Safari Web Audio unlock: creating and syncing a dummy context on first interaction
    // unlocks Web Audio globally for the entire page, resolving issues with async audio setups.
    if (!dummyCtx && contexts.size === 0) {
        dlog('onUserGesture: creating dummy context to globally unlock Web Audio');
        try {
            dummyCtx = new (window.AudioContext || window.webkitAudioContext)();
            unlockContextSync(dummyCtx);
            unlocked = true;
        } catch (e) {
            dlog(`onUserGesture: dummy context error: ${e.message}`);
        }
    }

    let anyRunning = false;
    for (const ctx of contexts) {
        if (ctx.state === 'closed') {
            contexts.delete(ctx);
            continue;
        }
        const ok = unlockContextSync(ctx);
        if (ok || ctx.state === 'running') anyRunning = true;
    }

    // Check after a brief delay to see if contexts are actually running after resume promises resolve
    setTimeout(() => {
        let allRunning = true;
        for (const ctx of contexts) {
            if (ctx.state !== 'running' && ctx.state !== 'closed') {
                allRunning = false;
            }
        }
        if (allRunning && contexts.size > 0) {
            unlocked = true;
            dlog('onUserGesture: all contexts running, removing listeners');
            removeListeners();
        }
    }, 100);
}

function installListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    dlog('installListeners: adding gesture listeners');
    const opts = { capture: true, passive: false };
    document.addEventListener('touchstart', onUserGesture, opts);
    document.addEventListener('touchend', onUserGesture, opts);
    document.addEventListener('click', onUserGesture, opts);
    document.addEventListener('keydown', onUserGesture, opts);
    document.addEventListener('pointerdown', onUserGesture, opts);
    document.addEventListener('mousedown', onUserGesture, opts);
}

function removeListeners() {
    if (!listenersInstalled) return;
    listenersInstalled = false;
    const opts = { capture: true, passive: false };
    document.removeEventListener('touchstart', onUserGesture, opts);
    document.removeEventListener('touchend', onUserGesture, opts);
    document.removeEventListener('click', onUserGesture, opts);
    document.removeEventListener('keydown', onUserGesture, opts);
    document.removeEventListener('pointerdown', onUserGesture, opts);
    document.removeEventListener('mousedown', onUserGesture, opts);
}

// Automatically install listeners on script load to catch the very first interaction
installListeners();

