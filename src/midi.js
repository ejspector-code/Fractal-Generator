/**
 * MIDI Keyboard Synthesizer — Web MIDI API + Web Audio API polyphonic synth.
 * Generates real audio from MIDI input and exposes an AnalyserNode for FFT data,
 * allowing the fractal's audio-reactive system to respond to played notes.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_VOICES = 8;
const FFT_SIZE = 2048;
const SMOOTHING = 0.8;

// ADSR defaults (seconds)
const DEFAULT_ATTACK = 0.05;
const DEFAULT_DECAY = 0.15;
const DEFAULT_SUSTAIN = 0.6;
const DEFAULT_RELEASE = 0.3;

// ── State ─────────────────────────────────────────────────────────────────────

let audioCtx = null;
let analyser = null;
let masterGain = null;
let filterNode = null;
let frequencyData = null;
let timeDomainData = null;
let midiAccess = null;
let active = false;
let waveform = 'sawtooth'; // 'sine' | 'square' | 'sawtooth' | 'triangle'

/** @type {Map<number, Voice>} Active voices keyed by MIDI note number */
const voices = new Map();

/** @type {Set<number>} Currently held notes for visualization */
const activeNotes = new Set();

/** @type {function|null} External callback for note events */
let onNoteCallback = null;

// ── Voice Class ───────────────────────────────────────────────────────────────

class Voice {
    constructor(note, velocity) {
        const freq = 440 * Math.pow(2, (note - 69) / 12);
        const vel = velocity / 127;

        // Oscillator
        this.osc = audioCtx.createOscillator();
        this.osc.type = waveform;
        this.osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

        // Gain envelope
        this.gainNode = audioCtx.createGain();
        this.gainNode.gain.setValueAtTime(0, audioCtx.currentTime);

        // ADSR envelope — Attack
        this.gainNode.gain.linearRampToValueAtTime(
            vel * 0.4,
            audioCtx.currentTime + DEFAULT_ATTACK
        );
        // Decay to sustain
        this.gainNode.gain.linearRampToValueAtTime(
            vel * 0.4 * DEFAULT_SUSTAIN,
            audioCtx.currentTime + DEFAULT_ATTACK + DEFAULT_DECAY
        );

        // Connect: osc → gain → filter → master
        this.osc.connect(this.gainNode);
        this.gainNode.connect(filterNode);

        this.osc.start();
        this.note = note;
        this.released = false;
    }

    release() {
        if (this.released) return;
        this.released = true;
        const now = audioCtx.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(0, now + DEFAULT_RELEASE);
        // Clean up after release
        setTimeout(() => {
            try {
                this.osc.stop();
                this.osc.disconnect();
                this.gainNode.disconnect();
            } catch (e) { /* already stopped */ }
        }, DEFAULT_RELEASE * 1000 + 50);
    }
}

// ── MIDI Helpers ──────────────────────────────────────────────────────────────

function handleMidiMessage(event) {
    const [status, note, velocity] = event.data;
    const command = status & 0xf0;

    switch (command) {
        case 0x90: // Note On
            if (velocity > 0) {
                noteOn(note, velocity);
            } else {
                noteOff(note); // velocity 0 = note off
            }
            break;
        case 0x80: // Note Off
            noteOff(note);
            break;
        case 0xb0: // Control Change
            handleCC(note, velocity); // note = CC number, velocity = value
            break;
    }
}

export function noteOn(note, velocity = 100) {
    if (!active || !audioCtx) return;
    // Kill existing voice on same note
    if (voices.has(note)) {
        voices.get(note).release();
        voices.delete(note);
    }

    // Voice stealing: if at max, release oldest
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

export function noteOff(note) {
    if (!active) return;
    if (voices.has(note)) {
        voices.get(note).release();
        voices.delete(note);
    }
    activeNotes.delete(note);

    if (onNoteCallback) onNoteCallback({ type: 'off', note });
}

function handleCC(cc, value) {
    // CC 1 = Mod Wheel → filter cutoff
    if (cc === 1 && filterNode) {
        const minFreq = 200;
        const maxFreq = 12000;
        const freq = minFreq + (value / 127) * (maxFreq - minFreq);
        filterNode.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.01);
    }
    // CC 74 = Brightness → also filter cutoff (MPE common)
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
    // Handle hot-plug
    midiAccess.onstatechange = (e) => {
        if (e.port.type === 'input' && e.port.state === 'connected') {
            e.port.onmidimessage = handleMidiMessage;
        }
    };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialize MIDI access and audio engine.
 * @returns {Promise<{ok: boolean, error?: string, devices?: string[]}>}
 */
export async function startMidi() {
    if (active) return { ok: true };

    try {
        // Create audio context and nodes first (always works)
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // Low-pass filter
        filterNode = audioCtx.createBiquadFilter();
        filterNode.type = 'lowpass';
        filterNode.frequency.setValueAtTime(8000, audioCtx.currentTime);
        filterNode.Q.setValueAtTime(1, audioCtx.currentTime);

        // Master gain
        masterGain = audioCtx.createGain();
        masterGain.gain.setValueAtTime(0.5, audioCtx.currentTime);

        // Analyser for FFT
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = SMOOTHING;

        // Signal chain: voices → filter → masterGain → analyser → destination
        filterNode.connect(masterGain);
        masterGain.connect(analyser);
        analyser.connect(audioCtx.destination);

        frequencyData = new Uint8Array(analyser.frequencyBinCount);
        timeDomainData = new Uint8Array(analyser.fftSize);

        active = true;

        // Try to connect MIDI hardware (optional — synth works without it)
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

/**
 * Stop MIDI synth and release all resources.
 */
export function stopMidi() {
    // Release all voices
    for (const voice of voices.values()) {
        voice.release();
    }
    voices.clear();
    activeNotes.clear();
    cleanup();
}

function cleanup() {
    active = false;

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
    frequencyData = null;
    timeDomainData = null;
}

/**
 * @returns {boolean} Whether MIDI synth is active
 */
export function isMidiActive() {
    return active;
}

/**
 * Get FFT frequency data from the synth output.
 * @returns {Uint8Array|null}
 */
export function getMidiFrequencyData() {
    if (!active || !analyser || !frequencyData) return null;
    analyser.getByteFrequencyData(frequencyData);
    return frequencyData;
}

/**
 * @returns {number} Audio context sample rate
 */
export function getMidiSampleRate() {
    return audioCtx ? audioCtx.sampleRate : 44100;
}

/**
 * @returns {number} Number of frequency bins
 */
export function getMidiBinCount() {
    return analyser ? analyser.frequencyBinCount : FFT_SIZE / 2;
}

/**
 * Get time-domain waveform data from the synth output.
 * @returns {Uint8Array|null}
 */
export function getMidiTimeDomainData() {
    if (!active || !analyser || !timeDomainData) return null;
    analyser.getByteTimeDomainData(timeDomainData);
    return timeDomainData;
}

/**
 * Set the oscillator waveform for new notes.
 * @param {'sine'|'square'|'sawtooth'|'triangle'} type
 */
export function setMidiWaveform(type) {
    waveform = type;
    // Update existing voices
    for (const voice of voices.values()) {
        voice.osc.type = type;
    }
}

/**
 * @returns {Set<number>} Currently active MIDI note numbers
 */
export function getMidiActiveNotes() {
    return activeNotes;
}

/**
 * Get list of connected MIDI input device names.
 * @returns {string[]}
 */
export function getMidiDevices() {
    if (!midiAccess) return [];
    const devices = [];
    for (const input of midiAccess.inputs.values()) {
        devices.push(input.name);
    }
    return devices;
}

/**
 * Set a callback for note on/off events (for UI visualization).
 * @param {function} cb - Called with { type: 'on'|'off', note, velocity? }
 */
export function setNoteCallback(cb) {
    onNoteCallback = cb;
}
