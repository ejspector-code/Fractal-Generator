/**
 * Audio Reactive — transforms raw FFT frequency data into musical features
 * that drive fractal coefficient modulation.
 *
 * Output shape matches Animator.setAudioModulation() expectations:
 *   { bass, mid, treble, energy, beat }   (all 0→1)
 */

// ── Band Ranges (Hz) ──────────────────────────────────────────────────────────
const BASS_LOW = 20;
const BASS_HIGH = 250;
const MID_LOW = 250;
const MID_HIGH = 2000;
const TREBLE_LOW = 2000;
const TREBLE_HIGH = 16000;

// ── Smoothing ─────────────────────────────────────────────────────────────────
const SMOOTH_FACTOR = 0.3;  // Lower = smoother (exponential moving average)

// ── Beat Detection ────────────────────────────────────────────────────────────
const BEAT_THRESHOLD = 0.35;    // Energy spike must exceed this above average
const BEAT_COOLDOWN_MS = 200;   // Min interval between beats
const ENERGY_HISTORY_LEN = 30;  // Frames to track for average energy

// ── State ─────────────────────────────────────────────────────────────────────
let prevBass = 0;
let prevMid = 0;
let prevTreble = 0;
let prevEnergy = 0;
let prevBeat = 0;

let energyHistory = [];
let lastBeatTime = 0;

/**
 * Analyze a frame of frequency data and return musical features.
 *
 * @param {Uint8Array} frequencyData - Raw FFT bins (0–255)
 * @param {number} sampleRate - AudioContext sample rate (e.g. 44100)
 * @param {number} binCount - Number of frequency bins
 * @param {number} sensitivity - User-adjustable multiplier (default 1.0)
 * @returns {{ bass: number, mid: number, treble: number, energy: number, beat: number }}
 */
export function analyzeFrame(frequencyData, sampleRate, binCount, sensitivity = 1.0) {
    if (!frequencyData || frequencyData.length === 0) {
        return { bass: 0, mid: 0, treble: 0, energy: 0, beat: 0 };
    }

    const hzPerBin = sampleRate / (binCount * 2);

    // ── Band Averages ─────────────────────────────────────────────────────────
    const rawBass = bandAverage(frequencyData, hzPerBin, BASS_LOW, BASS_HIGH);
    const rawMid = bandAverage(frequencyData, hzPerBin, MID_LOW, MID_HIGH);
    const rawTreble = bandAverage(frequencyData, hzPerBin, TREBLE_LOW, TREBLE_HIGH);

    // Normalize to 0→1 and apply sensitivity
    const bass = clamp(rawBass * sensitivity);
    const mid = clamp(rawMid * sensitivity);
    const treble = clamp(rawTreble * sensitivity);

    // ── Overall Energy ────────────────────────────────────────────────────────
    const energy = clamp((bass * 0.5 + mid * 0.35 + treble * 0.15) * sensitivity);

    // ── Beat Detection ────────────────────────────────────────────────────────
    energyHistory.push(energy);
    if (energyHistory.length > ENERGY_HISTORY_LEN) energyHistory.shift();

    const avgEnergy = energyHistory.reduce((a, b) => a + b, 0) / energyHistory.length;
    const now = performance.now();
    let beat = 0;

    if (energy > avgEnergy + BEAT_THRESHOLD && now - lastBeatTime > BEAT_COOLDOWN_MS) {
        beat = 1.0;
        lastBeatTime = now;
    }

    // ── Smooth Output ─────────────────────────────────────────────────────────
    const smoothBass = smooth(prevBass, bass);
    const smoothMid = smooth(prevMid, mid);
    const smoothTreble = smooth(prevTreble, treble);
    const smoothEnergy = smooth(prevEnergy, energy);
    const smoothBeat = beat > 0 ? 1.0 : smooth(prevBeat, 0);  // Beat snaps on, decays off

    prevBass = smoothBass;
    prevMid = smoothMid;
    prevTreble = smoothTreble;
    prevEnergy = smoothEnergy;
    prevBeat = smoothBeat;

    return {
        bass: smoothBass,
        mid: smoothMid,
        treble: smoothTreble,
        energy: smoothEnergy,
        beat: smoothBeat,
    };
}

/**
 * Reset internal state (call when audio stops/restarts).
 */
export function resetAnalysis() {
    prevBass = prevMid = prevTreble = prevEnergy = prevBeat = 0;
    energyHistory = [];
    lastBeatTime = 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bandAverage(data, hzPerBin, lowHz, highHz) {
    const startBin = Math.max(0, Math.floor(lowHz / hzPerBin));
    const endBin = Math.min(data.length - 1, Math.floor(highHz / hzPerBin));

    if (endBin <= startBin) return 0;

    let sum = 0;
    for (let i = startBin; i <= endBin; i++) {
        sum += data[i];
    }
    // Normalize: data values are 0–255, return 0→1
    return (sum / (endBin - startBin + 1)) / 255;
}

function smooth(prev, current) {
    return prev + (current - prev) * SMOOTH_FACTOR;
}

function clamp(v) {
    return Math.max(0, Math.min(1, v));
}
