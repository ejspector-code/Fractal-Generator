/**
 * Renderer — converts attractor data into visual output on p5 canvas.
 * Supports Classic (density), Particles, and Vapor render modes.
 * Works with de Jong, Clifford, Lorenz, Aizawa, Buddhabrot, Burning Ship, and Curl Noise.
 */
import { computeDensityHistogram, stepPoint, toScreen, getInitialPosition, buddhabrotOrbit, burningShipOrbit, mandelbrotOrbit } from './attractor.js';
import { applyMouseForce } from './mouseInteraction.js';

// ─── Color Utilities ──────────────────────────────────────────────────────────

function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
}

function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function lerpColor(c1, c2, t) {
    return {
        r: Math.round(c1.r + (c2.r - c1.r) * t),
        g: Math.round(c1.g + (c2.g - c1.g) * t),
        b: Math.round(c1.b + (c2.b - c1.b) * t),
    };
}

/** Convert RGB (0-255) to HSL (h: 0-360, s: 0-100, l: 0-100) */
function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
}

/** Shift hue of an RGB color by `degrees`, return new RGB */
function hueShiftColor(rgb, degrees) {
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const shifted = (hsl.h + degrees + 360) % 360;
    return hslToRgb(shifted, hsl.s, hsl.l);
}

/**
 * Multi-stop gradient: interpolate between an array of color stops.
 * t should be 0-1. Returns {r, g, b}.
 */
function multiStopGradient(stops, t) {
    t = Math.max(0, Math.min(1, t));
    if (stops.length === 1) return stops[0];
    const segment = t * (stops.length - 1);
    const idx = Math.min(Math.floor(segment), stops.length - 2);
    const local = segment - idx;
    return lerpColor(stops[idx], stops[idx + 1], local);
}

/**
 * Build a 5-stop vivid gradient from colorA and colorB.
 * Produces: hueShift(A, -30) → A → bright midpoint → B → hueShift(B, +30)
 */
function buildVividStops(colorA, colorB) {
    const midR = Math.min(255, Math.round((colorA.r + colorB.r) * 0.5 + 80));
    const midG = Math.min(255, Math.round((colorA.g + colorB.g) * 0.5 + 80));
    const midB = Math.min(255, Math.round((colorA.b + colorB.b) * 0.5 + 80));
    return [
        hueShiftColor(colorA, -30),
        colorA,
        { r: midR, g: midG, b: midB },
        colorB,
        hueShiftColor(colorB, 30),
    ];
}

// ─── Tone Mapping ─────────────────────────────────────────────────────────────

function toneMap(value, maxValue, mode) {
    if (maxValue === 0) return 0;
    const normalized = value / maxValue;
    switch (mode) {
        case 'linear': return normalized;
        case 'sqrt': return Math.sqrt(normalized);
        case 'log': return Math.log(1 + normalized * 9) / Math.log(10);
        default: return Math.sqrt(normalized);
    }
}

// ─── Helper: is this type orbit-based (Buddhabrot-style)? ─────────────────────

function isOrbitType(type) {
    return type === 'buddhabrot' || type === 'burningship' || type === 'mandelbrot';
}

/** Get the correct params for the current attractor type */
function getParams(state) {
    switch (state.attractorType) {
        case 'lorenz': return state.lorenzCoeffs;
        case 'aizawa': return state.aizawaCoeffs;
        case 'clifford': return state.cliffordCoeffs;
        case 'curlnoise': return state.curlNoiseParams;
        case 'buddhabrot': return state.buddhabrotParams;
        case 'burningship': return state.burningShipParams;
        case 'mandelbrot': return state.mandelbrotParams;
        default: return state.coeffs;
    }
}

/** Get orbit for orbit-based types */
function getOrbit(state, w, h) {
    if (state.attractorType === 'burningship') {
        return burningShipOrbit(state.burningShipParams, w, h);
    }
    if (state.attractorType === 'mandelbrot') {
        return mandelbrotOrbit(state.mandelbrotParams, w, h);
    }
    return buddhabrotOrbit(state.buddhabrotParams, w, h);
}

/** Get orbit params for orbit-based types */
function getOrbitParams(state) {
    if (state.attractorType === 'burningship') return state.burningShipParams;
    if (state.attractorType === 'mandelbrot') return state.mandelbrotParams;
    return state.buddhabrotParams;
}

// ─── Classic Renderer ─────────────────────────────────────────────────────────

// Mandelbrot Web Worker state
let _mbWorker = null;
let _mbCachedHistogram = null;
let _mbLastParamHash = '';
let _mbWorkerBusy = false;
let _mbPendingMsg = null; // queued message if worker is busy

/** Create a hash string from Mandelbrot params + dimensions to detect changes */
function _mbParamHash(params, w, h) {
    return `${params.maxIter}|${params.centerX}|${params.centerY}|${params.zoom}|${params.julia}|${params.juliaR}|${params.juliaI}|${w}|${h}`;
}

/** Lazily create the Mandelbrot worker */
function _getMbWorker() {
    if (!_mbWorker) {
        _mbWorker = new Worker(new URL('./mandelbrotWorker.js', import.meta.url), { type: 'module' });
        _mbWorker.onmessage = (e) => {
            _mbCachedHistogram = e.data.buffer;
            _mbWorkerBusy = false;
            // If params changed while we were computing, re-dispatch immediately
            if (_mbPendingMsg) {
                const msg = _mbPendingMsg;
                _mbPendingMsg = null;
                _mbWorkerBusy = true;
                _mbWorker.postMessage(msg);
            }
        };
    }
    return _mbWorker;
}

/** Dispatch Mandelbrot computation to worker */
function _mbDispatch(params, w, h) {
    const msg = { params: { ...params }, width: w, height: h };
    if (_mbWorkerBusy) {
        // Queue latest — worker will pick it up when done
        _mbPendingMsg = msg;
    } else {
        _mbWorkerBusy = true;
        _mbPendingMsg = null;
        _getMbWorker().postMessage(msg);
    }
}

export function renderClassic(p, state) {
    const { attractorType, classicParams, colorParams, bgColor, diffusion } = state;
    const w = p.width;
    const h = p.height;

    let histogram;

    if (attractorType === 'mandelbrot') {
        // ── Async worker path for Mandelbrot/Julia ───────────────────────────
        const params = getParams(state);
        const hash = _mbParamHash(params, w, h);

        if (hash !== _mbLastParamHash) {
            _mbLastParamHash = hash;
            _mbDispatch(params, w, h);
        }

        if (_mbCachedHistogram && _mbCachedHistogram.length === w * h) {
            histogram = _mbCachedHistogram;
        } else {
            // No cache yet — render background color and wait
            const bg = hexToRgb(bgColor);
            p.background(bg.r, bg.g, bg.b);
            return;
        }
    } else {
        // ── Synchronous path for all other attractors ────────────────────────
        const params = getParams(state);
        const iterations = Math.round(Math.pow(10, classicParams.iterationsPow));
        histogram = computeDensityHistogram(attractorType, params, w, h, iterations);
    }

    // Find max density
    let maxDensity = 0;
    for (let i = 0; i < histogram.length; i++) {
        if (histogram[i] > maxDensity) maxDensity = histogram[i];
    }

    const bg = hexToRgb(bgColor);
    const colorA = hexToRgb(colorParams.colorA);
    const colorB = hexToRgb(colorParams.colorB);
    const img = p.createImage(w, h);
    img.loadPixels();

    for (let i = 0; i < histogram.length; i++) {
        const density = histogram[i];
        const t = toneMap(density, maxDensity, classicParams.densityMode);
        let r, g, b;

        if (density === 0) {
            r = bg.r; g = bg.g; b = bg.b;
        } else {
            switch (colorParams.mode) {
                case 'single': {
                    r = Math.round(bg.r + (colorA.r - bg.r) * t);
                    g = Math.round(bg.g + (colorA.g - bg.g) * t);
                    b = Math.round(bg.b + (colorA.b - bg.b) * t);
                    break;
                }
                case 'dual': {
                    const c = lerpColor(colorA, colorB, t);
                    r = Math.round(bg.r + (c.r - bg.r) * t);
                    g = Math.round(bg.g + (c.g - bg.g) * t);
                    b = Math.round(bg.b + (c.b - bg.b) * t);
                    break;
                }
                case 'spectral': {
                    const hue = (t * 300 + 200) % 360;
                    const c = hslToRgb(hue, 90, 20 + t * 60);
                    r = c.r; g = c.g; b = c.b;
                    break;
                }
                case 'vivid': {
                    const stops = buildVividStops(colorA, colorB);
                    const c = multiStopGradient(stops, t);
                    r = Math.round(bg.r + (c.r - bg.r) * t);
                    g = Math.round(bg.g + (c.g - bg.g) * t);
                    b = Math.round(bg.b + (c.b - bg.b) * t);
                    break;
                }
                default: {
                    r = Math.round(t * 255);
                    g = r; b = r;
                }
            }
        }

        const idx = i * 4;
        img.pixels[idx] = r;
        img.pixels[idx + 1] = g;
        img.pixels[idx + 2] = b;
        img.pixels[idx + 3] = 255;
    }

    img.updatePixels();
    p.image(img, 0, 0);

    if (diffusion.enabled) {
        p.filter(p.BLUR, diffusion.strength);
    }
}

// ─── Particle Renderer ────────────────────────────────────────────────────────

let particles = [];
let orbitParticles = []; // For orbit-based types (Buddhabrot, Burning Ship)

function initParticles(p, state) {
    const count = state.particleParams.count;
    particles = [];

    if (isOrbitType(state.attractorType)) {
        initOrbitParticles(state, count);
        return;
    }

    for (let i = 0; i < count; i++) {
        const pos = getInitialPosition(state.attractorType);
        particles.push({
            x: pos.x, y: pos.y, z: pos.z,
            px: 0, py: 0,
        });
    }
}

function initOrbitParticles(state, count) {
    orbitParticles = [];
    const w = 800, h = 800;
    for (let i = 0; i < Math.min(count, 200); i++) {
        const orbit = getOrbit(state, w, h);
        if (orbit.length > 0) {
            orbitParticles.push({
                points: orbit,
                idx: Math.floor(Math.random() * orbit.length),
                speed: 0.5 + Math.random() * 2,
            });
        }
    }
}

export function renderParticles(p, state, frameCount) {
    if (isOrbitType(state.attractorType)) {
        renderOrbitParticles(p, state, frameCount);
        return;
    }

    const { attractorType, particleParams, colorParams, bgColor } = state;
    const params = getParams(state);

    if (particles.length !== particleParams.count || frameCount <= 1) {
        initParticles(p, state);
    }

    // Fade trail — audio-reactive: bass + energy create motion blur trails
    const bg = hexToRgb(bgColor);
    const af_trail = state.audioFeatures;
    let trailFade = (1 - particleParams.trail) * 255;
    if (af_trail) {
        // Bass reduces fade (more trail), energy amplifies the effect
        trailFade *= Math.max(0.15, 1 - af_trail.bass * 0.6 - af_trail.energy * 0.3);
    }
    p.fill(bg.r, bg.g, bg.b, Math.round(trailFade));
    p.noStroke();
    p.rect(0, 0, p.width, p.height);

    const colorA = hexToRgb(colorParams.colorA);
    const colorB = hexToRgb(colorParams.colorB);

    // Additive blending for vivid strand overlap
    if (colorParams.blendMode === 'add') {
        p.blendMode(p.ADD);
    }

    p.noStroke();

    const time = frameCount * 0.01;

    for (let i = 0; i < particles.length; i++) {
        const pt = particles[i];
        const next = stepPoint(attractorType, params, pt.x, pt.y, pt.z, time);
        pt.x = next.x;
        pt.y = next.y;
        pt.z = next.z;

        const screen = toScreen(attractorType, pt.x, pt.y, pt.z, p.width, p.height);
        let sx = screen.sx;
        let sy = screen.sy;

        // Mouse interaction
        if (state.mouse.enabled && state.mouse.overCanvas) {
            const mf = applyMouseForce(sx, sy, state.mouse.screenX, state.mouse.screenY, state.mouse.strength, state.mouse.mode, p.width);
            sx += mf.dx;
            sy += mf.dy;
        }

        const dx = sx - pt.px;
        const dy = sy - pt.py;
        const vel = Math.sqrt(dx * dx + dy * dy);
        pt.px = sx;
        pt.py = sy;

        const t = (i / particles.length);
        let cr, cg, cb;
        switch (colorParams.mode) {
            case 'spectral': {
                const hue = (t * 300 + frameCount * 0.5) % 360;
                const c = hslToRgb(hue, 85, 60);
                cr = c.r; cg = c.g; cb = c.b;
                break;
            }
            case 'dual': {
                const c = lerpColor(colorA, colorB, t);
                cr = c.r; cg = c.g; cb = c.b;
                break;
            }
            case 'vivid': {
                const stops = buildVividStops(colorA, colorB);
                const c = multiStopGradient(stops, (t + frameCount * 0.001) % 1.0);
                cr = c.r; cg = c.g; cb = c.b;
                break;
            }
            default: {
                cr = colorA.r; cg = colorA.g; cb = colorA.b;
            }
        }

        // ── Vivid audio-reactive effects ─────────────────────────────────────
        const af = state.audioFeatures;
        const td = state.timeDomainData;
        let audioSizeMul = 1;
        let audioGlowMul = 1;
        let dispX = 0, dispY = 0;
        let hueShift = 0;

        if (af) {
            // Explosive size pulse: bass drives size, beat adds burst
            audioSizeMul = 1 + af.bass * 1.5 + af.beat * 1.2 + af.energy * 0.5;
            // Dramatic glow: energy and treble amplify glow massively
            audioGlowMul = 1 + af.energy * 3.0 + af.treble * 1.5;

            // Spectral hue shift: bass rotates hue, treble spins faster
            hueShift = af.bass * 40 + af.treble * 25 + af.beat * 30 + (state.audioColorShift || 0);

            // Waveform displacement: use time-domain data to displace particles
            if (td && td.length > 0) {
                const sampleIdx = Math.floor(t * td.length) % td.length;
                const sample = (td[sampleIdx] - 128) / 128; // -1 to 1
                const displaceMag = af.energy * 60 + af.beat * 40;
                // Displace perpendicular to particle motion
                const angle = Math.atan2(dy, dx) + Math.PI * 0.5;
                dispX = Math.cos(angle) * sample * displaceMag;
                dispY = Math.sin(angle) * sample * displaceMag;
            }
        }

        sx += dispX;
        sy += dispY;

        // Apply hue shift to color
        if (hueShift !== 0) {
            const shifted = hslToRgb(
                (Math.atan2(cg - 128, cr - 128) * 180 / Math.PI + hueShift + 360) % 360,
                80 + (af ? af.energy * 20 : 0),
                50 + (af ? af.energy * 15 : 0)
            );
            cr = shifted.r; cg = shifted.g; cb = shifted.b;
        }

        const size = particleParams.size * (0.5 + Math.min(vel * 0.02, 2)) * audioSizeMul;

        if (particleParams.glow > 0) {
            const glowSize = size * (2 + particleParams.glow) * audioGlowMul;
            const glowAlpha = Math.round(15 * particleParams.glow * audioGlowMul);
            p.fill(cr, cg, cb, Math.min(255, glowAlpha));
            p.ellipse(sx, sy, glowSize, glowSize);
        }

        const coreAlpha = af ? Math.min(255, Math.round(200 + af.beat * 55 + af.energy * 30)) : 200;
        p.fill(cr, cg, cb, coreAlpha);
        p.ellipse(sx, sy, size, size);

        // Beat burst: extra bright ring on strong beats
        if (af && af.beat > 0.5) {
            const burstSize = size * (3 + af.beat * 4);
            p.fill(255, 255, 255, Math.round(af.beat * 40));
            p.ellipse(sx, sy, burstSize, burstSize);
        }
    }

    // Reset blend mode
    if (colorParams.blendMode === 'add') {
        p.blendMode(p.BLEND);
    }
}

function renderOrbitParticles(p, state, frameCount) {
    const { particleParams, colorParams, bgColor } = state;

    if (orbitParticles.length === 0 || frameCount <= 1) {
        initOrbitParticles(state, particleParams.count);
    }

    // Fade trail
    const bg = hexToRgb(bgColor);
    p.fill(bg.r, bg.g, bg.b, Math.round((1 - particleParams.trail) * 255));
    p.noStroke();
    p.rect(0, 0, p.width, p.height);

    const colorA = hexToRgb(colorParams.colorA);
    const colorB = hexToRgb(colorParams.colorB);

    // Scale from 800×800 reference to actual canvas
    const scaleX = p.width / 800;
    const scaleY = p.height / 800;

    p.noStroke();

    for (let i = 0; i < orbitParticles.length; i++) {
        const orb = orbitParticles[i];
        orb.idx += orb.speed;

        // When orbit ends, restart with a new orbit
        if (orb.idx >= orb.points.length) {
            const newOrbit = getOrbit(state, 800, 800);
            if (newOrbit.length > 0) {
                orb.points = newOrbit;
                orb.idx = 0;
            } else {
                orb.idx = 0;
            }
        }

        const ptIdx = Math.floor(orb.idx) % orb.points.length;
        const pt = orb.points[ptIdx];
        let sx = pt.x * scaleX;
        let sy = pt.y * scaleY;

        // Mouse interaction
        if (state.mouse.enabled && state.mouse.overCanvas) {
            const mf = applyMouseForce(sx, sy, state.mouse.screenX, state.mouse.screenY, state.mouse.strength, state.mouse.mode, p.width);
            sx += mf.dx;
            sy += mf.dy;
        }

        const t = i / orbitParticles.length;
        let cr, cg, cb;
        switch (colorParams.mode) {
            case 'spectral': {
                const hue = (t * 300 + frameCount * 0.3) % 360;
                const c = hslToRgb(hue, 85, 60);
                cr = c.r; cg = c.g; cb = c.b;
                break;
            }
            case 'dual': {
                const c = lerpColor(colorA, colorB, t);
                cr = c.r; cg = c.g; cb = c.b;
                break;
            }
            case 'vivid': {
                const stops = buildVividStops(colorA, colorB);
                const c = multiStopGradient(stops, (t + frameCount * 0.001) % 1.0);
                cr = c.r; cg = c.g; cb = c.b;
                break;
            }
            default: {
                cr = colorA.r; cg = colorA.g; cb = colorA.b;
            }
        }

        const size = particleParams.size;

        if (particleParams.glow > 0) {
            const glowSize = size * (2 + particleParams.glow);
            p.fill(cr, cg, cb, Math.round(15 * particleParams.glow));
            p.ellipse(sx, sy, glowSize, glowSize);
        }

        p.fill(cr, cg, cb, 180);
        p.ellipse(sx, sy, size, size);
    }
}

// ─── Vapor Renderer ───────────────────────────────────────────────────────────

let vaporParticles = [];
let orbitVapor = []; // For orbit-based types

function initVapor(p, state) {
    const count = state.vaporParams.count;
    vaporParticles = [];

    if (isOrbitType(state.attractorType)) {
        initOrbitVapor(state, count);
        return;
    }

    for (let i = 0; i < count; i++) {
        const pos = getInitialPosition(state.attractorType);
        vaporParticles.push({
            x: pos.x, y: pos.y, z: pos.z,
            age: Math.random() * 200,
        });
    }
}

function initOrbitVapor(state, count) {
    orbitVapor = [];
    for (let i = 0; i < Math.min(count, 300); i++) {
        const orbit = getOrbit(state, 800, 800);
        if (orbit.length > 0) {
            orbitVapor.push({
                points: orbit,
                idx: Math.floor(Math.random() * orbit.length),
                speed: 0.3 + Math.random(),
                age: Math.random() * 200,
            });
        }
    }
}

export function renderVapor(p, state, frameCount) {
    if (isOrbitType(state.attractorType)) {
        renderOrbitVapor(p, state, frameCount);
        return;
    }

    const { attractorType, vaporParams, colorParams, bgColor } = state;
    const params = getParams(state);

    if (vaporParticles.length !== vaporParams.count || frameCount <= 1) {
        initVapor(p, state);
    }

    // Fade — audio-reactive: bass + energy create smoky trails
    const bg = hexToRgb(bgColor);
    const af_trail = state.audioFeatures;
    let dissipFade = (1 - vaporParams.dissipation) * 255;
    if (af_trail) {
        dissipFade *= Math.max(0.1, 1 - af_trail.bass * 0.5 - af_trail.energy * 0.4);
    }
    p.fill(bg.r, bg.g, bg.b, Math.round(dissipFade));
    p.noStroke();
    p.rect(0, 0, p.width, p.height);

    const colorA = hexToRgb(colorParams.colorA);
    const colorB = hexToRgb(colorParams.colorB);

    // Additive blending for vivid strand overlap
    if (colorParams.blendMode === 'add') {
        p.blendMode(p.ADD);
    }

    p.noStroke();
    const time = frameCount * 0.01;

    for (let i = 0; i < vaporParticles.length; i++) {
        const vp = vaporParticles[i];
        const next = stepPoint(attractorType, params, vp.x, vp.y, vp.z, time);
        vp.x = next.x;
        vp.y = next.y;
        vp.z = next.z;
        vp.age++;

        const screen = toScreen(attractorType, vp.x, vp.y, vp.z, p.width, p.height);

        // ── Vivid audio-reactive vapor modulation ────────────────────────────
        const af = state.audioFeatures;
        const td = state.timeDomainData;
        let audioTurbMul = 1;
        let audioPuffMul = 1;
        let dispX = 0, dispY = 0;
        let hueShift = 0;

        if (af) {
            // Massive turbulence: treble and energy drive chaotic motion
            audioTurbMul = 1 + af.treble * 4.0 + af.energy * 2.0 + af.beat * 1.5;
            // Dramatic puff scaling: energy + beat create explosive growth
            audioPuffMul = 1 + af.energy * 1.5 + af.beat * 2.0 + af.bass * 0.8;
            // Spectral hue cycling
            hueShift = af.bass * 35 + af.treble * 20 + af.beat * 25;

            // Waveform displacement for vapor
            if (td && td.length > 0) {
                const sampleIdx = Math.floor((i / vaporParticles.length) * td.length) % td.length;
                const sample = (td[sampleIdx] - 128) / 128;
                const displaceMag = af.energy * 50 + af.beat * 35;
                dispX = sample * displaceMag * Math.cos(vp.age * 0.03 + i);
                dispY = sample * displaceMag * Math.sin(vp.age * 0.03 + i);
            }
        }

        const turbX = (p.noise(vp.x * 2 + time, vp.y * 2, i * 0.01) - 0.5) * vaporParams.turbulence * 30 * audioTurbMul;
        const turbY = (p.noise(vp.x * 2, vp.y * 2 + time, i * 0.01 + 100) - 0.5) * vaporParams.turbulence * 30 * audioTurbMul;

        let sx = screen.sx + turbX + dispX;
        let sy = screen.sy + turbY + dispY;

        // Mouse interaction
        if (state.mouse.enabled && state.mouse.overCanvas) {
            const mf = applyMouseForce(sx, sy, state.mouse.screenX, state.mouse.screenY, state.mouse.strength, state.mouse.mode, p.width);
            sx += mf.dx;
            sy += mf.dy;
        }

        const t = (i / vaporParticles.length);
        let cr, cg, cb;
        switch (colorParams.mode) {
            case 'spectral': {
                const hue = (t * 280 + frameCount * 0.3 + hueShift) % 360;
                const sat = 70 + (af ? af.energy * 30 : 0);
                const lit = 55 + (af ? af.energy * 15 : 0);
                const c = hslToRgb(hue, Math.min(100, sat), Math.min(80, lit));
                cr = c.r; cg = c.g; cb = c.b;
                break;
            }
            case 'dual': {
                const c = lerpColor(colorA, colorB, t);
                cr = c.r; cg = c.g; cb = c.b;
                break;
            }
            case 'vivid': {
                const stops = buildVividStops(colorA, colorB);
                const shiftT = (t + frameCount * 0.001 + (af ? af.energy * 0.1 : 0)) % 1.0;
                const c = multiStopGradient(stops, shiftT);
                cr = c.r; cg = c.g; cb = c.b;
                break;
            }
            default: {
                cr = colorA.r; cg = colorA.g; cb = colorA.b;
            }
        }

        // Apply hue shift for non-spectral modes
        if (hueShift !== 0 && colorParams.mode !== 'spectral') {
            const shifted = hslToRgb(
                (Math.atan2(cg - 128, cr - 128) * 180 / Math.PI + hueShift + 360) % 360,
                80 + (af ? af.energy * 20 : 0),
                50 + (af ? af.energy * 15 : 0)
            );
            cr = shifted.r; cg = shifted.g; cb = shifted.b;
        }

        const alpha = Math.max(5, Math.round((20 - vp.age * 0.02) * (af ? 1 + af.energy * 0.8 : 1)));
        const puffSize = (6 + Math.sin(vp.age * 0.05 + i) * 3) * audioPuffMul;

        p.fill(cr, cg, cb, alpha);
        p.ellipse(sx, sy, puffSize, puffSize);

        p.fill(cr, cg, cb, Math.round(alpha * 0.3));
        p.ellipse(sx, sy, puffSize * 3, puffSize * 3);

        // Beat burst halo for vapor
        if (af && af.beat > 0.5) {
            p.fill(cr, cg, cb, Math.round(af.beat * 25));
            p.ellipse(sx, sy, puffSize * 5, puffSize * 5);
        }
    }

    // Reset blend mode
    if (colorParams.blendMode === 'add') {
        p.blendMode(p.BLEND);
    }

    if (vaporParams.blurPasses > 0) {
        p.filter(p.BLUR, vaporParams.blurPasses);
    }
}

function renderOrbitVapor(p, state, frameCount) {
    const { vaporParams, colorParams, bgColor } = state;

    if (orbitVapor.length === 0 || frameCount <= 1) {
        initOrbitVapor(state, vaporParams.count);
    }

    const bg = hexToRgb(bgColor);
    p.fill(bg.r, bg.g, bg.b, Math.round((1 - vaporParams.dissipation) * 255));
    p.noStroke();
    p.rect(0, 0, p.width, p.height);

    const colorA = hexToRgb(colorParams.colorA);
    const colorB = hexToRgb(colorParams.colorB);
    const scaleX = p.width / 800;
    const scaleY = p.height / 800;
    const time = frameCount * 0.01;

    p.noStroke();

    for (let i = 0; i < orbitVapor.length; i++) {
        const orb = orbitVapor[i];
        orb.idx += orb.speed;
        orb.age++;

        if (orb.idx >= orb.points.length) {
            const newOrbit = getOrbit(state, 800, 800);
            if (newOrbit.length > 0) {
                orb.points = newOrbit;
                orb.idx = 0;
                orb.age = 0;
            } else {
                orb.idx = 0;
            }
        }

        const ptIdx = Math.floor(orb.idx) % orb.points.length;
        const pt = orb.points[ptIdx];
        const baseX = pt.x * scaleX;
        const baseY = pt.y * scaleY;

        // Turbulence
        const turbX = (p.noise(baseX * 0.01 + time, baseY * 0.01, i * 0.01) - 0.5) * vaporParams.turbulence * 40;
        const turbY = (p.noise(baseX * 0.01, baseY * 0.01 + time, i * 0.01 + 100) - 0.5) * vaporParams.turbulence * 40;

        const sx_base = baseX + turbX;
        const sy_base = baseY + turbY;

        let sx = sx_base;
        let sy = sy_base;

        // Mouse interaction
        if (state.mouse.enabled && state.mouse.overCanvas) {
            const mf = applyMouseForce(sx, sy, state.mouse.screenX, state.mouse.screenY, state.mouse.strength, state.mouse.mode, p.width);
            sx += mf.dx;
            sy += mf.dy;
        }

        const t = i / orbitVapor.length;
        let cr, cg, cb;
        switch (colorParams.mode) {
            case 'spectral': {
                const hue = (t * 280 + frameCount * 0.3) % 360;
                const c = hslToRgb(hue, 70, 55);
                cr = c.r; cg = c.g; cb = c.b;
                break;
            }
            case 'dual': {
                const c = lerpColor(colorA, colorB, t);
                cr = c.r; cg = c.g; cb = c.b;
                break;
            }
            case 'vivid': {
                const stops = buildVividStops(colorA, colorB);
                const c = multiStopGradient(stops, (t + frameCount * 0.001) % 1.0);
                cr = c.r; cg = c.g; cb = c.b;
                break;
            }
            default: {
                cr = colorA.r; cg = colorA.g; cb = colorA.b;
            }
        }

        const alpha = Math.max(5, 18 - orb.age * 0.01);
        const puffSize = 5 + Math.sin(orb.age * 0.04 + i) * 2;

        p.fill(cr, cg, cb, alpha);
        p.ellipse(sx, sy, puffSize, puffSize);

        p.fill(cr, cg, cb, alpha * 0.25);
        p.ellipse(sx, sy, puffSize * 3, puffSize * 3);
    }

    if (vaporParams.blurPasses > 0) {
        p.filter(p.BLUR, vaporParams.blurPasses);
    }
}

/**
 * Reset all particle arrays
 */
export function resetParticles() {
    particles = [];
    vaporParticles = [];
    orbitParticles = [];
    orbitVapor = [];
}

// ─── Click Burst Effect ───────────────────────────────────────────────────────

let clickBursts = [];

/**
 * Create a new click burst at (x, y) screen coordinates.
 */
export function initClickBurst(x, y, canvasWidth, colorParams) {
    const colorA = hexToRgb(colorParams.colorA);
    const colorB = hexToRgb(colorParams.colorB);

    // Spawn a burst with expanding rings + sparks
    const sparkCount = 24 + Math.floor(Math.random() * 16);
    const sparks = [];
    for (let i = 0; i < sparkCount; i++) {
        const angle = (i / sparkCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
        const speed = 1.5 + Math.random() * 4;
        const life = 30 + Math.random() * 40;
        const t = Math.random();
        let cr, cg, cb;
        if (colorParams.mode === 'spectral') {
            const hue = (t * 300 + Math.random() * 60) % 360;
            const c = hslToRgb(hue, 90, 65);
            cr = c.r; cg = c.g; cb = c.b;
        } else if (colorParams.mode === 'dual') {
            const c = lerpColor(colorA, colorB, t);
            cr = c.r; cg = c.g; cb = c.b;
        } else {
            cr = colorA.r; cg = colorA.g; cb = colorA.b;
        }
        sparks.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life,
            maxLife: life,
            size: 1.5 + Math.random() * 2.5,
            cr, cg, cb,
        });
    }

    clickBursts.push({
        x, y,
        age: 0,
        maxAge: 60,
        sparks,
        // Ring colors
        ringColor: colorParams.mode === 'spectral'
            ? hslToRgb(Math.random() * 360, 90, 70)
            : colorA,
        ringColor2: colorParams.mode === 'spectral'
            ? hslToRgb((Math.random() * 360 + 120) % 360, 80, 60)
            : colorB,
        canvasWidth,
    });
}

/**
 * Render all active click bursts. Call each frame after the main render.
 */
export function renderClickBursts(p) {
    if (clickBursts.length === 0) return;

    const toRemove = [];

    for (let b = 0; b < clickBursts.length; b++) {
        const burst = clickBursts[b];
        burst.age++;
        const progress = burst.age / burst.maxAge;

        if (progress >= 1) {
            toRemove.push(b);
            continue;
        }

        // ── Shockwave rings ──────────────────────────────────────────────
        const ringRadius1 = progress * burst.canvasWidth * 0.35;
        const ringRadius2 = progress * burst.canvasWidth * 0.22;
        const ringAlpha = Math.max(0, 1 - progress * 1.3);

        p.noFill();
        p.strokeWeight(Math.max(0.5, 3 * (1 - progress)));

        // Outer ring
        const rc = burst.ringColor;
        p.stroke(rc.r, rc.g, rc.b, Math.round(ringAlpha * 120));
        p.ellipse(burst.x, burst.y, ringRadius1 * 2, ringRadius1 * 2);

        // Inner ring (slightly delayed)
        if (progress > 0.05) {
            const rc2 = burst.ringColor2;
            const innerAlpha = Math.max(0, 1 - (progress - 0.05) * 1.5);
            p.stroke(rc2.r, rc2.g, rc2.b, Math.round(innerAlpha * 80));
            p.strokeWeight(Math.max(0.5, 2 * (1 - progress)));
            p.ellipse(burst.x, burst.y, ringRadius2 * 2, ringRadius2 * 2);
        }

        // Central flash (very brief)
        if (progress < 0.15) {
            const flashAlpha = (1 - progress / 0.15) * 200;
            const flashSize = (1 - progress / 0.15) * 40 + 5;
            p.noStroke();
            p.fill(255, 255, 255, Math.round(flashAlpha * 0.4));
            p.ellipse(burst.x, burst.y, flashSize, flashSize);
            p.fill(rc.r, rc.g, rc.b, Math.round(flashAlpha * 0.3));
            p.ellipse(burst.x, burst.y, flashSize * 2.5, flashSize * 2.5);
        }

        // ── Sparks ───────────────────────────────────────────────────────
        p.noStroke();
        for (let s = 0; s < burst.sparks.length; s++) {
            const sp = burst.sparks[s];
            sp.life--;
            if (sp.life <= 0) continue;

            sp.x += sp.vx;
            sp.y += sp.vy;
            sp.vx *= 0.96; // drag
            sp.vy *= 0.96;
            sp.vy += 0.02; // subtle gravity

            const sparkProgress = 1 - (sp.life / sp.maxLife);
            const sparkAlpha = Math.max(0, (1 - sparkProgress * sparkProgress) * 220);
            const sparkSize = sp.size * (1 - sparkProgress * 0.7);

            // Glow
            p.fill(sp.cr, sp.cg, sp.cb, Math.round(sparkAlpha * 0.2));
            p.ellipse(sp.x, sp.y, sparkSize * 4, sparkSize * 4);

            // Core
            p.fill(sp.cr, sp.cg, sp.cb, Math.round(sparkAlpha));
            p.ellipse(sp.x, sp.y, sparkSize, sparkSize);
        }
    }

    // Remove expired bursts (iterate in reverse)
    for (let i = toRemove.length - 1; i >= 0; i--) {
        clickBursts.splice(toRemove[i], 1);
    }
}
