// ── Bass Synthesizer ─────────────────────────────────────────────────────────
// Monophonic acid-style bass with glide, sub-oscillator, and filter envelope.
// Connects directly to an external gain node (masterGain) to stay separate
// from the looper's synth-only recording bus.

let audioCtx = null;
let masterGain = null;   // external master gain to connect into
let bassGain = null;     // our output gain
let active = false;

// Oscillator state
let osc1 = null;         // main oscillator
let osc2 = null;         // sub-oscillator (1 octave down)
let filterNode = null;
let envGain = null;      // amplitude envelope VCA

// Voice params
let params = {
    waveform: 'sawtooth',     // main osc: sawtooth, square, triangle
    subWave: 'square',        // sub osc waveform
    subLevel: 0.5,            // sub osc mix 0-1
    cutoff: 1200,             // filter cutoff Hz
    resonance: 8,             // filter Q
    envAmount: 3000,          // filter envelope amount (Hz above cutoff)
    envDecay: 0.25,           // filter envelope decay time
    attack: 0.005,            // amp attack
    decay: 0.1,               // amp decay
    sustain: 0.8,             // amp sustain level
    release: 0.15,            // amp release
    glide: 0.06,              // portamento time in seconds
    volume: 0.7,              // master volume
    accent: false,            // accent mode: boosts filter env
    octave: 0,                // octave shift (-2 to +2)
};

// Current state
let currentNote = -1;
let currentFreq = 0;
let subGain = null;
let noteOnCallback = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function midiToFreq(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
}

// ── Init / Destroy ───────────────────────────────────────────────────────────

export function initBass(ctx, masterOut) {
    audioCtx = ctx;
    masterGain = masterOut;
    active = true;

    // Bass output chain: envGain → filter → bassGain → masterGain
    bassGain = audioCtx.createGain();
    bassGain.gain.value = params.volume;

    filterNode = audioCtx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.value = params.cutoff;
    filterNode.Q.value = params.resonance;

    envGain = audioCtx.createGain();
    envGain.gain.value = 0;

    subGain = audioCtx.createGain();
    subGain.gain.value = params.subLevel;

    // Route: envGain → filter → bassGain → masterGain
    envGain.connect(filterNode);
    subGain.connect(filterNode);
    filterNode.connect(bassGain);
    bassGain.connect(masterGain);
}

export function destroyBass() {
    if (osc1) { try { osc1.stop(); } catch (e) { } osc1 = null; }
    if (osc2) { try { osc2.stop(); } catch (e) { } osc2 = null; }
    if (bassGain) { try { bassGain.disconnect(); } catch (e) { } }
    if (filterNode) { try { filterNode.disconnect(); } catch (e) { } }
    if (envGain) { try { envGain.disconnect(); } catch (e) { } }
    if (subGain) { try { subGain.disconnect(); } catch (e) { } }
    active = false;
    currentNote = -1;
}

export function isBassActive() { return active; }

// ── Note On / Off ────────────────────────────────────────────────────────────

export function bassNoteOn(note, velocity = 0.8) {
    if (!active || !audioCtx) return;

    const shiftedNote = note + params.octave * 12;
    const freq = midiToFreq(shiftedNote);
    const subFreq = freq / 2; // sub-osc = 1 octave below
    const now = audioCtx.currentTime;
    const vel = Math.max(0.1, Math.min(1, velocity));

    if (currentNote >= 0 && osc1) {
        // GLIDE: slide frequency to new note
        osc1.frequency.cancelScheduledValues(now);
        osc1.frequency.setTargetAtTime(freq, now, params.glide);
        osc2.frequency.cancelScheduledValues(now);
        osc2.frequency.setTargetAtTime(subFreq, now, params.glide);
    } else {
        // New voice: create oscillators
        osc1 = audioCtx.createOscillator();
        osc1.type = params.waveform;
        osc1.frequency.value = freq;
        osc1.connect(envGain);
        osc1.start(now);

        osc2 = audioCtx.createOscillator();
        osc2.type = params.subWave;
        osc2.frequency.value = subFreq;
        osc2.connect(subGain);
        osc2.start(now);
    }

    currentNote = note;
    currentFreq = freq;

    // Amplitude envelope
    envGain.gain.cancelScheduledValues(now);
    envGain.gain.setValueAtTime(envGain.gain.value, now);
    envGain.gain.linearRampToValueAtTime(vel, now + params.attack);
    envGain.gain.linearRampToValueAtTime(vel * params.sustain, now + params.attack + params.decay);

    // Filter envelope — sweep from cutoff + envAmount back to cutoff
    const accent = params.accent ? 1.5 : 1;
    const peakCutoff = Math.min(params.cutoff + params.envAmount * accent, 18000);
    filterNode.frequency.cancelScheduledValues(now);
    filterNode.frequency.setValueAtTime(peakCutoff, now);
    filterNode.frequency.exponentialRampToValueAtTime(
        Math.max(params.cutoff, 20), now + params.envDecay
    );

    if (noteOnCallback) noteOnCallback(note);
}

export function bassNoteOff(note) {
    if (!active || !audioCtx) return;
    if (note !== currentNote) return; // only release if it's the current note

    const now = audioCtx.currentTime;

    // Release envelope
    envGain.gain.cancelScheduledValues(now);
    envGain.gain.setValueAtTime(envGain.gain.value, now);
    envGain.gain.linearRampToValueAtTime(0, now + params.release);

    // Schedule oscillator cleanup
    setTimeout(() => {
        if (currentNote === note || currentNote === -1) {
            if (osc1) { try { osc1.stop(); } catch (e) { } osc1 = null; }
            if (osc2) { try { osc2.stop(); } catch (e) { } osc2 = null; }
            currentNote = -1;
        }
    }, (params.release + 0.1) * 1000);
}

// ── Parameter Setters ────────────────────────────────────────────────────────

export function setBassWaveform(type) { params.waveform = type; if (osc1) osc1.type = type; }
export function setBassSubWave(type) { params.subWave = type; if (osc2) osc2.type = type; }
export function setBassSubLevel(level) {
    params.subLevel = Math.max(0, Math.min(1, level));
    if (subGain) subGain.gain.setTargetAtTime(params.subLevel, audioCtx.currentTime, 0.02);
}
export function setBassCutoff(freq) {
    params.cutoff = Math.max(20, Math.min(18000, freq));
    if (filterNode) filterNode.frequency.setTargetAtTime(params.cutoff, audioCtx.currentTime, 0.05);
}
export function setBassResonance(q) {
    params.resonance = Math.max(0, Math.min(25, q));
    if (filterNode) filterNode.Q.setTargetAtTime(params.resonance, audioCtx.currentTime, 0.02);
}
export function setBassEnvAmount(amt) { params.envAmount = Math.max(0, Math.min(10000, amt)); }
export function setBassEnvDecay(t) { params.envDecay = Math.max(0.01, Math.min(2, t)); }
export function setBassAttack(t) { params.attack = Math.max(0.001, Math.min(0.5, t)); }
export function setBassDecay(t) { params.decay = Math.max(0.01, Math.min(1, t)); }
export function setBassSustain(s) { params.sustain = Math.max(0, Math.min(1, s)); }
export function setBassRelease(t) { params.release = Math.max(0.01, Math.min(2, t)); }
export function setBassGlide(t) {
    params.glide = Math.max(0, Math.min(0.5, t));
}
export function setBassVolume(v) {
    params.volume = Math.max(0, Math.min(1, v));
    if (bassGain) bassGain.gain.setTargetAtTime(params.volume, audioCtx.currentTime, 0.02);
}
export function setBassAccent(on) { params.accent = !!on; }
export function setBassOctave(oct) { params.octave = Math.max(-2, Math.min(2, oct)); }

export function setBassNoteCallback(cb) { noteOnCallback = cb; }

export function getBassParams() { return { ...params }; }

// ── Audio data for visualizer ────────────────────────────────────────────────

let bassAnalyser = null;

export function getBassFrequencyData() {
    if (!bassAnalyser) return null;
    const data = new Uint8Array(bassAnalyser.frequencyBinCount);
    bassAnalyser.getByteFrequencyData(data);
    return data;
}

export function getBassTimeDomainData() {
    if (!bassAnalyser) return null;
    const data = new Uint8Array(bassAnalyser.frequencyBinCount);
    bassAnalyser.getByteTimeDomainData(data);
    return data;
}

export function getBassSampleRate() { return audioCtx ? audioCtx.sampleRate : 44100; }
export function getBassBinCount() { return bassAnalyser ? bassAnalyser.frequencyBinCount : 0; }

export function initBassAnalyser() {
    if (!audioCtx || !bassGain) return;
    bassAnalyser = audioCtx.createAnalyser();
    bassAnalyser.fftSize = 2048;
    bassGain.connect(bassAnalyser);
}
