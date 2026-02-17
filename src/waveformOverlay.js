/**
 * Waveform Overlay — multiple visualization styles drawn
 * directly onto the p5 canvas. Works with time-domain data from
 * either microphone or MIDI synth.
 *
 * Styles: oscilloscope, mirrored, circular, bars, radial
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseColor(hex) {
    hex = hex || '#00d4ff';
    return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16),
    };
}

function downsample(timeDomainData, count = 256) {
    const step = Math.max(1, Math.floor(timeDomainData.length / count));
    const samples = [];
    for (let i = 0; i < timeDomainData.length; i += step) {
        samples.push((timeDomainData[i] - 128) / 128); // -1 → 1
    }
    return samples;
}

/** Draw a 3-layer glow line from an array of {x,y} points */
function drawGlowLine(p, points, r, g, b, intensity, beat, energy) {
    if (points.length < 2) return;

    const glowAlpha = Math.round(40 * intensity * (0.5 + energy * 0.5));

    // Glow layer
    p.noFill();
    p.strokeWeight(6 + beat * 4);
    p.stroke(r, g, b, glowAlpha);
    p.beginShape();
    for (const pt of points) p.vertex(pt.x, pt.y);
    p.endShape();

    // Mid glow
    p.strokeWeight(3 + beat * 2);
    p.stroke(r, g, b, Math.round(80 * intensity));
    p.beginShape();
    for (const pt of points) p.vertex(pt.x, pt.y);
    p.endShape();

    // Core line
    p.strokeWeight(1.5);
    const cr = Math.min(255, r + 80);
    const cg = Math.min(255, g + 80);
    const cb = Math.min(255, b + 80);
    p.stroke(cr, cg, cb, Math.round(200 * intensity));
    p.beginShape();
    for (const pt of points) p.vertex(pt.x, pt.y);
    p.endShape();
}

// ── Styles ──────────────────────────────────────────────────────────────────

function drawOscilloscope(p, samples, w, h, r, g, b, intensity, energy, beat) {
    const ampScale = 0.3 + energy * 0.5 + beat * 0.2;
    const waveH = h * ampScale * intensity;
    const cy = h * 0.5;

    const points = samples.map((s, i) => ({
        x: (i / samples.length) * w,
        y: cy + s * waveH,
    }));

    drawGlowLine(p, points, r, g, b, intensity, beat, energy);
}

function drawMirrored(p, samples, w, h, r, g, b, intensity, energy, beat) {
    const ampScale = 0.25 + energy * 0.4 + beat * 0.15;
    const waveH = h * ampScale * intensity;
    const cy = h * 0.5;

    const top = samples.map((s, i) => ({
        x: (i / samples.length) * w,
        y: cy - Math.abs(s) * waveH,
    }));
    const bot = samples.map((s, i) => ({
        x: (i / samples.length) * w,
        y: cy + Math.abs(s) * waveH,
    }));

    drawGlowLine(p, top, r, g, b, intensity, beat, energy);
    drawGlowLine(p, bot, r, g, b, intensity * 0.7, beat, energy);
}

function drawCircular(p, samples, w, h, r, g, b, intensity, energy, beat) {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const baseRadius = Math.min(w, h) * 0.25;
    const ampScale = (0.3 + energy * 0.5 + beat * 0.2) * intensity;

    const points = [];
    for (let i = 0; i <= samples.length; i++) {
        const idx = i % samples.length;
        const angle = (i / samples.length) * Math.PI * 2 - Math.PI * 0.5;
        const radius = baseRadius + Math.abs(samples[idx]) * baseRadius * ampScale;
        points.push({
            x: cx + Math.cos(angle) * radius,
            y: cy + Math.sin(angle) * radius,
        });
    }

    // Close the loop: draw as a closed line
    const glowAlpha = Math.round(40 * intensity * (0.5 + energy * 0.5));

    p.noFill();
    p.strokeWeight(6 + beat * 4);
    p.stroke(r, g, b, glowAlpha);
    p.beginShape();
    for (const pt of points) p.vertex(pt.x, pt.y);
    p.endShape(p.CLOSE);

    p.strokeWeight(3 + beat * 2);
    p.stroke(r, g, b, Math.round(80 * intensity));
    p.beginShape();
    for (const pt of points) p.vertex(pt.x, pt.y);
    p.endShape(p.CLOSE);

    const cr = Math.min(255, r + 80);
    const cg = Math.min(255, g + 80);
    const cb = Math.min(255, b + 80);
    p.strokeWeight(1.5);
    p.stroke(cr, cg, cb, Math.round(200 * intensity));
    p.beginShape();
    for (const pt of points) p.vertex(pt.x, pt.y);
    p.endShape(p.CLOSE);
}

function drawBars(p, samples, w, h, r, g, b, intensity, energy, beat) {
    // Downsample further for bars
    const barCount = 64;
    const step = Math.max(1, Math.floor(samples.length / barCount));
    const bars = [];
    for (let i = 0; i < samples.length; i += step) {
        bars.push(Math.abs(samples[i]));
    }

    const barW = w / bars.length;
    const maxH = h * 0.4 * intensity * (0.5 + energy * 0.5 + beat * 0.2);
    const cy = h * 0.5;

    const cr = Math.min(255, r + 40);
    const cg = Math.min(255, g + 40);
    const cb = Math.min(255, b + 40);

    p.noStroke();
    for (let i = 0; i < bars.length; i++) {
        const barH = bars[i] * maxH;
        const x = i * barW;

        // Glow
        const glowA = Math.round(25 * intensity * (0.5 + energy));
        p.fill(r, g, b, glowA);
        p.rect(x, cy - barH - 2, barW - 1, barH * 2 + 4, 2);

        // Core
        const coreA = Math.round(180 * intensity);
        p.fill(cr, cg, cb, coreA);
        p.rect(x, cy - barH, barW - 1, barH * 2, 2);
    }
}

function drawRadial(p, samples, w, h, r, g, b, intensity, energy, beat) {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const innerR = Math.min(w, h) * 0.08;
    const maxLen = Math.min(w, h) * 0.35 * intensity * (0.4 + energy * 0.6 + beat * 0.3);

    // Use ~128 rays
    const rayCount = 128;
    const step = Math.max(1, Math.floor(samples.length / rayCount));

    const cr = Math.min(255, r + 80);
    const cg = Math.min(255, g + 80);
    const cb = Math.min(255, b + 80);

    for (let i = 0; i < samples.length; i += step) {
        const angle = (i / samples.length) * Math.PI * 2 - Math.PI * 0.5;
        const amp = Math.abs(samples[i]);
        const rayLen = innerR + amp * maxLen;

        const x1 = cx + Math.cos(angle) * innerR;
        const y1 = cy + Math.sin(angle) * innerR;
        const x2 = cx + Math.cos(angle) * rayLen;
        const y2 = cy + Math.sin(angle) * rayLen;

        // Glow
        p.strokeWeight(3 + beat * 2);
        p.stroke(r, g, b, Math.round(30 * intensity * amp));
        p.line(x1, y1, x2, y2);

        // Core
        p.strokeWeight(1.2);
        p.stroke(cr, cg, cb, Math.round(160 * intensity * amp));
        p.line(x1, y1, x2, y2);
    }
}

// ── Main Entry ──────────────────────────────────────────────────────────────

/**
 * Draw a waveform overlay in the selected style.
 *
 * @param {object} p - p5 instance
 * @param {Uint8Array} timeDomainData - raw time-domain samples
 * @param {object} audioFeatures - { bass, mid, treble, energy, beat }
 * @param {object} colorParams - { colorA, colorB, mode }
 * @param {number} intensity - 0→1
 * @param {string} style - 'oscilloscope'|'mirrored'|'circular'|'bars'|'radial'
 */
export function drawWaveform(p, timeDomainData, audioFeatures, colorParams, intensity = 0.7, style = 'oscilloscope') {
    if (!timeDomainData || timeDomainData.length === 0) return;

    const w = p.width;
    const h = p.height;
    const energy = audioFeatures ? audioFeatures.energy : 0.3;
    const beat = audioFeatures ? audioFeatures.beat : 0;

    const { r, g, b } = parseColor(colorParams.colorA);

    const sampleCount = style === 'bars' ? 128 : 256;
    const samples = downsample(timeDomainData, sampleCount);
    if (samples.length < 2) return;

    p.push();

    switch (style) {
        case 'mirrored':
            drawMirrored(p, samples, w, h, r, g, b, intensity, energy, beat);
            break;
        case 'circular':
            drawCircular(p, samples, w, h, r, g, b, intensity, energy, beat);
            break;
        case 'bars':
            drawBars(p, samples, w, h, r, g, b, intensity, energy, beat);
            break;
        case 'radial':
            drawRadial(p, samples, w, h, r, g, b, intensity, energy, beat);
            break;
        default:
            drawOscilloscope(p, samples, w, h, r, g, b, intensity, energy, beat);
            break;
    }

    p.pop();
}
