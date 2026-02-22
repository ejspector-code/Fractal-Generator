/**
 * Guitar Simulator — Karplus-Strong string synthesis using Web Audio API.
 * Produces realistic plucked-string tones entirely via synthesis (no samples).
 *
 * Features:
 *   - 6-string guitar with configurable tunings
 *   - Karplus-Strong delay-line synthesis with lowpass filtered feedback
 *   - Chord shape library (~12 common open chords)
 *   - Strum with per-string delay for realism
 *   - Independent audio chain: output → filter → masterGain → analyser → destination
 *   - Can run alongside the MIDI keyboard simultaneously
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const FFT_SIZE = 2048;
const SMOOTHING = 0.8;
const NUM_STRINGS = 6;

// ── Tunings (frequencies for strings 6→1, i.e. low E to high E) ──────────────

const TUNINGS = {
    standard: { label: 'Standard', notes: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], freqs: [82.41, 110.00, 146.83, 196.00, 246.94, 329.63] },
    dropD: { label: 'Drop D', notes: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'], freqs: [73.42, 110.00, 146.83, 196.00, 246.94, 329.63] },
    openG: { label: 'Open G', notes: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'], freqs: [73.42, 98.00, 146.83, 196.00, 246.94, 293.66] },
    dadgad: { label: 'DADGAD', notes: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'], freqs: [73.42, 110.00, 146.83, 196.00, 220.00, 293.66] },
};

// ── Chord Shapes ──────────────────────────────────────────────────────────────
// Each shape is an array of 6 fret numbers (strings 6→1).
// -1 = muted string, 0 = open string.

const CHORD_SHAPES = {
    'None': [0, 0, 0, 0, 0, 0],
    'C': [-1, 3, 2, 0, 1, 0],
    'D': [-1, -1, 0, 2, 3, 2],
    'E': [0, 2, 2, 1, 0, 0],
    'F': [1, 3, 3, 2, 1, 1],
    'G': [3, 2, 0, 0, 0, 3],
    'A': [-1, 0, 2, 2, 2, 0],
    'Am': [-1, 0, 2, 2, 1, 0],
    'Bm': [-1, 2, 4, 4, 3, 2],
    'Dm': [-1, -1, 0, 2, 3, 1],
    'Em': [0, 2, 2, 0, 0, 0],
    'A7': [-1, 0, 2, 0, 2, 0],
    'D7': [-1, -1, 0, 2, 1, 2],
};

// ── State ─────────────────────────────────────────────────────────────────────

let audioCtx = null;
let analyser = null;
let masterGain = null;
let inputGain = null; // where strings connect → feeds into pedal chain
let frequencyData = null;
let timeDomainData = null;
let active = false;
let currentTuning = 'standard';
let currentChord = 'None';
let guitarVolume = 0.6;

// Track which strings are currently vibrating (for visualization)
const stringStates = new Array(NUM_STRINGS).fill(null);

let onPluckCallback = null;

// ── Pedal State & Nodes ───────────────────────────────────────────────────────

const pedals = {
    overdrive: {
        enabled: true, drive: 2.0, tone: 3000,
        node: null, toneFilter: null, dryGain: null, wetGain: null, merge: null,
    },
    chorus: {
        enabled: false, rate: 1.5, depth: 0.004,
        delayNode: null, lfo: null, lfoGain: null, dryGain: null, wetGain: null, merge: null,
    },
    phaser: {
        enabled: false, rate: 0.5, depth: 1500,
        filters: [], lfo: null, lfoGain: null, dryGain: null, wetGain: null, merge: null,
    },
    delay: {
        enabled: false, time: 0.35, feedback: 0.4, mix: 0.3,
        delayNode: null, feedbackGain: null, dryGain: null, wetGain: null, merge: null,
    },
    reverb: {
        enabled: false, decay: 2.0, mix: 0.3,
        convolver: null, dryGain: null, wetGain: null, merge: null,
    },
    tremolo: {
        enabled: false, rate: 5.0, depth: 0.6,
        lfo: null, lfoGain: null, tremGain: null, dryGain: null, wetGain: null, merge: null,
    },
};

// ── Karplus-Strong String Synthesis ───────────────────────────────────────────

/**
 * Pluck a single string using Karplus-Strong synthesis.
 * @param {number} stringIndex — 0-based string index (0 = low E, 5 = high E)
 * @param {number} [velocity=0.8] — pluck strength 0–1
 * @param {number} [fret=0] — fret number (shifts pitch up)
 */
function karplusStrongPluck(stringIndex, velocity = 0.8, fret = 0) {
    if (!audioCtx || !active) return;

    const tuning = TUNINGS[currentTuning];
    if (!tuning) return;

    const baseFreq = tuning.freqs[stringIndex];
    if (!baseFreq) return;

    // Apply fret: each fret raises pitch by one semitone
    const freq = baseFreq * Math.pow(2, fret / 12);
    const sampleRate = audioCtx.sampleRate;
    const bufferSize = Math.round(sampleRate / freq);

    // Create noise burst buffer (excitation)
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);

    // Shape the noise for different tonal qualities
    // Electric guitar: bright, snappy attack across all strings
    const brightness = 0.6 + (stringIndex / NUM_STRINGS) * 0.3;
    for (let i = 0; i < bufferSize; i++) {
        const raw = Math.random() * 2 - 1;
        // Shape excitation: mix of impulse-like attack and noise
        const shaped = i < bufferSize * 0.3 ? raw * 1.2 : raw * 0.8;
        noiseData[i] = shaped * velocity;
    }

    // Electric pickups: minimal smoothing, keep the bite
    if (stringIndex < 2) {
        // Only very slight smoothing on the lowest strings
        for (let i = 1; i < bufferSize; i++) {
            noiseData[i] = noiseData[i] * 0.8 + noiseData[i - 1] * 0.2;
        }
    }

    // Electric guitar: tighter decay, more sustain before fade
    const decaySeconds = 1.0 + (1 - stringIndex / NUM_STRINGS) * 1.5;
    const totalSamples = Math.ceil(sampleRate * decaySeconds);
    const outputBuffer = audioCtx.createBuffer(1, totalSamples, sampleRate);
    const output = outputBuffer.getChannelData(0);

    // Initialize with excitation noise
    for (let i = 0; i < bufferSize && i < totalSamples; i++) {
        output[i] = noiseData[i];
    }

    // Karplus-Strong feedback — electric: high damping (long sustain), bright blend
    const dampingFactor = 0.998 - (stringIndex * 0.0005); // very high sustain
    const blendFactor = 0.55 + brightness * 0.15; // brighter = more high-freq content survives

    for (let i = bufferSize; i < totalSamples; i++) {
        const prev = output[i - bufferSize];
        const prevNext = output[i - bufferSize + 1] || output[i - bufferSize];
        output[i] = dampingFactor * (blendFactor * prev + (1 - blendFactor) * prevNext);
    }

    // Play the synthesized string
    const source = audioCtx.createBufferSource();
    source.buffer = outputBuffer;

    const stringGain = audioCtx.createGain();
    stringGain.gain.setValueAtTime(velocity * 0.6, audioCtx.currentTime);

    source.connect(stringGain);
    stringGain.connect(inputGain || masterGain);

    source.start(audioCtx.currentTime);
    source.stop(audioCtx.currentTime + decaySeconds);

    // Track vibrating state for visualization
    stringStates[stringIndex] = {
        startTime: performance.now(),
        decay: decaySeconds * 1000,
        velocity,
    };

    // Clear state after decay
    setTimeout(() => {
        if (stringStates[stringIndex] && stringStates[stringIndex].startTime <= performance.now() - stringStates[stringIndex].decay + 100) {
            stringStates[stringIndex] = null;
        }
    }, decaySeconds * 1000 + 100);

    if (onPluckCallback) {
        onPluckCallback({ type: 'pluck', string: stringIndex, fret, freq, velocity });
    }

    return source;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDistortionCurve(amount) {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < samples; i++) {
        const x = (i * 2 / samples) - 1;
        curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
}

function generateReverbIR(decay) {
    const rate = audioCtx.sampleRate;
    const len = rate * Math.max(0.5, decay);
    const buf = audioCtx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
            d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay * 1.2);
        }
    }
    return buf;
}

// ── Build Pedal Chain ─────────────────────────────────────────────────────────

function buildPedalChain() {
    const t = audioCtx.currentTime;

    // ── 1. Overdrive ──
    const od = pedals.overdrive;
    od.node = audioCtx.createWaveShaper();
    od.node.curve = makeDistortionCurve(od.drive);
    od.node.oversample = '4x';
    od.toneFilter = audioCtx.createBiquadFilter();
    od.toneFilter.type = 'lowpass';
    od.toneFilter.frequency.setValueAtTime(od.tone, t);
    od.toneFilter.Q.setValueAtTime(0.7, t);
    od.merge = audioCtx.createGain();
    od.dryGain = audioCtx.createGain();
    od.wetGain = audioCtx.createGain();
    od.dryGain.gain.setValueAtTime(od.enabled ? 0 : 1, t);
    od.wetGain.gain.setValueAtTime(od.enabled ? 1 : 0, t);

    // ── 2. Chorus ──
    const ch = pedals.chorus;
    ch.delayNode = audioCtx.createDelay(0.05);
    ch.delayNode.delayTime.setValueAtTime(0.015, t);
    ch.lfo = audioCtx.createOscillator();
    ch.lfo.type = 'sine';
    ch.lfo.frequency.setValueAtTime(ch.rate, t);
    ch.lfoGain = audioCtx.createGain();
    ch.lfoGain.gain.setValueAtTime(ch.depth, t);
    ch.lfo.connect(ch.lfoGain);
    ch.lfoGain.connect(ch.delayNode.delayTime);
    ch.lfo.start();
    ch.merge = audioCtx.createGain();
    ch.dryGain = audioCtx.createGain();
    ch.wetGain = audioCtx.createGain();
    ch.dryGain.gain.setValueAtTime(1, t);
    ch.wetGain.gain.setValueAtTime(ch.enabled ? 0.6 : 0, t);

    // ── 3. Phaser ──
    const ph = pedals.phaser;
    ph.filters = [];
    for (let i = 0; i < 4; i++) {
        const ap = audioCtx.createBiquadFilter();
        ap.type = 'allpass';
        ap.frequency.setValueAtTime(1000 + i * 500, t);
        ap.Q.setValueAtTime(5, t);
        ph.filters.push(ap);
    }
    ph.lfo = audioCtx.createOscillator();
    ph.lfo.type = 'sine';
    ph.lfo.frequency.setValueAtTime(ph.rate, t);
    ph.lfoGain = audioCtx.createGain();
    ph.lfoGain.gain.setValueAtTime(ph.depth, t);
    ph.lfo.connect(ph.lfoGain);
    ph.filters.forEach(f => ph.lfoGain.connect(f.frequency));
    ph.lfo.start();
    // Chain allpass filters
    for (let i = 0; i < ph.filters.length - 1; i++) {
        ph.filters[i].connect(ph.filters[i + 1]);
    }
    ph.merge = audioCtx.createGain();
    ph.dryGain = audioCtx.createGain();
    ph.wetGain = audioCtx.createGain();
    ph.dryGain.gain.setValueAtTime(1, t);
    ph.wetGain.gain.setValueAtTime(ph.enabled ? 0.7 : 0, t);

    // ── 4. Delay ──
    const dl = pedals.delay;
    dl.delayNode = audioCtx.createDelay(5.0);
    dl.delayNode.delayTime.setValueAtTime(dl.time, t);
    dl.feedbackGain = audioCtx.createGain();
    dl.feedbackGain.gain.setValueAtTime(dl.feedback, t);
    dl.delayNode.connect(dl.feedbackGain);
    dl.feedbackGain.connect(dl.delayNode);
    dl.merge = audioCtx.createGain();
    dl.dryGain = audioCtx.createGain();
    dl.wetGain = audioCtx.createGain();
    dl.dryGain.gain.setValueAtTime(1, t);
    dl.wetGain.gain.setValueAtTime(dl.enabled ? dl.mix : 0, t);

    // ── 5. Reverb ──
    const rv = pedals.reverb;
    rv.convolver = audioCtx.createConvolver();
    rv.convolver.buffer = generateReverbIR(rv.decay);
    rv.merge = audioCtx.createGain();
    rv.dryGain = audioCtx.createGain();
    rv.wetGain = audioCtx.createGain();
    rv.dryGain.gain.setValueAtTime(1, t);
    rv.wetGain.gain.setValueAtTime(rv.enabled ? rv.mix : 0, t);

    // ── 6. Tremolo ──
    const tr = pedals.tremolo;
    tr.tremGain = audioCtx.createGain();
    tr.tremGain.gain.setValueAtTime(1, t);
    tr.lfo = audioCtx.createOscillator();
    tr.lfo.type = 'sine';
    tr.lfo.frequency.setValueAtTime(tr.rate, t);
    tr.lfoGain = audioCtx.createGain();
    tr.lfoGain.gain.setValueAtTime(tr.enabled ? tr.depth : 0, t);
    tr.lfo.connect(tr.lfoGain);
    tr.lfoGain.connect(tr.tremGain.gain);
    tr.lfo.start();
    tr.merge = audioCtx.createGain();
    tr.dryGain = audioCtx.createGain();
    tr.wetGain = audioCtx.createGain();
    tr.dryGain.gain.setValueAtTime(tr.enabled ? 0 : 1, t);
    tr.wetGain.gain.setValueAtTime(tr.enabled ? 1 : 0, t);

    // ── Wire the chain ──────────────────────────────────────────────────────
    // inputGain → overdrive → chorus → phaser → delay → reverb → tremolo → masterGain

    // Overdrive
    inputGain.connect(od.node);
    od.node.connect(od.toneFilter);
    od.toneFilter.connect(od.wetGain);
    od.wetGain.connect(od.merge);
    inputGain.connect(od.dryGain);
    od.dryGain.connect(od.merge);

    // Chorus
    od.merge.connect(ch.delayNode);
    ch.delayNode.connect(ch.wetGain);
    ch.wetGain.connect(ch.merge);
    od.merge.connect(ch.dryGain);
    ch.dryGain.connect(ch.merge);

    // Phaser
    ch.merge.connect(ph.filters[0]);
    ph.filters[ph.filters.length - 1].connect(ph.wetGain);
    ph.wetGain.connect(ph.merge);
    ch.merge.connect(ph.dryGain);
    ph.dryGain.connect(ph.merge);

    // Delay
    ph.merge.connect(dl.delayNode);
    dl.delayNode.connect(dl.wetGain);
    dl.wetGain.connect(dl.merge);
    ph.merge.connect(dl.dryGain);
    dl.dryGain.connect(dl.merge);

    // Reverb
    dl.merge.connect(rv.convolver);
    rv.convolver.connect(rv.wetGain);
    rv.wetGain.connect(rv.merge);
    dl.merge.connect(rv.dryGain);
    rv.dryGain.connect(rv.merge);

    // Tremolo
    rv.merge.connect(tr.tremGain);
    tr.tremGain.connect(tr.wetGain);
    tr.wetGain.connect(tr.merge);
    rv.merge.connect(tr.dryGain);
    tr.dryGain.connect(tr.merge);

    // Final output
    tr.merge.connect(masterGain);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the guitar audio engine with full pedal effects chain.
 */
export async function startGuitar() {
    if (active) return { ok: true };

    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // Input gain — where all strings connect
        inputGain = audioCtx.createGain();
        inputGain.gain.setValueAtTime(1.0, audioCtx.currentTime);

        // Master gain
        masterGain = audioCtx.createGain();
        masterGain.gain.setValueAtTime(guitarVolume, audioCtx.currentTime);

        // Analyser for audio-reactive integration
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = SMOOTHING;

        // Build pedal effects chain
        buildPedalChain();

        // masterGain → analyser → destination
        masterGain.connect(analyser);
        analyser.connect(audioCtx.destination);

        frequencyData = new Uint8Array(analyser.frequencyBinCount);
        timeDomainData = new Uint8Array(analyser.fftSize);

        active = true;
        return { ok: true };
    } catch (err) {
        console.error('[Guitar] Failed to start:', err);
        cleanup();
        return { ok: false, error: err.message || 'Unknown error' };
    }
}

/**
 * Stop the guitar audio engine and release resources.
 */
export function stopGuitar() {
    cleanup();
}

function cleanup() {
    cancelRiff();
    active = false;
    // Stop LFOs
    try { pedals.chorus.lfo?.stop(); } catch (e) { }
    try { pedals.phaser.lfo?.stop(); } catch (e) { }
    try { pedals.tremolo.lfo?.stop(); } catch (e) { }
    if (audioCtx) {
        audioCtx.close().catch(() => { });
        audioCtx = null;
    }
    analyser = null;
    masterGain = null;
    inputGain = null;
    frequencyData = null;
    timeDomainData = null;
    stringStates.fill(null);
    // Reset node references
    for (const p of Object.values(pedals)) {
        for (const key of Object.keys(p)) {
            if (key !== 'enabled' && key !== 'drive' && key !== 'tone' && key !== 'rate' && key !== 'depth' && key !== 'time' && key !== 'feedback' && key !== 'mix' && key !== 'decay') {
                p[key] = (key === 'filters') ? [] : null;
            }
        }
    }
}

/**
 * Pluck a single string.
 * @param {number} stringIndex  0 (low E) through 5 (high E)
 * @param {number} [velocity]   0–1, defaults to 0.8
 */
export function pluckString(stringIndex, velocity = 0.8) {
    if (stringIndex < 0 || stringIndex >= NUM_STRINGS) return;

    const chord = CHORD_SHAPES[currentChord];
    const fret = chord ? chord[stringIndex] : 0;

    // If string is muted in current chord, don't pluck
    if (fret === -1) return;

    karplusStrongPluck(stringIndex, velocity, fret);
}

/**
 * Strum all (non-muted) strings with per-string timing delay.
 * @param {'down'|'up'} direction — strum direction
 * @param {number} [velocity=0.7] — strum strength
 * @param {number} [spreadMs=30] — delay between strings in ms
 */
export function strumChord(direction = 'down', velocity = 0.7, spreadMs = 30) {
    if (!active || !audioCtx) return;

    const chord = CHORD_SHAPES[currentChord] || CHORD_SHAPES['None'];
    const order = direction === 'down'
        ? [0, 1, 2, 3, 4, 5]
        : [5, 4, 3, 2, 1, 0];

    let delay = 0;
    for (const i of order) {
        const fret = chord[i];
        if (fret === -1) continue; // skip muted strings

        // Slight velocity variation for realism
        const v = velocity * (0.85 + Math.random() * 0.15);

        setTimeout(() => {
            karplusStrongPluck(i, v, fret);
        }, delay);

        delay += spreadMs + Math.random() * 10;
    }
}

// ── Getters ───────────────────────────────────────────────────────────────────

export function isGuitarActive() {
    return active;
}

export function getGuitarFrequencyData() {
    if (!active || !analyser || !frequencyData) return null;
    analyser.getByteFrequencyData(frequencyData);
    return frequencyData;
}

export function getGuitarTimeDomainData() {
    if (!active || !analyser || !timeDomainData) return null;
    analyser.getByteTimeDomainData(timeDomainData);
    return timeDomainData;
}

export function getGuitarSampleRate() {
    return audioCtx ? audioCtx.sampleRate : 44100;
}

export function getGuitarBinCount() {
    return analyser ? analyser.frequencyBinCount : FFT_SIZE / 2;
}

export function getStringStates() {
    return stringStates;
}

export function getCurrentTuningInfo() {
    return TUNINGS[currentTuning];
}

// ── Setters ───────────────────────────────────────────────────────────────────

export function setGuitarTuning(tuningKey) {
    if (TUNINGS[tuningKey]) {
        currentTuning = tuningKey;
    }
}

export function setGuitarChord(chordName) {
    if (chordName in CHORD_SHAPES) {
        currentChord = chordName;
    }
}

export function setGuitarVolume(v) {
    guitarVolume = Math.max(0, Math.min(1, v));
    if (masterGain && audioCtx) {
        masterGain.gain.setTargetAtTime(guitarVolume, audioCtx.currentTime, 0.02);
    }
}

export function setPluckCallback(cb) {
    onPluckCallback = cb;
}

// ── Lists for UI ──────────────────────────────────────────────────────────────

export function getTunings() {
    return Object.entries(TUNINGS).map(([key, val]) => ({ key, label: val.label }));
}

export function getChordNames() {
    return Object.keys(CHORD_SHAPES);
}

export function getCurrentChord() {
    return currentChord;
}

export function getChordShape(name) {
    return CHORD_SHAPES[name] || null;
}

// ── Pre-Built Riffs ───────────────────────────────────────────────────────────
// Each riff is an array of steps: { string, fret, delay (ms before this note), velocity }
// string: 0=low E, 5=high E. delay: time to wait BEFORE playing this note.

const RIFFS = {
    'none': { label: 'None', steps: [] },
    'blues_shuffle': {
        label: 'Blues Shuffle',
        steps: [
            { string: 0, fret: 0, delay: 0, velocity: 0.8 },
            { string: 0, fret: 0, delay: 200, velocity: 0.6 },
            { string: 0, fret: 2, delay: 200, velocity: 0.7 },
            { string: 0, fret: 4, delay: 200, velocity: 0.8 },
            { string: 0, fret: 2, delay: 200, velocity: 0.7 },
            { string: 0, fret: 0, delay: 200, velocity: 0.6 },
            { string: 1, fret: 0, delay: 300, velocity: 0.8 },
            { string: 1, fret: 2, delay: 200, velocity: 0.7 },
            { string: 1, fret: 4, delay: 200, velocity: 0.8 },
            { string: 1, fret: 2, delay: 200, velocity: 0.7 },
        ]
    },
    'smoke_water': {
        label: 'Smoke on the Water',
        steps: [
            { string: 3, fret: 0, delay: 0, velocity: 0.8 },
            { string: 2, fret: 0, delay: 0, velocity: 0.8 },
            { string: 3, fret: 3, delay: 400, velocity: 0.8 },
            { string: 2, fret: 3, delay: 0, velocity: 0.8 },
            { string: 3, fret: 5, delay: 400, velocity: 0.9 },
            { string: 2, fret: 5, delay: 0, velocity: 0.9 },
            { string: 3, fret: 0, delay: 600, velocity: 0.8 },
            { string: 2, fret: 0, delay: 0, velocity: 0.8 },
            { string: 3, fret: 3, delay: 400, velocity: 0.8 },
            { string: 2, fret: 3, delay: 0, velocity: 0.8 },
            { string: 3, fret: 6, delay: 400, velocity: 0.9 },
            { string: 2, fret: 6, delay: 0, velocity: 0.9 },
            { string: 3, fret: 5, delay: 300, velocity: 0.8 },
            { string: 2, fret: 5, delay: 0, velocity: 0.8 },
        ]
    },
    'sunshine': {
        label: 'Sunshine of Your Love',
        steps: [
            { string: 2, fret: 0, delay: 0, velocity: 0.8 },
            { string: 2, fret: 3, delay: 250, velocity: 0.7 },
            { string: 2, fret: 5, delay: 250, velocity: 0.8 },
            { string: 1, fret: 3, delay: 250, velocity: 0.9 },
            { string: 2, fret: 0, delay: 350, velocity: 0.8 },
            { string: 2, fret: 3, delay: 250, velocity: 0.7 },
            { string: 1, fret: 0, delay: 250, velocity: 0.8 },
            { string: 1, fret: 2, delay: 350, velocity: 0.7 },
        ]
    },
    'fingerpick_em': {
        label: 'Em Fingerpick',
        steps: [
            { string: 0, fret: 0, delay: 0, velocity: 0.7 },
            { string: 3, fret: 0, delay: 200, velocity: 0.5 },
            { string: 4, fret: 0, delay: 150, velocity: 0.5 },
            { string: 5, fret: 0, delay: 150, velocity: 0.6 },
            { string: 4, fret: 0, delay: 150, velocity: 0.5 },
            { string: 3, fret: 0, delay: 150, velocity: 0.5 },
            { string: 1, fret: 2, delay: 200, velocity: 0.7 },
            { string: 3, fret: 0, delay: 200, velocity: 0.5 },
            { string: 4, fret: 0, delay: 150, velocity: 0.5 },
            { string: 5, fret: 0, delay: 150, velocity: 0.6 },
            { string: 4, fret: 0, delay: 150, velocity: 0.5 },
            { string: 3, fret: 0, delay: 150, velocity: 0.5 },
        ]
    },
    'power_chord': {
        label: 'Power Chord Punk',
        steps: [
            { string: 0, fret: 0, delay: 0, velocity: 0.9 },
            { string: 1, fret: 2, delay: 10, velocity: 0.9 },
            { string: 2, fret: 2, delay: 10, velocity: 0.9 },
            { string: 0, fret: 0, delay: 250, velocity: 0.7 },
            { string: 1, fret: 2, delay: 10, velocity: 0.7 },
            { string: 0, fret: 3, delay: 300, velocity: 0.9 },
            { string: 1, fret: 5, delay: 10, velocity: 0.9 },
            { string: 2, fret: 5, delay: 10, velocity: 0.9 },
            { string: 0, fret: 5, delay: 300, velocity: 0.9 },
            { string: 1, fret: 7, delay: 10, velocity: 0.9 },
            { string: 2, fret: 7, delay: 10, velocity: 0.9 },
            { string: 0, fret: 3, delay: 300, velocity: 0.8 },
            { string: 1, fret: 5, delay: 10, velocity: 0.8 },
        ]
    },
    'spanish': {
        label: 'Spanish Romance',
        steps: [
            { string: 5, fret: 0, delay: 0, velocity: 0.6 },
            { string: 4, fret: 1, delay: 180, velocity: 0.5 },
            { string: 3, fret: 0, delay: 180, velocity: 0.5 },
            { string: 4, fret: 1, delay: 180, velocity: 0.5 },
            { string: 5, fret: 0, delay: 180, velocity: 0.6 },
            { string: 4, fret: 1, delay: 180, velocity: 0.5 },
            { string: 0, fret: 0, delay: 250, velocity: 0.7 },
            { string: 5, fret: 1, delay: 180, velocity: 0.6 },
            { string: 4, fret: 1, delay: 180, velocity: 0.5 },
            { string: 3, fret: 0, delay: 180, velocity: 0.5 },
            { string: 4, fret: 1, delay: 180, velocity: 0.5 },
            { string: 5, fret: 1, delay: 180, velocity: 0.6 },
        ]
    },
    'redemption': {
        label: 'Reggae Skank',
        steps: [
            // Offbeat strum pattern
            { string: 3, fret: 2, delay: 0, velocity: 0.5 },
            { string: 4, fret: 3, delay: 10, velocity: 0.5 },
            { string: 5, fret: 2, delay: 10, velocity: 0.5 },
            { string: 3, fret: 2, delay: 280, velocity: 0.7 },
            { string: 4, fret: 3, delay: 10, velocity: 0.7 },
            { string: 5, fret: 2, delay: 10, velocity: 0.7 },
            { string: 3, fret: 0, delay: 300, velocity: 0.5 },
            { string: 4, fret: 1, delay: 10, velocity: 0.5 },
            { string: 5, fret: 0, delay: 10, velocity: 0.5 },
            { string: 3, fret: 0, delay: 280, velocity: 0.7 },
            { string: 4, fret: 1, delay: 10, velocity: 0.7 },
            { string: 5, fret: 0, delay: 10, velocity: 0.7 },
        ]
    },
    'walking_bass': {
        label: 'Walking Bass',
        steps: [
            { string: 0, fret: 0, delay: 0, velocity: 0.8 },
            { string: 0, fret: 3, delay: 300, velocity: 0.7 },
            { string: 0, fret: 5, delay: 300, velocity: 0.8 },
            { string: 1, fret: 0, delay: 300, velocity: 0.7 },
            { string: 1, fret: 2, delay: 300, velocity: 0.8 },
            { string: 1, fret: 4, delay: 300, velocity: 0.7 },
            { string: 0, fret: 5, delay: 300, velocity: 0.8 },
            { string: 0, fret: 3, delay: 300, velocity: 0.7 },
        ]
    },
};

// ── Riff Playback Engine ──────────────────────────────────────────────────────

let currentRiff = 'none';
let riffPlaying = false;
let riffTimeouts = [];
let riffLooping = true;
let riffBPM = 120;
const BASE_RIFF_BPM = 120; // BPM these riff delays were authored at

function scheduleRiff(riffKey) {
    cancelRiff();
    const riff = RIFFS[riffKey];
    if (!riff || riff.steps.length === 0) return;

    riffPlaying = true;
    const tempoScale = BASE_RIFF_BPM / riffBPM; // scale delays to current BPM
    let cumulativeDelay = 0;

    for (let i = 0; i < riff.steps.length; i++) {
        const step = riff.steps[i];
        cumulativeDelay += step.delay * tempoScale;

        const tid = setTimeout(() => {
            if (!riffPlaying || !active) return;
            karplusStrongPluck(step.string, step.velocity, step.fret);
        }, cumulativeDelay);

        riffTimeouts.push(tid);
    }

    // Loop: schedule next iteration after the riff finishes
    if (riffLooping) {
        const loopDelay = cumulativeDelay + 400 * tempoScale;
        const loopTid = setTimeout(() => {
            if (riffPlaying && active) {
                scheduleRiff(riffKey);
            }
        }, loopDelay);
        riffTimeouts.push(loopTid);
    } else {
        const stopTid = setTimeout(() => {
            riffPlaying = false;
        }, cumulativeDelay + 100);
        riffTimeouts.push(stopTid);
    }
}

function cancelRiff() {
    for (const tid of riffTimeouts) clearTimeout(tid);
    riffTimeouts = [];
    riffPlaying = false;
}

export function playRiff(riffKey) {
    if (!active) return;
    currentRiff = riffKey || currentRiff;
    if (currentRiff === 'none') {
        cancelRiff();
        return;
    }
    scheduleRiff(currentRiff);
}

export function stopRiff() {
    cancelRiff();
}

export function isRiffPlaying() {
    return riffPlaying;
}

export function setCurrentRiff(riffKey) {
    currentRiff = riffKey;
    // If already playing, restart with new riff
    if (riffPlaying) {
        scheduleRiff(riffKey);
    }
}

export function getRiffNames() {
    return Object.entries(RIFFS).map(([key, val]) => ({ key, label: val.label }));
}

export function setRiffBPM(bpm) {
    riffBPM = Math.max(40, Math.min(240, bpm));
    // If a riff is currently playing, restart it at the new tempo
    if (riffPlaying && currentRiff !== 'none') {
        scheduleRiff(currentRiff);
    }
}

export function getCurrentRiff() {
    return currentRiff;
}

// ── Pedal Controls ────────────────────────────────────────────────────────────

export function getPedalStates() {
    return {
        overdrive: { enabled: pedals.overdrive.enabled, drive: pedals.overdrive.drive, tone: pedals.overdrive.tone },
        chorus: { enabled: pedals.chorus.enabled, rate: pedals.chorus.rate, depth: pedals.chorus.depth },
        phaser: { enabled: pedals.phaser.enabled, rate: pedals.phaser.rate, depth: pedals.phaser.depth },
        delay: { enabled: pedals.delay.enabled, time: pedals.delay.time, feedback: pedals.delay.feedback, mix: pedals.delay.mix },
        reverb: { enabled: pedals.reverb.enabled, decay: pedals.reverb.decay, mix: pedals.reverb.mix },
        tremolo: { enabled: pedals.tremolo.enabled, rate: pedals.tremolo.rate, depth: pedals.tremolo.depth },
    };
}

const RAMP = 0.02; // smooth parameter transitions

export function togglePedal(name, enabled) {
    const p = pedals[name];
    if (!p) return;
    p.enabled = enabled;
    if (!audioCtx) return;
    const t = audioCtx.currentTime;

    switch (name) {
        case 'overdrive':
            p.dryGain?.gain.setTargetAtTime(enabled ? 0 : 1, t, RAMP);
            p.wetGain?.gain.setTargetAtTime(enabled ? 1 : 0, t, RAMP);
            break;
        case 'chorus':
            p.wetGain?.gain.setTargetAtTime(enabled ? 0.6 : 0, t, RAMP);
            break;
        case 'phaser':
            p.wetGain?.gain.setTargetAtTime(enabled ? 0.7 : 0, t, RAMP);
            break;
        case 'delay':
            p.wetGain?.gain.setTargetAtTime(enabled ? p.mix : 0, t, RAMP);
            break;
        case 'reverb':
            p.wetGain?.gain.setTargetAtTime(enabled ? p.mix : 0, t, RAMP);
            break;
        case 'tremolo':
            p.dryGain?.gain.setTargetAtTime(enabled ? 0 : 1, t, RAMP);
            p.wetGain?.gain.setTargetAtTime(enabled ? 1 : 0, t, RAMP);
            p.lfoGain?.gain.setTargetAtTime(enabled ? p.depth : 0, t, RAMP);
            break;
    }
}

export function setPedalParam(name, param, value) {
    const p = pedals[name];
    if (!p || !audioCtx) return;
    const t = audioCtx.currentTime;

    switch (name) {
        case 'overdrive':
            if (param === 'drive') {
                p.drive = value;
                if (p.node) p.node.curve = makeDistortionCurve(value);
            } else if (param === 'tone') {
                p.tone = value;
                p.toneFilter?.frequency.setTargetAtTime(value, t, RAMP);
            }
            break;
        case 'chorus':
            if (param === 'rate') {
                p.rate = value;
                p.lfo?.frequency.setTargetAtTime(value, t, RAMP);
            } else if (param === 'depth') {
                p.depth = value;
                p.lfoGain?.gain.setTargetAtTime(value, t, RAMP);
            }
            break;
        case 'phaser':
            if (param === 'rate') {
                p.rate = value;
                p.lfo?.frequency.setTargetAtTime(value, t, RAMP);
            } else if (param === 'depth') {
                p.depth = value;
                p.lfoGain?.gain.setTargetAtTime(value, t, RAMP);
            }
            break;
        case 'delay':
            if (param === 'time') {
                p.time = value;
                p.delayNode?.delayTime.setTargetAtTime(value, t, RAMP);
            } else if (param === 'feedback') {
                p.feedback = value;
                p.feedbackGain?.gain.setTargetAtTime(value, t, RAMP);
            } else if (param === 'mix') {
                p.mix = value;
                if (p.enabled) p.wetGain?.gain.setTargetAtTime(value, t, RAMP);
            }
            break;
        case 'reverb':
            if (param === 'decay') {
                p.decay = value;
                if (p.convolver) p.convolver.buffer = generateReverbIR(value);
            } else if (param === 'mix') {
                p.mix = value;
                if (p.enabled) p.wetGain?.gain.setTargetAtTime(value, t, RAMP);
            }
            break;
        case 'tremolo':
            if (param === 'rate') {
                p.rate = value;
                p.lfo?.frequency.setTargetAtTime(value, t, RAMP);
            } else if (param === 'depth') {
                p.depth = value;
                if (p.enabled) p.lfoGain?.gain.setTargetAtTime(value, t, RAMP);
            }
            break;
    }
}
