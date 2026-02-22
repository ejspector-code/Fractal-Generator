/**
 * MIDI Keyboard Synthesizer — Web MIDI API + Web Audio API polyphonic synth.
 * Generates real audio from MIDI input and exposes an AnalyserNode for FFT data,
 * allowing the fractal's audio-reactive system to respond to played notes.
 *
 * Effects chain:
 *   voices → filter → distortion → wah → delay → reverb → masterGain → analyser → dest
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_VOICES = 8;
const FFT_SIZE = 2048;
const SMOOTHING = 0.8;

// ── State ─────────────────────────────────────────────────────────────────────

let audioCtx = null;
let analyser = null;
let masterGain = null;
let filterNode = null;
let frequencyData = null;
let timeDomainData = null;
let midiAccess = null;
let active = false;
let waveform = 'sawtooth';

// Effects nodes
let distortionNode = null;
let wahFilter = null;
let wahLFO = null;
let wahLFOGain = null;
let wahDryGain = null;
let wahWetGain = null;
let wahDrySplit = null;
let delayNode = null;
let delayFeedback = null;
let delayDryGain = null;
let delayWetGain = null;
let reverbConvolver = null;
let reverbDryGain = null;
let reverbWetGain = null;
let audioStreamDest = null;
let synthOutputGain = null; // synth-only bus (before drums merge into master)

// Looper state
let looperRecorder = null;
let looperSource = null;
let looperBuffer = null;
let looperIsRecording = false;
let looperIsPlaying = false;
let looperGain = null;
let looperRecordingChunks = [];
let looperStream = null;

// Global tempo
let globalBPM = 120;
let onTempoChangeCallback = null;

// Effect parameters
let effectParams = {
    filter: { cutoff: 8000, q: 1, type: 'lowpass' },
    distortion: { drive: 0 },
    wah: { enabled: false, rate: 2, depth: 4000, baseFreq: 500 },
    delay: { time: 0.3, feedback: 0.3, mix: 0 },
    reverb: { mix: 0, decay: 1.5 },
    adsr: { attack: 0.05, decay: 0.15, sustain: 0.6, release: 0.3 },
    octaveShift: 0,
};

// ── Scale Lock ─────────────────────────────────────────────────────────────────
const SCALE_INTERVALS = {
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    blues: [0, 3, 5, 6, 7, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
let scaleLock = { enabled: false, root: 0, scale: 'major' };

function quantizeNote(note) {
    if (!scaleLock.enabled || scaleLock.scale === 'chromatic') return note;
    const intervals = SCALE_INTERVALS[scaleLock.scale] || SCALE_INTERVALS.major;
    const pc = ((note - scaleLock.root) % 12 + 12) % 12; // pitch class relative to root
    // Find nearest scale degree
    let bestDist = 99, bestPC = 0;
    for (const iv of intervals) {
        const d = Math.min(Math.abs(pc - iv), 12 - Math.abs(pc - iv));
        if (d < bestDist) { bestDist = d; bestPC = iv; }
    }
    // Reconstruct note
    const octave = Math.floor((note - scaleLock.root) / 12);
    let result = scaleLock.root + octave * 12 + bestPC;
    // Clamp to valid MIDI range
    if (result < 0) result += 12;
    if (result > 127) result -= 12;
    return result;
}

// ── Chord Mode ────────────────────────────────────────────────────────────────
const CHORD_INTERVALS = {
    major: [0, 4, 7],
    minor: [0, 3, 7],
    '7th': [0, 4, 7, 10],
    min7: [0, 3, 7, 10],
    sus4: [0, 5, 7],
    power: [0, 7, 12],
    dim: [0, 3, 6],
};
let chordMode = { enabled: false, type: 'major' };
let chordVoiceMap = new Map(); // originalNote → [expandedNotes]

function expandChord(note) {
    if (!chordMode.enabled) return [note];
    const intervals = CHORD_INTERVALS[chordMode.type] || CHORD_INTERVALS.major;
    return intervals.map(iv => note + iv).filter(n => n <= 127);
}

// ── Arpeggiator ───────────────────────────────────────────────────────────────
let arp = { enabled: false, pattern: 'up', rate: '1/8', octaves: 1 };
let arpHeldNotes = [];      // notes currently held (after scale + chord)
let arpTimer = null;
let arpIndex = 0;
let arpDirection = 1;       // 1 = ascending, -1 = descending
let arpCurrentNote = -1;    // currently sounding arp note
let arpOriginalHeld = new Map(); // originalNote → [chord-expanded notes]

function getArpSequence() {
    if (arpHeldNotes.length === 0) return [];
    const sorted = [...new Set(arpHeldNotes)].sort((a, b) => a - b);
    // Expand across octaves
    const seq = [];
    for (let oct = 0; oct < arp.octaves; oct++) {
        for (const n of sorted) {
            const shifted = n + oct * 12;
            if (shifted <= 127) seq.push(shifted);
        }
    }
    return seq;
}

function arpRateMs() {
    const beatMs = 60000 / globalBPM;
    switch (arp.rate) {
        case '1/4': return beatMs;
        case '1/8': return beatMs / 2;
        case '1/16': return beatMs / 4;
        default: return beatMs / 2;
    }
}

function arpTick() {
    const seq = getArpSequence();
    if (seq.length === 0) {
        if (arpCurrentNote >= 0) {
            rawNoteOff(arpCurrentNote);
            arpCurrentNote = -1;
        }
        return;
    }

    // Release previous note
    if (arpCurrentNote >= 0) rawNoteOff(arpCurrentNote);

    // Determine next index based on pattern
    switch (arp.pattern) {
        case 'up':
            arpIndex = (arpIndex + 1) % seq.length;
            break;
        case 'down':
            arpIndex = (arpIndex - 1 + seq.length) % seq.length;
            break;
        case 'updown':
            arpIndex += arpDirection;
            if (arpIndex >= seq.length) {
                arpDirection = -1;
                arpIndex = Math.max(seq.length - 2, 0);
            } else if (arpIndex < 0) {
                arpDirection = 1;
                arpIndex = Math.min(1, seq.length - 1);
            }
            break;
        case 'random':
            arpIndex = Math.floor(Math.random() * seq.length);
            break;
    }

    arpIndex = Math.min(arpIndex, seq.length - 1);
    const note = seq[arpIndex];
    rawNoteOn(note, 100);
    arpCurrentNote = note;
}

function startArpTimer() {
    stopArpTimer();
    arpIndex = -1; // will advance to 0 on first tick
    arpDirection = 1;
    arpTick(); // play immediately
    arpTimer = setInterval(arpTick, arpRateMs());
}

function stopArpTimer() {
    if (arpTimer) clearInterval(arpTimer);
    arpTimer = null;
    if (arpCurrentNote >= 0) {
        rawNoteOff(arpCurrentNote);
        arpCurrentNote = -1;
    }
}

function restartArpIfNeeded() {
    if (arp.enabled && arpHeldNotes.length > 0) {
        startArpTimer();
    }
}

/** @type {Map<number, Voice>} Active voices keyed by MIDI note number */
const voices = new Map();

/** @type {Set<number>} Currently held notes for visualization */
const activeNotes = new Set();

/** @type {function|null} External callback for note events */
let onNoteCallback = null;

/** @type {function|null} External callback for looper state changes */
let onLooperStateCallback = null;

// ── Voice Class ───────────────────────────────────────────────────────────────

class Voice {
    constructor(note, velocity) {
        const shiftedNote = note + (effectParams.octaveShift * 12);
        const freq = 440 * Math.pow(2, (shiftedNote - 69) / 12);
        const vel = velocity / 127;
        const adsr = effectParams.adsr;

        // Oscillator
        this.osc = audioCtx.createOscillator();
        this.osc.type = waveform;
        this.osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

        // Sub oscillator for richness (one octave down, quieter)
        this.subOsc = audioCtx.createOscillator();
        this.subOsc.type = 'sine';
        this.subOsc.frequency.setValueAtTime(freq * 0.5, audioCtx.currentTime);

        this.subGain = audioCtx.createGain();
        this.subGain.gain.setValueAtTime(vel * 0.1, audioCtx.currentTime);

        // Gain envelope
        this.gainNode = audioCtx.createGain();
        this.gainNode.gain.setValueAtTime(0, audioCtx.currentTime);

        // ADSR envelope — Attack
        this.gainNode.gain.linearRampToValueAtTime(
            vel * 0.4,
            audioCtx.currentTime + adsr.attack
        );
        // Decay to sustain
        this.gainNode.gain.linearRampToValueAtTime(
            vel * 0.4 * adsr.sustain,
            audioCtx.currentTime + adsr.attack + adsr.decay
        );

        // Connect: osc → gain → filter
        this.osc.connect(this.gainNode);
        this.subOsc.connect(this.subGain);
        this.subGain.connect(this.gainNode);
        this.gainNode.connect(filterNode);

        this.osc.start();
        this.subOsc.start();
        this.note = note;
        this.released = false;
    }

    release() {
        if (this.released) return;
        this.released = true;
        const now = audioCtx.currentTime;
        const rel = effectParams.adsr.release;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(0, now + rel);
        setTimeout(() => {
            try {
                this.osc.stop();
                this.subOsc.stop();
                this.osc.disconnect();
                this.subOsc.disconnect();
                this.subGain.disconnect();
                this.gainNode.disconnect();
            } catch (e) { /* already stopped */ }
        }, rel * 1000 + 50);
    }
}

// ── Distortion Curve ──────────────────────────────────────────────────────────

function makeDistortionCurve(amount) {
    const k = amount * 100;
    const samples = 256;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
        const x = (i * 2) / samples - 1;
        if (k === 0) {
            curve[i] = x;
        } else {
            curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) /
                (Math.PI + k * Math.abs(x));
        }
    }
    return curve;
}

// ── Reverb Impulse Response Generation ────────────────────────────────────────

function generateReverbIR(decay) {
    if (!audioCtx) return null;
    const rate = audioCtx.sampleRate;
    const length = rate * Math.max(0.5, decay);
    const buffer = audioCtx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < length; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay * 1.5);
        }
    }
    return buffer;
}

// ── MIDI Helpers ──────────────────────────────────────────────────────────────

function handleMidiMessage(event) {
    const [status, note, velocity] = event.data;
    const command = status & 0xf0;

    switch (command) {
        case 0x90:
            if (velocity > 0) {
                noteOn(note, velocity);
            } else {
                noteOff(note);
            }
            break;
        case 0x80:
            noteOff(note);
            break;
        case 0xb0:
            handleCC(note, velocity);
            break;
    }
}

// ── Raw note on/off (bypass pipeline — used by arpeggiator internally) ────────

function rawNoteOn(note, velocity = 100) {
    if (!active || !audioCtx) return;
    if (voices.has(note)) {
        voices.get(note).release();
        voices.delete(note);
    }

    if (voices.size >= MAX_VOICES) {
        const oldest = voices.keys().next().value;
        voices.get(oldest).release();
        voices.delete(oldest);
        activeNotes.delete(oldest);
    }

    const voice = new Voice(note, velocity);
    voices.set(note, voice);
    activeNotes.add(note);

    if (onNoteCallback) onNoteCallback({ type: 'on', note, velocity });
}

function rawNoteOff(note) {
    if (!active) return;
    if (voices.has(note)) {
        voices.get(note).release();
        voices.delete(note);
    }
    activeNotes.delete(note);

    if (onNoteCallback) onNoteCallback({ type: 'off', note });
}

// ── Public noteOn / noteOff (with Scale Lock → Chord → Arp pipeline) ─────────

export function noteOn(originalNote, velocity = 100) {
    if (!active || !audioCtx) return;

    // 1. Scale Lock
    const quantized = quantizeNote(originalNote);

    // 2. Chord expansion
    const chordNotes = expandChord(quantized);

    // 3. Arpeggiator
    if (arp.enabled) {
        // Store mapping and add to held set
        arpOriginalHeld.set(originalNote, chordNotes);
        for (const n of chordNotes) {
            if (!arpHeldNotes.includes(n)) arpHeldNotes.push(n);
        }
        restartArpIfNeeded();
        return;
    }

    // No arp — play all chord notes immediately
    chordVoiceMap.set(originalNote, chordNotes);
    for (const n of chordNotes) {
        rawNoteOn(n, velocity);
    }
}

export function noteOff(originalNote) {
    if (!active) return;

    if (arp.enabled) {
        // Remove this key's notes from arp held set
        const notes = arpOriginalHeld.get(originalNote) || [];
        arpOriginalHeld.delete(originalNote);
        for (const n of notes) {
            const idx = arpHeldNotes.indexOf(n);
            if (idx >= 0) arpHeldNotes.splice(idx, 1);
        }
        if (arpHeldNotes.length === 0) {
            stopArpTimer();
        }
        return;
    }

    // No arp — release all chord notes
    const notes = chordVoiceMap.get(originalNote) || [originalNote];
    chordVoiceMap.delete(originalNote);
    for (const n of notes) {
        rawNoteOff(n);
    }
}

function handleCC(cc, value) {
    if (cc === 1 && filterNode) {
        const minFreq = 200;
        const maxFreq = 12000;
        const freq = minFreq + (value / 127) * (maxFreq - minFreq);
        filterNode.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.01);
    }
    if (cc === 74 && filterNode) {
        const minFreq = 200;
        const maxFreq = 12000;
        const freq = minFreq + (value / 127) * (maxFreq - minFreq);
        filterNode.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.01);
    }
}

function connectMidiInputs() {
    if (!midiAccess) return;
    for (const input of midiAccess.inputs.values()) {
        input.onmidimessage = handleMidiMessage;
    }
    midiAccess.onstatechange = (e) => {
        if (e.port.type === 'input' && e.port.state === 'connected') {
            e.port.onmidimessage = handleMidiMessage;
        }
    };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function startMidi() {
    if (active) return { ok: true };

    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // ── Build effects chain ──────────────────────────────────────────────

        // 1. Filter (first in chain after voices)
        filterNode = audioCtx.createBiquadFilter();
        filterNode.type = effectParams.filter.type;
        filterNode.frequency.setValueAtTime(effectParams.filter.cutoff, audioCtx.currentTime);
        filterNode.Q.setValueAtTime(effectParams.filter.q, audioCtx.currentTime);

        // 2. Distortion
        distortionNode = audioCtx.createWaveShaper();
        distortionNode.curve = makeDistortionCurve(effectParams.distortion.drive);
        distortionNode.oversample = '4x';

        // 3. Wah-Wah (bandpass filter with LFO modulating frequency)
        wahFilter = audioCtx.createBiquadFilter();
        wahFilter.type = 'bandpass';
        wahFilter.frequency.setValueAtTime(effectParams.wah.baseFreq, audioCtx.currentTime);
        wahFilter.Q.setValueAtTime(5, audioCtx.currentTime);

        wahLFO = audioCtx.createOscillator();
        wahLFO.type = 'sine';
        wahLFO.frequency.setValueAtTime(effectParams.wah.rate, audioCtx.currentTime);

        wahLFOGain = audioCtx.createGain();
        wahLFOGain.gain.setValueAtTime(
            effectParams.wah.enabled ? effectParams.wah.depth : 0,
            audioCtx.currentTime
        );

        wahLFO.connect(wahLFOGain);
        wahLFOGain.connect(wahFilter.frequency);
        wahLFO.start();

        // Wah dry/wet mix
        wahDryGain = audioCtx.createGain();
        wahWetGain = audioCtx.createGain();
        wahDryGain.gain.setValueAtTime(effectParams.wah.enabled ? 0 : 1, audioCtx.currentTime);
        wahWetGain.gain.setValueAtTime(effectParams.wah.enabled ? 1 : 0, audioCtx.currentTime);

        // 4. Delay (feedback loop)
        delayNode = audioCtx.createDelay(5.0);
        delayNode.delayTime.setValueAtTime(effectParams.delay.time, audioCtx.currentTime);

        delayFeedback = audioCtx.createGain();
        delayFeedback.gain.setValueAtTime(effectParams.delay.feedback, audioCtx.currentTime);

        delayDryGain = audioCtx.createGain();
        delayDryGain.gain.setValueAtTime(1, audioCtx.currentTime);

        delayWetGain = audioCtx.createGain();
        delayWetGain.gain.setValueAtTime(effectParams.delay.mix, audioCtx.currentTime);

        // Delay feedback loop
        delayNode.connect(delayFeedback);
        delayFeedback.connect(delayNode);

        // 5. Reverb (convolver)
        reverbConvolver = audioCtx.createConvolver();
        reverbConvolver.buffer = generateReverbIR(effectParams.reverb.decay);

        reverbDryGain = audioCtx.createGain();
        reverbDryGain.gain.setValueAtTime(1, audioCtx.currentTime);

        reverbWetGain = audioCtx.createGain();
        reverbWetGain.gain.setValueAtTime(effectParams.reverb.mix, audioCtx.currentTime);

        // 6. Master gain
        masterGain = audioCtx.createGain();
        masterGain.gain.setValueAtTime(0.5, audioCtx.currentTime);

        // 7. Analyser
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = SMOOTHING;

        // 8. Looper gain
        looperGain = audioCtx.createGain();
        looperGain.gain.setValueAtTime(0.8, audioCtx.currentTime);

        // ── Connect the chain ────────────────────────────────────────────────
        // filter → distortion
        filterNode.connect(distortionNode);

        // distortion → wah path (wet) + bypass (dry)
        // Merge point after wah
        const wahMerge = audioCtx.createGain();
        wahMerge.gain.setValueAtTime(1, audioCtx.currentTime);

        distortionNode.connect(wahFilter);
        wahFilter.connect(wahWetGain);
        wahWetGain.connect(wahMerge);

        distortionNode.connect(wahDryGain);
        wahDryGain.connect(wahMerge);

        // wahMerge → delay path (wet) + bypass (dry)
        const delayMerge = audioCtx.createGain();
        delayMerge.gain.setValueAtTime(1, audioCtx.currentTime);

        wahMerge.connect(delayNode);
        delayNode.connect(delayWetGain);
        delayWetGain.connect(delayMerge);

        wahMerge.connect(delayDryGain);
        delayDryGain.connect(delayMerge);

        // delayMerge → reverb path (wet) + bypass (dry)
        const reverbMerge = audioCtx.createGain();
        reverbMerge.gain.setValueAtTime(1, audioCtx.currentTime);

        delayMerge.connect(reverbConvolver);
        reverbConvolver.connect(reverbWetGain);
        reverbWetGain.connect(reverbMerge);

        delayMerge.connect(reverbDryGain);
        reverbDryGain.connect(reverbMerge);

        // reverbMerge → synthOutputGain (synth-only bus) → masterGain
        synthOutputGain = audioCtx.createGain();
        synthOutputGain.gain.setValueAtTime(1, audioCtx.currentTime);
        reverbMerge.connect(synthOutputGain);
        synthOutputGain.connect(masterGain);
        looperGain.connect(masterGain);
        masterGain.connect(analyser);
        analyser.connect(audioCtx.destination);

        // Prepare audio stream destination for recording
        audioStreamDest = audioCtx.createMediaStreamDestination();
        masterGain.connect(audioStreamDest);

        frequencyData = new Uint8Array(analyser.frequencyBinCount);
        timeDomainData = new Uint8Array(analyser.fftSize);

        active = true;

        // Try to connect MIDI hardware
        const devices = [];
        try {
            if (navigator.requestMIDIAccess) {
                const midiPromise = navigator.requestMIDIAccess({ sysex: false });
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 5000)
                );
                midiAccess = await Promise.race([midiPromise, timeoutPromise]);
                for (const input of midiAccess.inputs.values()) {
                    devices.push(input.name);
                }
                connectMidiInputs();
            }
        } catch (midiErr) {
            console.warn('[MIDI] No hardware MIDI — use on-screen keyboard or computer keys');
            midiAccess = null;
        }

        return { ok: true, devices };

    } catch (err) {
        console.error('[MIDI] Failed to start audio engine:', err);
        cleanup();
        return { ok: false, error: err.message || 'Unknown error' };
    }
}

export function stopMidi() {
    stopLooper();
    for (const voice of voices.values()) {
        voice.release();
    }
    voices.clear();
    activeNotes.clear();
    cleanup();
}

function cleanup() {
    active = false;

    if (wahLFO) { try { wahLFO.stop(); } catch (e) { } }

    if (midiAccess) {
        for (const input of midiAccess.inputs.values()) {
            input.onmidimessage = null;
        }
        midiAccess.onstatechange = null;
        midiAccess = null;
    }

    if (audioCtx) {
        audioCtx.close().catch(() => { });
        audioCtx = null;
    }

    analyser = null;
    filterNode = null;
    masterGain = null;
    distortionNode = null;
    wahFilter = null;
    wahLFO = null;
    wahLFOGain = null;
    wahDryGain = null;
    wahWetGain = null;
    delayNode = null;
    delayFeedback = null;
    delayDryGain = null;
    delayWetGain = null;
    reverbConvolver = null;
    reverbDryGain = null;
    reverbWetGain = null;
    looperGain = null;
    frequencyData = null;
    timeDomainData = null;
}

// ── Effect Setters ────────────────────────────────────────────────────────────

// Filter
export function setFilterCutoff(freq) {
    effectParams.filter.cutoff = freq;
    if (filterNode) filterNode.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.01);
}

export function setFilterQ(q) {
    effectParams.filter.q = q;
    if (filterNode) filterNode.Q.setTargetAtTime(q, audioCtx.currentTime, 0.01);
}

export function setFilterType(type) {
    effectParams.filter.type = type;
    if (filterNode) filterNode.type = type;
}

// Distortion
export function setDistortionDrive(amount) {
    effectParams.distortion.drive = amount;
    if (distortionNode) {
        distortionNode.curve = makeDistortionCurve(amount);
    }
}

// Wah-Wah
export function setWahEnabled(enabled) {
    effectParams.wah.enabled = enabled;
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    if (enabled) {
        wahDryGain.gain.setTargetAtTime(0, t, 0.02);
        wahWetGain.gain.setTargetAtTime(1, t, 0.02);
        wahLFOGain.gain.setTargetAtTime(effectParams.wah.depth, t, 0.02);
    } else {
        wahDryGain.gain.setTargetAtTime(1, t, 0.02);
        wahWetGain.gain.setTargetAtTime(0, t, 0.02);
        wahLFOGain.gain.setTargetAtTime(0, t, 0.02);
    }
}

export function setWahRate(rate) {
    effectParams.wah.rate = rate;
    if (wahLFO) wahLFO.frequency.setTargetAtTime(rate, audioCtx.currentTime, 0.02);
}

export function setWahDepth(depth) {
    effectParams.wah.depth = depth;
    if (wahLFOGain && effectParams.wah.enabled) {
        wahLFOGain.gain.setTargetAtTime(depth, audioCtx.currentTime, 0.02);
    }
}

export function setWahBaseFreq(freq) {
    effectParams.wah.baseFreq = freq;
    if (wahFilter) wahFilter.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.02);
}

// Delay
export function setDelayTime(t) {
    effectParams.delay.time = t;
    if (delayNode) delayNode.delayTime.setTargetAtTime(t, audioCtx.currentTime, 0.02);
}

export function setDelayFeedback(fb) {
    effectParams.delay.feedback = fb;
    if (delayFeedback) delayFeedback.gain.setTargetAtTime(fb, audioCtx.currentTime, 0.02);
}

export function setDelayMix(mix) {
    effectParams.delay.mix = mix;
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    if (delayWetGain) delayWetGain.gain.setTargetAtTime(mix, t, 0.02);
    if (delayDryGain) delayDryGain.gain.setTargetAtTime(1 - mix * 0.5, t, 0.02);
}

// Reverb
export function setReverbMix(mix) {
    effectParams.reverb.mix = mix;
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    if (reverbWetGain) reverbWetGain.gain.setTargetAtTime(mix, t, 0.02);
    if (reverbDryGain) reverbDryGain.gain.setTargetAtTime(1 - mix * 0.5, t, 0.02);
}

export function setReverbDecay(decay) {
    effectParams.reverb.decay = decay;
    if (reverbConvolver && audioCtx) {
        reverbConvolver.buffer = generateReverbIR(decay);
    }
}

// ADSR
export function setADSR(a, d, s, r) {
    effectParams.adsr = { attack: a, decay: d, sustain: s, release: r };
}

// Master volume
export function setMasterVolume(v) {
    if (masterGain) masterGain.gain.setTargetAtTime(v, audioCtx.currentTime, 0.02);
}

// Octave shift
export function setOctaveShift(n) {
    effectParams.octaveShift = n;
}

// ── Scale Lock Setters ────────────────────────────────────────────────────────

export function setScaleLock(enabled) {
    scaleLock.enabled = enabled;
}

export function setScaleRoot(root) {
    scaleLock.root = root;
}

export function setScaleType(type) {
    scaleLock.scale = type;
}

export function getScaleTypes() {
    return Object.keys(SCALE_INTERVALS);
}

// ── Chord Mode Setters ────────────────────────────────────────────────────────

export function setChordEnabled(enabled) {
    chordMode.enabled = enabled;
    if (!enabled) chordVoiceMap.clear();
}

export function setChordType(type) {
    chordMode.type = type;
}

export function getChordTypes() {
    return Object.keys(CHORD_INTERVALS);
}

// ── Arpeggiator Setters ───────────────────────────────────────────────────────

export function setArpEnabled(enabled) {
    arp.enabled = enabled;
    if (!enabled) {
        stopArpTimer();
        arpHeldNotes = [];
        arpOriginalHeld.clear();
    }
}

export function setArpPattern(pattern) {
    arp.pattern = pattern;
    arpDirection = 1;
}

export function setArpRate(rate) {
    arp.rate = rate;
    if (arp.enabled && arpTimer) {
        // Restart with new rate
        clearInterval(arpTimer);
        arpTimer = setInterval(arpTick, arpRateMs());
    }
}

export function setArpBPM(bpm) {
    globalBPM = Math.max(40, Math.min(240, bpm));
    drumBPM = globalBPM;
    if (arp.enabled && arpTimer) {
        clearInterval(arpTimer);
        arpTimer = setInterval(arpTick, arpRateMs());
    }
    if (onTempoChangeCallback) onTempoChangeCallback(globalBPM);
}

export function setArpOctaves(n) {
    arp.octaves = n;
}

export function getAudioStream() {
    return audioStreamDest ? audioStreamDest.stream : null;
}

// ── Looper ────────────────────────────────────────────────────────────────────

export function startLooperRecording() {
    if (!audioCtx || !masterGain || looperIsRecording) return;

    // Record from synthOutputGain (synth-only, excludes drums)
    const dest = audioCtx.createMediaStreamDestination();
    synthOutputGain.connect(dest);
    looperStream = dest;

    looperRecordingChunks = [];
    looperRecorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });

    looperRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) looperRecordingChunks.push(e.data);
    };

    looperRecorder.onstop = async () => {
        const blob = new Blob(looperRecordingChunks, { type: 'audio/webm' });
        try {
            const arrayBuf = await blob.arrayBuffer();
            looperBuffer = await audioCtx.decodeAudioData(arrayBuf);
            if (onLooperStateCallback) onLooperStateCallback('ready');
            // Auto-play after recording
            playLoop();
        } catch (err) {
            console.error('[Looper] Failed to decode recording:', err);
            if (onLooperStateCallback) onLooperStateCallback('error');
        }
    };

    looperRecorder.start();
    looperIsRecording = true;
    if (onLooperStateCallback) onLooperStateCallback('recording');
}

export function stopLooperRecording() {
    if (!looperRecorder || !looperIsRecording) return;
    looperIsRecording = false;
    looperRecorder.stop();

    // Disconnect the media stream dest
    try {
        if (looperStream) synthOutputGain.disconnect(looperStream);
    } catch (e) { }
    looperStream = null;
}

function playLoop() {
    if (!looperBuffer || !audioCtx || !looperGain) return;

    // Stop existing loop
    if (looperSource) {
        try { looperSource.stop(); } catch (e) { }
    }

    looperSource = audioCtx.createBufferSource();
    looperSource.buffer = looperBuffer;
    looperSource.loop = true;
    looperSource.connect(looperGain);
    looperSource.start();
    looperIsPlaying = true;
    if (onLooperStateCallback) onLooperStateCallback('playing');
}

export function stopLooper() {
    if (looperIsRecording) {
        looperIsRecording = false;
        if (looperRecorder) {
            try { looperRecorder.stop(); } catch (e) { }
        }
    }
    if (looperSource) {
        try { looperSource.stop(); } catch (e) { }
        looperSource = null;
    }
    looperIsPlaying = false;
    looperBuffer = null;
    looperRecordingChunks = [];
    if (onLooperStateCallback) onLooperStateCallback('idle');
}

export function toggleLooperPlayback() {
    if (looperIsPlaying) {
        if (looperSource) { try { looperSource.stop(); } catch (e) { } looperSource = null; }
        looperIsPlaying = false;
        if (onLooperStateCallback) onLooperStateCallback('paused');
    } else if (looperBuffer) {
        playLoop();
    }
}

export function getLooperState() {
    if (looperIsRecording) return 'recording';
    if (looperIsPlaying) return 'playing';
    if (looperBuffer) return 'paused';
    return 'idle';
}

export function setLooperCallback(cb) {
    onLooperStateCallback = cb;
}

// ── Existing Public API ───────────────────────────────────────────────────────

export function isMidiActive() {
    return active;
}

export function getMidiFrequencyData() {
    if (!active || !analyser || !frequencyData) return null;
    analyser.getByteFrequencyData(frequencyData);
    return frequencyData;
}

export function getMidiSampleRate() {
    return audioCtx ? audioCtx.sampleRate : 44100;
}

export function getMidiBinCount() {
    return analyser ? analyser.frequencyBinCount : FFT_SIZE / 2;
}

export function getMidiTimeDomainData() {
    if (!active || !analyser || !timeDomainData) return null;
    analyser.getByteTimeDomainData(timeDomainData);
    return timeDomainData;
}

export function setMidiWaveform(type) {
    waveform = type;
    for (const voice of voices.values()) {
        voice.osc.type = type;
    }
}

export function getMidiActiveNotes() {
    return activeNotes;
}

export function getMidiDevices() {
    if (!midiAccess) return [];
    const devices = [];
    for (const input of midiAccess.inputs.values()) {
        devices.push(input.name);
    }
    return devices;
}

export function setNoteCallback(cb) {
    onNoteCallback = cb;
}

export function getEffectParams() {
    return { waveform, ...effectParams };
}

export function getMidiAudioContext() { return audioCtx; }
export function getMidiMasterGain() { return masterGain; }

// ── Drum Machine ──────────────────────────────────────────────────────────────

const DRUM_TRACKS = ['kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell', 'openhh'];
let DRUM_STEPS = 16;

let drumPattern = DRUM_TRACKS.map(() => new Array(DRUM_STEPS).fill(false));
let drumBPM = 120;
let drumVolume = 0.7;
let drumSwing = 0;
let drumPlaying = false;
let drumTimerID = null;
let drumCurrentStep = 0;
let drumGain = null;
let drumNextStepTime = 0;
let drumLookahead = 25;
let drumScheduleAhead = 0.1;
let onDrumStepCallback = null;

let drumMute = new Array(DRUM_TRACKS.length).fill(false);
let drumSolo = new Array(DRUM_TRACKS.length).fill(false);

function isTrackAudible(trackIndex) {
    const anySolo = drumSolo.some(s => s);
    if (anySolo) return drumSolo[trackIndex] && !drumMute[trackIndex];
    return !drumMute[trackIndex];
}

// ── Drum Synthesis ────────────────────────────────────────────────────────────

function playKick(time) {
    if (!audioCtx || !drumGain) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const click = audioCtx.createOscillator();
    const clickGain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
    gain.gain.setValueAtTime(1.0, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
    click.type = 'square';
    click.frequency.setValueAtTime(800, time);
    click.frequency.exponentialRampToValueAtTime(100, time + 0.02);
    clickGain.gain.setValueAtTime(0.6, time);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    osc.connect(gain); gain.connect(drumGain);
    click.connect(clickGain); clickGain.connect(drumGain);
    osc.start(time); osc.stop(time + 0.45);
    click.start(time); click.stop(time + 0.04);
}

function playSnare(time) {
    if (!audioCtx || !drumGain) return;
    const noiseLen = audioCtx.sampleRate * 0.15;
    const noiseBuf = audioCtx.createBuffer(1, noiseLen, audioCtx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) data[i] = Math.random() * 2 - 1;
    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuf;
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.8, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.setValueAtTime(1000, time);
    noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(drumGain);
    const osc = audioCtx.createOscillator();
    const oscGain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, time);
    osc.frequency.exponentialRampToValueAtTime(80, time + 0.07);
    oscGain.gain.setValueAtTime(0.5, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    osc.connect(oscGain); oscGain.connect(drumGain);
    noise.start(time); noise.stop(time + 0.15);
    osc.start(time); osc.stop(time + 0.12);
}

function playHiHat(time) {
    if (!audioCtx || !drumGain) return;
    const fundamental = 40;
    const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
    for (const ratio of ratios) {
        const osc = audioCtx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(fundamental * ratio, time);
        const bp = audioCtx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.setValueAtTime(10000, time); bp.Q.setValueAtTime(1, time);
        const hp = audioCtx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.setValueAtTime(7000, time);
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.3, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
        osc.connect(bp); bp.connect(hp); hp.connect(gain); gain.connect(drumGain);
        osc.start(time); osc.stop(time + 0.06);
    }
}

function playClap(time) {
    if (!audioCtx || !drumGain) return;
    for (let offset = 0; offset < 3; offset++) {
        const noiseLen = audioCtx.sampleRate * 0.02;
        const noiseBuf = audioCtx.createBuffer(1, noiseLen, audioCtx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < noiseLen; i++) d[i] = Math.random() * 2 - 1;
        const noise = audioCtx.createBufferSource();
        noise.buffer = noiseBuf;
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(2000, time + offset * 0.01);
        filter.Q.setValueAtTime(2, time + offset * 0.01);
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.6, time + offset * 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, time + offset * 0.01 + 0.09);
        noise.connect(filter); filter.connect(gain); gain.connect(drumGain);
        noise.start(time + offset * 0.01); noise.stop(time + offset * 0.01 + 0.1);
    }
}

function playTom(time) {
    if (!audioCtx || !drumGain) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, time);
    osc.frequency.exponentialRampToValueAtTime(80, time + 0.2);
    gain.gain.setValueAtTime(0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
    osc.connect(gain); gain.connect(drumGain);
    osc.start(time); osc.stop(time + 0.4);
}

function playRim(time) {
    if (!audioCtx || !drumGain) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, time);
    gain.gain.setValueAtTime(0.6, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    osc.connect(gain); gain.connect(drumGain);
    osc.start(time); osc.stop(time + 0.05);
}

function playCowbell(time) {
    if (!audioCtx || !drumGain) return;
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.setValueAtTime(800, time); bp.Q.setValueAtTime(3, time);
    osc1.type = 'square'; osc1.frequency.setValueAtTime(800, time);
    osc2.type = 'square'; osc2.frequency.setValueAtTime(540, time);
    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    osc1.connect(bp); osc2.connect(bp); bp.connect(gain); gain.connect(drumGain);
    osc1.start(time); osc1.stop(time + 0.35);
    osc2.start(time); osc2.stop(time + 0.35);
}

function playOpenHH(time) {
    if (!audioCtx || !drumGain) return;
    const fundamental = 40;
    const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
    for (const ratio of ratios) {
        const osc = audioCtx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(fundamental * ratio, time);
        const bp = audioCtx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.setValueAtTime(10000, time); bp.Q.setValueAtTime(1, time);
        const hp = audioCtx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.setValueAtTime(7000, time);
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.25, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
        osc.connect(bp); bp.connect(hp); hp.connect(gain); gain.connect(drumGain);
        osc.start(time); osc.stop(time + 0.3);
    }
}

const drumSynths = {
    kick: playKick, snare: playSnare, hihat: playHiHat, clap: playClap,
    tom: playTom, rim: playRim, cowbell: playCowbell, openhh: playOpenHH,
};

// ── Pattern Presets ───────────────────────────────────────────────────────────

const DRUM_PRESETS = {
    rock: {
        label: 'Rock', steps: 16, pattern: [
            [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
            [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
            [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ]
    },
    funk: {
        label: 'Funk', steps: 16, pattern: [
            [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0],
            [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
            [1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
        ]
    },
    bossa: {
        label: 'Bossa Nova', steps: 16, pattern: [
            [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ]
    },
    trap: {
        label: 'Trap', steps: 16, pattern: [
            [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0],
            [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
            [1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1],
            [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
        ]
    },
    breakbeat: {
        label: 'Breakbeat', steps: 16, pattern: [
            [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0],
            [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
        ]
    },
    eightOhEight: {
        label: '808', steps: 16, pattern: [
            [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
            [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
            [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ]
    },
};

// ── Step Sequencer Engine ─────────────────────────────────────────────────────

function scheduleDrumStep() {
    while (drumNextStepTime < audioCtx.currentTime + drumScheduleAhead) {
        let swingOffset = 0;
        if (drumSwing > 0 && drumCurrentStep % 2 === 1) {
            const secondsPerBeat = 60.0 / drumBPM;
            const secondsPerStep = secondsPerBeat / 4;
            swingOffset = secondsPerStep * drumSwing * 0.33;
        }
        const schedTime = drumNextStepTime + swingOffset;

        for (let track = 0; track < DRUM_TRACKS.length; track++) {
            if (drumPattern[track] && drumPattern[track][drumCurrentStep] && isTrackAudible(track)) {
                drumSynths[DRUM_TRACKS[track]](schedTime);
            }
        }

        if (onDrumStepCallback) {
            const step = drumCurrentStep;
            const msUntil = (schedTime - audioCtx.currentTime) * 1000;
            setTimeout(() => onDrumStepCallback(step), Math.max(0, msUntil));
        }

        const secondsPerBeat = 60.0 / drumBPM;
        const secondsPerStep = secondsPerBeat / 4;
        drumNextStepTime += secondsPerStep;
        drumCurrentStep = (drumCurrentStep + 1) % DRUM_STEPS;
    }
}

export function startDrumSequencer() {
    if (!audioCtx || drumPlaying) return;
    if (!drumGain) {
        drumGain = audioCtx.createGain();
        drumGain.gain.setValueAtTime(drumVolume, audioCtx.currentTime);
        drumGain.connect(masterGain);
    }
    drumCurrentStep = 0;
    drumNextStepTime = audioCtx.currentTime;
    drumPlaying = true;
    drumTimerID = setInterval(scheduleDrumStep, drumLookahead);
}

export function stopDrumSequencer() {
    drumPlaying = false;
    if (drumTimerID !== null) { clearInterval(drumTimerID); drumTimerID = null; }
    drumCurrentStep = 0;
    if (onDrumStepCallback) onDrumStepCallback(-1);
}

export function toggleDrumStep(track, step) {
    if (track < 0 || track >= DRUM_TRACKS.length) return;
    if (step < 0 || step >= DRUM_STEPS) return;
    drumPattern[track][step] = !drumPattern[track][step];
    return drumPattern[track][step];
}

export function getDrumPattern() { return drumPattern; }
export function setDrumBPM(bpm) {
    drumBPM = Math.max(40, Math.min(240, bpm));
    globalBPM = drumBPM;
    if (onTempoChangeCallback) onTempoChangeCallback(globalBPM);
}

export function setDrumVolume(vol) {
    drumVolume = Math.max(0, Math.min(1, vol));
    if (drumGain && audioCtx) drumGain.gain.setTargetAtTime(drumVolume, audioCtx.currentTime, 0.01);
}

export function clearDrumPattern() {
    drumPattern = DRUM_TRACKS.map(() => new Array(DRUM_STEPS).fill(false));
}

export function isDrumPlaying() { return drumPlaying; }
export function setDrumStepCallback(cb) { onDrumStepCallback = cb; }

// ── New Drum Exports ──────────────────────────────────────────────────────────

export function getDrumTrackNames() { return [...DRUM_TRACKS]; }
export function getDrumStepCount() { return DRUM_STEPS; }

export function setDrumSwing(value) { drumSwing = Math.max(0, Math.min(1, value)); }

export function setDrumStepCount(count) {
    const newCount = count === 32 ? 32 : 16;
    if (newCount === DRUM_STEPS) return;
    const wasPlaying = drumPlaying;
    if (wasPlaying) stopDrumSequencer();
    const oldPattern = drumPattern;
    DRUM_STEPS = newCount;
    drumPattern = DRUM_TRACKS.map((_, t) => {
        const row = new Array(DRUM_STEPS).fill(false);
        for (let s = 0; s < Math.min(oldPattern[t].length, DRUM_STEPS); s++) row[s] = oldPattern[t][s];
        return row;
    });
    if (wasPlaying) startDrumSequencer();
}

export function setDrumMute(track, muted) {
    if (track >= 0 && track < DRUM_TRACKS.length) drumMute[track] = muted;
}

export function setDrumSolo(track, soloed) {
    if (track >= 0 && track < DRUM_TRACKS.length) drumSolo[track] = soloed;
}

export function clearDrumSolos() { drumSolo.fill(false); }
export function getDrumMuteState() { return [...drumMute]; }
export function getDrumSoloState() { return [...drumSolo]; }

export function loadDrumPreset(presetKey) {
    const preset = DRUM_PRESETS[presetKey];
    if (!preset) return false;
    const wasPlaying = drumPlaying;
    if (wasPlaying) stopDrumSequencer();
    DRUM_STEPS = preset.steps;
    drumPattern = preset.pattern.map(row => row.map(v => !!v));
    while (drumPattern.length < DRUM_TRACKS.length) drumPattern.push(new Array(DRUM_STEPS).fill(false));
    if (wasPlaying) startDrumSequencer();
    return true;
}

export function getDrumPresetNames() {
    return Object.entries(DRUM_PRESETS).map(([key, val]) => ({ key, label: val.label }));
}

// ── Global Tempo ──────────────────────────────────────────────────────────────

export function setGlobalBPM(bpm) {
    globalBPM = Math.max(40, Math.min(240, bpm));
    drumBPM = globalBPM;
    // Re-sync arp timing if active
    if (arp.enabled && arpTimer) {
        clearInterval(arpTimer);
        arpTimer = setInterval(arpTick, arpRateMs());
    }
    if (onTempoChangeCallback) onTempoChangeCallback(globalBPM);
}

export function getGlobalBPM() { return globalBPM; }

export function setTempoChangeCallback(cb) { onTempoChangeCallback = cb; }

// ── Synth Presets ─────────────────────────────────────────────────────────────

const SYNTH_PRESETS = {
    init: {
        label: 'Init',
        waveform: 'sawtooth',
        filter: { cutoff: 8000, q: 1, type: 'lowpass' },
        distortion: { drive: 0 },
        wah: { enabled: false, rate: 2, depth: 4000, baseFreq: 500 },
        delay: { time: 0.3, feedback: 0.3, mix: 0 },
        reverb: { mix: 0, decay: 1.5 },
        adsr: { attack: 0.05, decay: 0.15, sustain: 0.6, release: 0.3 },
        octaveShift: 0,
    },
    lead: {
        label: 'Fat Lead',
        waveform: 'sawtooth',
        filter: { cutoff: 3500, q: 4, type: 'lowpass' },
        distortion: { drive: 0.3 },
        wah: { enabled: false, rate: 2, depth: 4000, baseFreq: 500 },
        delay: { time: 0.35, feedback: 0.35, mix: 0.2 },
        reverb: { mix: 0.15, decay: 1.2 },
        adsr: { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.2 },
        octaveShift: 0,
    },
    pad: {
        label: 'Lush Pad',
        waveform: 'triangle',
        filter: { cutoff: 2000, q: 0.5, type: 'lowpass' },
        distortion: { drive: 0 },
        wah: { enabled: false, rate: 0.5, depth: 2000, baseFreq: 300 },
        delay: { time: 0.4, feedback: 0.4, mix: 0.3 },
        reverb: { mix: 0.5, decay: 3.0 },
        adsr: { attack: 0.5, decay: 0.3, sustain: 0.9, release: 1.0 },
        octaveShift: 0,
    },
    pluck: {
        label: 'Pluck',
        waveform: 'sawtooth',
        filter: { cutoff: 5000, q: 2, type: 'lowpass' },
        distortion: { drive: 0 },
        wah: { enabled: false, rate: 2, depth: 4000, baseFreq: 500 },
        delay: { time: 0.25, feedback: 0.2, mix: 0.15 },
        reverb: { mix: 0.2, decay: 1.0 },
        adsr: { attack: 0.005, decay: 0.25, sustain: 0.1, release: 0.15 },
        octaveShift: 0,
    },
    bass: {
        label: 'Deep Bass',
        waveform: 'sawtooth',
        filter: { cutoff: 800, q: 6, type: 'lowpass' },
        distortion: { drive: 0.2 },
        wah: { enabled: false, rate: 2, depth: 4000, baseFreq: 500 },
        delay: { time: 0.3, feedback: 0.1, mix: 0 },
        reverb: { mix: 0, decay: 0.8 },
        adsr: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.15 },
        octaveShift: -2,
    },
    bell: {
        label: 'Crystal Bell',
        waveform: 'sine',
        filter: { cutoff: 12000, q: 0.5, type: 'lowpass' },
        distortion: { drive: 0 },
        wah: { enabled: false, rate: 2, depth: 4000, baseFreq: 500 },
        delay: { time: 0.5, feedback: 0.45, mix: 0.35 },
        reverb: { mix: 0.6, decay: 4.0 },
        adsr: { attack: 0.001, decay: 0.8, sustain: 0.0, release: 1.5 },
        octaveShift: 1,
    },
    acid: {
        label: 'Acid Squelch',
        waveform: 'square',
        filter: { cutoff: 600, q: 12, type: 'lowpass' },
        distortion: { drive: 0.5 },
        wah: { enabled: true, rate: 4, depth: 5000, baseFreq: 200 },
        delay: { time: 0.2, feedback: 0.3, mix: 0.1 },
        reverb: { mix: 0.05, decay: 0.6 },
        adsr: { attack: 0.005, decay: 0.15, sustain: 0.4, release: 0.1 },
        octaveShift: -1,
    },
};

export function loadSynthPreset(presetKey) {
    const p = SYNTH_PRESETS[presetKey];
    if (!p) return false;

    // Waveform
    waveform = p.waveform;

    // Filter
    if (filterNode) {
        filterNode.frequency.setTargetAtTime(p.filter.cutoff, audioCtx.currentTime, 0.02);
        filterNode.Q.setTargetAtTime(p.filter.q, audioCtx.currentTime, 0.02);
        filterNode.type = p.filter.type;
    }
    effectParams.filter = { ...p.filter };

    // Distortion
    if (distortionNode) {
        const k = p.distortion.drive;
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            const x = (i / 128) - 1;
            curve[i] = k > 0 ? ((1 + k) * x) / (1 + k * Math.abs(x)) : x;
        }
        distortionNode.curve = curve;
    }
    effectParams.distortion = { ...p.distortion };

    // Wah
    effectParams.wah = { ...p.wah };

    // Delay
    if (delayNode) delayNode.delayTime.setTargetAtTime(p.delay.time, audioCtx.currentTime, 0.02);
    effectParams.delay = { ...p.delay };

    // Reverb
    effectParams.reverb = { ...p.reverb };

    // ADSR
    effectParams.adsr = { ...p.adsr };

    // Octave
    effectParams.octaveShift = p.octaveShift;

    return true;
}

export function getSynthPresetNames() {
    return Object.entries(SYNTH_PRESETS).map(([key, val]) => ({ key, label: val.label }));
}

export function getCurrentSynthParams() {
    return { waveform, ...effectParams };
}
