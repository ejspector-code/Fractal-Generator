/**
 * Audio Capture — Web Audio API wrapper for microphone/system audio input.
 * Uses AnalyserNode for real-time FFT frequency data.
 */

let audioContext = null;
let analyser = null;
let mediaStream = null;
let frequencyData = null;
let active = false;

const FFT_SIZE = 2048;
const SMOOTHING = 0.8;

/**
 * Request microphone access and start the audio pipeline.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function startAudio() {
    if (active) return { ok: true };

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(mediaStream);

        analyser = audioContext.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = SMOOTHING;

        source.connect(analyser);
        // Do NOT connect analyser to destination — we don't want feedback

        frequencyData = new Uint8Array(analyser.frequencyBinCount);
        active = true;

        return { ok: true };
    } catch (err) {
        console.error('[Audio] Failed to start:', err);
        cleanup();
        if (err.name === 'NotAllowedError') {
            return { ok: false, error: 'Microphone permission denied' };
        }
        if (err.name === 'NotFoundError') {
            return { ok: false, error: 'No microphone found' };
        }
        return { ok: false, error: err.message || 'Unknown error' };
    }
}

/**
 * Stop audio capture and release resources.
 */
export function stopAudio() {
    cleanup();
}

function cleanup() {
    active = false;
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    if (audioContext) {
        audioContext.close().catch(() => { });
        audioContext = null;
    }
    analyser = null;
    frequencyData = null;
}

/**
 * Get current frequency data (Uint8Array, 0–255 per bin).
 * Call this once per frame. Returns null if not active.
 */
export function getFrequencyData() {
    if (!active || !analyser || !frequencyData) return null;
    analyser.getByteFrequencyData(frequencyData);
    return frequencyData;
}

/**
 * @returns {boolean} Whether audio capture is currently active
 */
export function isActive() {
    return active;
}

/**
 * @returns {number} The sample rate of the audio context, needed for bin→Hz mapping
 */
export function getSampleRate() {
    return audioContext ? audioContext.sampleRate : 44100;
}

/**
 * @returns {number} Number of frequency bins (fftSize / 2)
 */
export function getBinCount() {
    return analyser ? analyser.frequencyBinCount : FFT_SIZE / 2;
}
