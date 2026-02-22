/**
 * iOS Audio Unlock — handles Safari's strict autoplay policy.
 *
 * iOS Safari suspends AudioContext until a user gesture triggers BOTH
 * a resume() AND a silent buffer playback. This module manages that
 * unlock globally, tracking all AudioContexts created by the app.
 *
 * Usage:
 *   import { registerContext, ensureUnlocked, isUnlocked } from './iosAudioUnlock.js';
 *   const ctx = new AudioContext();
 *   registerContext(ctx);
 *   await ensureUnlocked(ctx);
 */

/** @type {Set<AudioContext>} All registered contexts */
const contexts = new Set();

/** @type {boolean} Whether we've completed at least one successful unlock */
let unlocked = false;

/** @type {boolean} Whether listeners are installed */
let listenersInstalled = false;

/**
 * Register an AudioContext so it will be unlocked on next user gesture.
 */
export function registerContext(ctx) {
    if (ctx) contexts.add(ctx);
    installListeners();
}

/**
 * Remove a context (call when closing/cleaning up).
 */
export function unregisterContext(ctx) {
    contexts.delete(ctx);
}

/**
 * Try to unlock a specific context right now.
 * Returns true if the context is running after the attempt.
 */
async function unlockContext(ctx) {
    if (!ctx || ctx.state === 'closed') return false;
    if (ctx.state === 'running') return true;

    try {
        await ctx.resume();
    } catch (e) {
        // ignore
    }

    // Play a silent buffer — this is the key trick for iOS Safari
    try {
        const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        source.stop(ctx.currentTime + 0.001);
    } catch (e) {
        // ignore — context might not be fully ready
    }

    // One more resume attempt after the silent buffer
    if (ctx.state !== 'running') {
        try {
            await ctx.resume();
        } catch (e) {
            // ignore
        }
    }

    return ctx.state === 'running';
}

/**
 * Ensure a specific AudioContext is unlocked.
 * Call this right after creating a context inside a user gesture handler.
 */
export async function ensureUnlocked(ctx) {
    if (!ctx) return;
    registerContext(ctx);
    const ok = await unlockContext(ctx);
    if (ok) unlocked = true;
    return ok;
}

/**
 * @returns {boolean} Whether at least one context has been successfully unlocked.
 */
export function isUnlocked() {
    return unlocked;
}

/**
 * User gesture handler — tries to unlock ALL registered contexts.
 */
async function onUserGesture() {
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
        // Remove listeners once all contexts are running — but keep them
        // if some are still suspended (user might need to tap again)
        const allRunning = [...contexts].every(c => c.state === 'running' || c.state === 'closed');
        if (allRunning) {
            removeListeners();
        }
    }
}

function installListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;
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
