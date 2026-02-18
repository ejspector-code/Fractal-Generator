/**
 * Click Percussion — synthesized percussion sounds using Web Audio API.
 * Sound varies based on vertical click position:
 *   Top    → bright hi-hat / snap (high freq, short decay)
 *   Middle → rimshot / clap (mid freq, medium decay)
 *   Bottom → deep kick drum  (low freq, longer decay)
 *
 * The Y-position (0 = top, 1 = bottom) smoothly interpolates between these.
 * No audio files needed — everything is synthesized in real-time.
 */

let ctx = null;

function getCtx() {
    if (!ctx || ctx.state === 'closed') {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume suspended context (browser autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

/**
 * Play a synthesized percussion hit.
 * @param {number} yRatio - Vertical position 0 (top) to 1 (bottom)
 * @param {number} [xRatio=0.5] - Horizontal position 0 (left) to 1 (right), used for panning
 * @param {number} [volume=0.5] - Master volume 0–1
 */
export function playClickPerc(yRatio, xRatio = 0.5, volume = 0.5) {
    const ac = getCtx();
    const now = ac.currentTime;

    // Clamp
    const y = Math.max(0, Math.min(1, yRatio));
    const x = Math.max(0, Math.min(1, xRatio));

    // ── Stereo panning based on X position ──
    const panner = ac.createStereoPanner();
    panner.pan.value = (x - 0.5) * 1.6; // -0.8 to +0.8

    // ── Master gain ──
    const master = ac.createGain();
    master.gain.value = volume;
    master.connect(panner);
    panner.connect(ac.destination);

    if (y > 0.65) {
        // ── KICK DRUM (bottom) ──
        const intensity = (y - 0.65) / 0.35; // 0→1 within bottom zone
        synthKick(ac, now, master, intensity);
    } else if (y > 0.35) {
        // ── RIMSHOT / CLAP (middle) ──
        const intensity = 1 - Math.abs((y - 0.5) / 0.15); // peaks at center
        synthRim(ac, now, master, Math.max(0.3, intensity));
    } else {
        // ── HI-HAT / SNAP (top) ──
        const intensity = 1 - (y / 0.35); // 0→1 from middle to top
        synthHat(ac, now, master, intensity);
    }
}

// ─── Kick Drum Synth ──────────────────────────────────────────────────────────
function synthKick(ac, t, dest, intensity) {
    // Oscillator: pitch sweep from high to low
    const osc = ac.createOscillator();
    osc.type = 'sine';
    const startFreq = 150 + intensity * 100; // 150–250 Hz start
    const endFreq = 30 + intensity * 20;     // 30–50 Hz end
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + 0.08);

    // Sub layer for extra weight
    const sub = ac.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(startFreq * 0.5, t);
    sub.frequency.exponentialRampToValueAtTime(endFreq * 0.7, t + 0.1);

    // Gain envelope
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3 + intensity * 0.15);

    const subGain = ac.createGain();
    subGain.gain.setValueAtTime(0.5, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35 + intensity * 0.1);

    // Transient click
    const click = ac.createOscillator();
    click.type = 'square';
    click.frequency.setValueAtTime(800, t);
    click.frequency.exponentialRampToValueAtTime(100, t + 0.02);
    const clickGain = ac.createGain();
    clickGain.gain.setValueAtTime(0.6, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

    // Light distortion via waveshaper
    const shaper = ac.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
        const x = (i / 128) - 1;
        curve[i] = Math.tanh(x * (1.5 + intensity));
    }
    shaper.curve = curve;

    osc.connect(gain);
    sub.connect(subGain);
    click.connect(clickGain);
    gain.connect(shaper);
    subGain.connect(shaper);
    clickGain.connect(shaper);
    shaper.connect(dest);

    osc.start(t);
    sub.start(t);
    click.start(t);
    osc.stop(t + 0.5);
    sub.stop(t + 0.5);
    click.stop(t + 0.04);
}

// ─── Rimshot / Clap Synth ─────────────────────────────────────────────────────
function synthRim(ac, t, dest, intensity) {
    // Two detuned tones for metallic quality
    const osc1 = ac.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(820 + intensity * 200, t);

    const osc2 = ac.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(1540 + intensity * 300, t);

    // Noise burst for "clap" texture
    const noiseLen = 0.06;
    const noiseBuf = ac.createBuffer(1, ac.sampleRate * noiseLen, ac.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) {
        noiseData[i] = (Math.random() * 2 - 1) * 0.8;
    }
    const noise = ac.createBufferSource();
    noise.buffer = noiseBuf;

    // Bandpass the noise
    const bpf = ac.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = 3500;
    bpf.Q.value = 2;

    // Gains
    const oscGain = ac.createGain();
    oscGain.gain.setValueAtTime(0.5 * intensity, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    const noiseGain = ac.createGain();
    noiseGain.gain.setValueAtTime(0.7, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc1.connect(oscGain);
    osc2.connect(oscGain);
    noise.connect(bpf);
    bpf.connect(noiseGain);
    oscGain.connect(dest);
    noiseGain.connect(dest);

    osc1.start(t);
    osc2.start(t);
    noise.start(t);
    osc1.stop(t + 0.08);
    osc2.stop(t + 0.08);
    noise.stop(t + noiseLen);
}

// ─── Hi-Hat / Snap Synth ──────────────────────────────────────────────────────
function synthHat(ac, t, dest, intensity) {
    // Multiple detuned square oscillators for metallic shimmer
    const freqs = [2633, 3417, 4519, 5729, 6841, 7928];
    const oscs = [];
    const oscGain = ac.createGain();
    const openness = intensity; // higher = more open hat
    oscGain.gain.setValueAtTime(0.25, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.03 + openness * 0.12);

    // Highpass to keep it crispy
    const hpf = ac.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 7000 - intensity * 2000; // 5000–7000 Hz

    for (const f of freqs) {
        const osc = ac.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(f * (1 + intensity * 0.05), t);
        osc.connect(oscGain);
        osc.start(t);
        osc.stop(t + 0.15 + openness * 0.15);
        oscs.push(osc);
    }

    // Noise layer
    const noiseLen = 0.08 + openness * 0.1;
    const noiseBuf = ac.createBuffer(1, ac.sampleRate * noiseLen, ac.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) {
        noiseData[i] = Math.random() * 2 - 1;
    }
    const noise = ac.createBufferSource();
    noise.buffer = noiseBuf;

    const noiseGain = ac.createGain();
    noiseGain.gain.setValueAtTime(0.5, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.025 + openness * 0.08);

    noise.connect(noiseGain);
    noiseGain.connect(hpf);
    oscGain.connect(hpf);
    hpf.connect(dest);

    noise.start(t);
    noise.stop(t + noiseLen);
}
