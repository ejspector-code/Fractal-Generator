/**
 * Audio Debug Overlay — temporary on-screen console for iPad debugging.
 * Shows AudioContext state, touch events, and noteOn calls in a visible overlay.
 * Remove this file after debugging is complete.
 */

let overlay = null;
let logLines = [];
const MAX_LINES = 30;

function createOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'audio-debug-overlay';
    Object.assign(overlay.style, {
        position: 'fixed',
        bottom: '0',
        left: '0',
        right: '0',
        maxHeight: '200px',
        overflowY: 'auto',
        background: 'rgba(0,0,0,0.85)',
        color: '#0f0',
        fontFamily: 'monospace',
        fontSize: '11px',
        lineHeight: '1.3',
        padding: '6px 10px',
        zIndex: '999999',
        pointerEvents: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
    });
    document.body.appendChild(overlay);
}

export function debugLog(msg) {
    createOverlay();
    const ts = new Date().toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const line = `[${ts}] ${msg}`;
    logLines.push(line);
    if (logLines.length > MAX_LINES) logLines.shift();
    overlay.textContent = logLines.join('\n');
    overlay.scrollTop = overlay.scrollHeight;
    // Also log to real console
    console.log('[AudioDebug]', msg);
}

// Auto-init: log basic environment info
createOverlay();
debugLog(`UA: ${navigator.userAgent.slice(0, 80)}`);
debugLog(`Touch: ontouchstart=${'ontouchstart' in window} maxTouch=${navigator.maxTouchPoints}`);
debugLog(`AudioContext: ${typeof AudioContext !== 'undefined' ? 'yes' : 'no'} webkit: ${typeof webkitAudioContext !== 'undefined' ? 'yes' : 'no'}`);

// Add a Test Beep button
const btn = document.createElement('button');
btn.textContent = '🔊 TEST BEEP';
Object.assign(btn.style, {
    position: 'fixed',
    top: '40px',
    left: '10px',
    zIndex: '999999',
    padding: '12px 20px',
    fontSize: '16px',
    fontWeight: 'bold',
    background: '#ff4444',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
});
btn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    debugLog('TEST BEEP button tapped');
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        debugLog(`Test AC created, state=${ctx.state}`);
        ctx.resume().then(() => {
            debugLog(`Test AC resumed, state=${ctx.state}`);
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 440;
            gain.gain.value = 0.5;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
            debugLog('Test beep playing now');
        }).catch(err => {
            debugLog(`Test AC resume failed: ${err.message}`);
        });
    } catch (err) {
        debugLog(`Test beep error: ${err.message}`);
    }
}, { passive: false });
btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    debugLog('TEST BEEP button clicked (mouse)');
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        ctx.resume().then(() => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 440;
            gain.gain.value = 0.5;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
            debugLog('Test beep playing now (mouse)');
        });
    } catch (err) {
        debugLog(`Test beep error: ${err.message}`);
    }
});
document.body.appendChild(btn);

// Monkey-patch AudioContext to track all instances
const OrigAC = window.AudioContext || window.webkitAudioContext;
if (OrigAC) {
    const origResume = OrigAC.prototype.resume;
    OrigAC.prototype.resume = function () {
        debugLog(`AC.resume() called, current state: ${this.state}`);
        return origResume.call(this).then(() => {
            debugLog(`AC.resume() resolved, new state: ${this.state}`);
        }).catch(err => {
            debugLog(`AC.resume() FAILED: ${err.message}`);
            throw err;
        });
    };

    // Track state changes
    const origConstructor = OrigAC;
    const patchedAC = function (...args) {
        const ctx = new origConstructor(...args);
        debugLog(`NEW AudioContext created, state: ${ctx.state}, sampleRate: ${ctx.sampleRate}`);
        ctx.addEventListener('statechange', () => {
            debugLog(`AC statechange → ${ctx.state}`);
        });
        return ctx;
    };
    // Can't override constructor easily, but we can track via iosAudioUnlock
}

// Track all touch events on document
document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY);
    debugLog(`TOUCH START (${Math.round(t.clientX)},${Math.round(t.clientY)}) target: ${el?.id || el?.tagName}`);
}, { capture: true, passive: true });

document.addEventListener('click', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    debugLog(`CLICK (${Math.round(e.clientX)},${Math.round(e.clientY)}) target: ${el?.id || el?.tagName}`);
}, { capture: true });

// Expose globally for other modules to use
window.__audioDebugLog = debugLog;
