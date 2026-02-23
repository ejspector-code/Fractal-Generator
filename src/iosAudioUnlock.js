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

async function unlockContext(ctx) {
    if (!ctx || ctx.state === 'closed') return false;
    if (ctx.state === 'running') {
        dlog('unlockContext: already running');
        return true;
    }

    dlog(`unlockContext: state=${ctx.state}, attempting resume...`);
    try {
        await ctx.resume();
        dlog(`unlockContext: after resume, state=${ctx.state}`);
    } catch (e) {
        dlog(`unlockContext: resume error: ${e.message}`);
    }

    // Play a silent buffer — key trick for iOS Safari
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

    // One more resume attempt
    if (ctx.state !== 'running') {
        try {
            await ctx.resume();
            dlog(`unlockContext: 2nd resume, state=${ctx.state}`);
        } catch (e) {
            dlog(`unlockContext: 2nd resume error: ${e.message}`);
        }
    }

    dlog(`unlockContext: final state=${ctx.state}`);
    return ctx.state === 'running';
}

export async function ensureUnlocked(ctx) {
    if (!ctx) return;
    dlog(`ensureUnlocked: starting, ctx.state=${ctx.state}`);
    registerContext(ctx);
    const ok = await unlockContext(ctx);
    if (ok) unlocked = true;
    dlog(`ensureUnlocked: result=${ok}, unlocked=${unlocked}`);
    return ok;
}

export function isUnlocked() {
    return unlocked;
}

async function onUserGesture() {
    dlog(`onUserGesture: ${contexts.size} contexts registered`);
    let anyRunning = false;
    for (const ctx of contexts) {
        if (ctx.state === 'closed') {
            contexts.delete(ctx);
            continue;
        }
        const ok = await unlockContext(ctx);
        if (ok) anyRunning = true;
    }
    if (anyRunning) {
        unlocked = true;
        const allRunning = [...contexts].every(c => c.state === 'running' || c.state === 'closed');
        if (allRunning) {
            dlog('onUserGesture: all contexts running, removing listeners');
            removeListeners();
        }
    }
}

function installListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    dlog('installListeners: adding gesture listeners');
    const opts = { capture: true, passive: true };
    document.addEventListener('touchstart', onUserGesture, opts);
    document.addEventListener('touchend', onUserGesture, opts);
    document.addEventListener('click', onUserGesture, opts);
    document.addEventListener('keydown', onUserGesture, opts);
}

function removeListeners() {
    if (!listenersInstalled) return;
    listenersInstalled = false;
    const opts = { capture: true, passive: true };
    document.removeEventListener('touchstart', onUserGesture, opts);
    document.removeEventListener('touchend', onUserGesture, opts);
    document.removeEventListener('click', onUserGesture, opts);
    document.removeEventListener('keydown', onUserGesture, opts);
}

