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

// Looper state
let looperRecorder = null;
let looperSource = null;
let looperBuffer = null;
let looperIsRecording = false;
let looperIsPlaying = false;
let looperGain = null;
let looperRecordingChunks = [];
let looperStream = null;

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

export function noteOn(note, velocity = 100) {
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

        // reverbMerge → masterGain → analyser → destination
        reverbMerge.connect(masterGain);
        looperGain.connect(masterGain);
        masterGain.connect(analyser);
        analyser.connect(audioCtx.destination);

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

// ── Looper ────────────────────────────────────────────────────────────────────

export function startLooperRecording() {
    if (!audioCtx || !masterGain || looperIsRecording) return;

    // Create a MediaStream from the master output
    const dest = audioCtx.createMediaStreamDestination();
    masterGain.connect(dest);
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
        if (looperStream) masterGain.disconnect(looperStream);
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
    return effectParams;
}

// ── Drum Machine ──────────────────────────────────────────────────────────────

const DRUM_TRACKS = ['kick', 'snare', 'hihat', 'clap'];
const DRUM_STEPS = 16;

let drumPattern = DRUM_TRACKS.map(() => new Array(DRUM_STEPS).fill(false));
let drumBPM = 120;
let drumVolume = 0.7;
let drumPlaying = false;
let drumTimerID = null;
let drumCurrentStep = 0;
let drumGain = null;
let drumNextStepTime = 0;
let drumLookahead = 25; // ms
let drumScheduleAhead = 0.1; // seconds
let onDrumStepCallback = null;

// ── Drum Synthesis ────────────────────────────────────────────────────────────

function playKick(time) {
    if (!audioCtx || !drumGain) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const click = audioCtx.createOscillator();
    const clickGain = audioCtx.createGain();

    // Body — sine sweep from 150Hz down to 40Hz
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
    gain.gain.setValueAtTime(1.0, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);

    // Click transient
    click.type = 'square';
    click.frequency.setValueAtTime(800, time);
    click.frequency.exponentialRampToValueAtTime(100, time + 0.02);
    clickGain.gain.setValueAtTime(0.6, time);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.03);

    osc.connect(gain);
    gain.connect(drumGain);
    click.connect(clickGain);
    clickGain.connect(drumGain);

    osc.start(time);
    osc.stop(time + 0.45);
    click.start(time);
    click.stop(time + 0.04);
}

function playSnare(time) {
    if (!audioCtx || !drumGain) return;

    // Noise burst
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

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(drumGain);

    // Tone body
    const osc = audioCtx.createOscillator();
    const oscGain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, time);
    osc.frequency.exponentialRampToValueAtTime(80, time + 0.07);
    oscGain.gain.setValueAtTime(0.5, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

    osc.connect(oscGain);
    oscGain.connect(drumGain);

    noise.start(time);
    noise.stop(time + 0.15);
    osc.start(time);
    osc.stop(time + 0.12);
}

function playHiHat(time) {
    if (!audioCtx || !drumGain) return;

    // Metallic noise
    const noiseLen = audioCtx.sampleRate * 0.08;
    const noiseBuf = audioCtx.createBuffer(1, noiseLen, audioCtx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) data[i] = Math.random() * 2 - 1;

    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuf;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(7000, time);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(drumGain);

    noise.start(time);
    noise.stop(time + 0.08);
}

function playClap(time) {
    if (!audioCtx || !drumGain) return;

    // Layered noise bursts for clap texture
    for (let b = 0; b < 3; b++) {
        const offset = b * 0.012;
        const noiseLen = audioCtx.sampleRate * 0.1;
        const noiseBuf = audioCtx.createBuffer(1, noiseLen, audioCtx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < noiseLen; i++) data[i] = Math.random() * 2 - 1;

        const noise = audioCtx.createBufferSource();
        noise.buffer = noiseBuf;

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(2000, time + offset);
        filter.Q.setValueAtTime(2, time + offset);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.6, time + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, time + offset + 0.09);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(drumGain);

        noise.start(time + offset);
        noise.stop(time + offset + 0.1);
    }
}

const drumSynths = { kick: playKick, snare: playSnare, hihat: playHiHat, clap: playClap };

// ── Step Sequencer Engine ─────────────────────────────────────────────────────

function scheduleDrumStep() {
    while (drumNextStepTime < audioCtx.currentTime + drumScheduleAhead) {
        // Trigger sounds for this step
        for (let track = 0; track < DRUM_TRACKS.length; track++) {
            if (drumPattern[track][drumCurrentStep]) {
                drumSynths[DRUM_TRACKS[track]](drumNextStepTime);
            }
        }

        // Notify UI of current step
        if (onDrumStepCallback) {
            const step = drumCurrentStep;
            // Use setTimeout to sync visual with audio (approximate)
            const msUntil = (drumNextStepTime - audioCtx.currentTime) * 1000;
            setTimeout(() => onDrumStepCallback(step), Math.max(0, msUntil));
        }

        // Advance
        const secondsPerBeat = 60.0 / drumBPM;
        const secondsPerStep = secondsPerBeat / 4; // 16th notes
        drumNextStepTime += secondsPerStep;
        drumCurrentStep = (drumCurrentStep + 1) % DRUM_STEPS;
    }
}

export function startDrumSequencer() {
    if (!audioCtx || drumPlaying) return;

    // Create drum gain node if needed
    if (!drumGain) {
        drumGain = audioCtx.createGain();
        drumGain.gain.setValueAtTime(drumVolume, audioCtx.currentTime);
        drumGain.connect(masterGain);
    }

    drumCurrentStep = 0;
    drumNextStepTime = audioCtx.currentTime;
    drumPlaying = true;

    // Use setInterval for lookahead scheduler
    drumTimerID = setInterval(scheduleDrumStep, drumLookahead);
}

export function stopDrumSequencer() {
    drumPlaying = false;
    if (drumTimerID !== null) {
        clearInterval(drumTimerID);
        drumTimerID = null;
    }
    drumCurrentStep = 0;
    if (onDrumStepCallback) onDrumStepCallback(-1); // clear highlight
}

export function toggleDrumStep(track, step) {
    if (track < 0 || track >= DRUM_TRACKS.length) return;
    if (step < 0 || step >= DRUM_STEPS) return;
    drumPattern[track][step] = !drumPattern[track][step];
    return drumPattern[track][step];
}

export function getDrumPattern() {
    return drumPattern;
}

export function setDrumBPM(bpm) {
    drumBPM = Math.max(40, Math.min(240, bpm));
}

export function setDrumVolume(vol) {
    drumVolume = Math.max(0, Math.min(1, vol));
    if (drumGain && audioCtx) {
        drumGain.gain.setTargetAtTime(drumVolume, audioCtx.currentTime, 0.01);
    }
}

export function clearDrumPattern() {
    drumPattern = DRUM_TRACKS.map(() => new Array(DRUM_STEPS).fill(false));
}

export function isDrumPlaying() {
    return drumPlaying;
}

export function setDrumStepCallback(cb) {
    onDrumStepCallback = cb;
}
