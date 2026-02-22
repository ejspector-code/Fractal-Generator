/**
 * Attractor engine — supports Peter de Jong, Clifford, Lorenz, Aizawa,
 * Buddhabrot, Burning Ship, Mandelbrot/Julia, and Curl Noise.
 *
 * Peter de Jong:
 *   x_{n+1} = sin(a · y_n) - cos(b · x_n)
 *   y_{n+1} = sin(c · x_n) - cos(d · y_n)
 *
 * Clifford:
 *   x_{n+1} = sin(a · y_n) + c · cos(a · x_n)
 *   y_{n+1} = sin(b · x_n) + d · cos(b · y_n)
 *
 * Lorenz:
 *   dx/dt = σ(y - x)
 *   dy/dt = x(ρ - z) - y
 *   dz/dt = xy - βz
 *
 * Aizawa:
 *   dx/dt = (z - b)·x - d·y
 *   dy/dt = d·x + (z - b)·y
 *   dz/dt = c + a·z - z³/3 - (x² + y²)(1 + e·z) + f·z·x³
 *
 * Buddhabrot:
 *   z = z² + c   (trace escaping orbits of the Mandelbrot set)
 *
 * Burning Ship:
 *   z = (|Re(z)| + i·|Im(z)|)² + c   (trace escaping orbits)
 *
 * Curl Noise:
 *   Particles follow curl of 2D Perlin noise field
 */

// ─── Peter de Jong ────────────────────────────────────────────────────────────

function deJongStep(params, x, y) {
    const nx = Math.sin(params.a * y) - Math.cos(params.b * x);
    const ny = Math.sin(params.c * x) - Math.cos(params.d * y);
    return { x: nx, y: ny };
}

// ─── Clifford ─────────────────────────────────────────────────────────────────

function cliffordStep(params, x, y) {
    const nx = Math.sin(params.a * y) + params.c * Math.cos(params.a * x);
    const ny = Math.sin(params.b * x) + params.d * Math.cos(params.b * y);
    return { x: nx, y: ny };
}

// ─── Lorenz System ────────────────────────────────────────────────────────────

function lorenzDerivatives(x, y, z, sigma, rho, beta) {
    return {
        dx: sigma * (y - x),
        dy: x * (rho - z) - y,
        dz: x * y - beta * z,
    };
}

function lorenzStepRK4(params, x, y, z, dt = 0.005) {
    const { sigma, rho, beta } = params;

    const k1 = lorenzDerivatives(x, y, z, sigma, rho, beta);
    const k2 = lorenzDerivatives(x + k1.dx * dt / 2, y + k1.dy * dt / 2, z + k1.dz * dt / 2, sigma, rho, beta);
    const k3 = lorenzDerivatives(x + k2.dx * dt / 2, y + k2.dy * dt / 2, z + k2.dz * dt / 2, sigma, rho, beta);
    const k4 = lorenzDerivatives(x + k3.dx * dt, y + k3.dy * dt, z + k3.dz * dt, sigma, rho, beta);

    return {
        x: x + (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx) * dt / 6,
        y: y + (k1.dy + 2 * k2.dy + 2 * k3.dy + k4.dy) * dt / 6,
        z: z + (k1.dz + 2 * k2.dz + 2 * k3.dz + k4.dz) * dt / 6,
    };
}

function lorenzProject(x, y, z) {
    const angle = 0.3;
    const px = x * Math.cos(angle) - y * Math.sin(angle);
    const py = z;
    return { px, py };
}

// ─── Aizawa System ────────────────────────────────────────────────────────────

function aizawaDerivatives(x, y, z, a, b, c, d, e, f) {
    const dx = (z - b) * x - d * y;
    const dy = d * x + (z - b) * y;
    const x2y2 = x * x + y * y;
    const dz = c + a * z - (z * z * z) / 3 - x2y2 * (1 + e * z) + f * z * x * x * x;
    return { dx, dy, dz };
}

function aizawaStepRK4(params, x, y, z, dt = 0.01) {
    const { a, b, c, d, e, f } = params;

    const k1 = aizawaDerivatives(x, y, z, a, b, c, d, e, f);
    const k2 = aizawaDerivatives(x + k1.dx * dt / 2, y + k1.dy * dt / 2, z + k1.dz * dt / 2, a, b, c, d, e, f);
    const k3 = aizawaDerivatives(x + k2.dx * dt / 2, y + k2.dy * dt / 2, z + k2.dz * dt / 2, a, b, c, d, e, f);
    const k4 = aizawaDerivatives(x + k3.dx * dt, y + k3.dy * dt, z + k3.dz * dt, a, b, c, d, e, f);

    return {
        x: x + (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx) * dt / 6,
        y: y + (k1.dy + 2 * k2.dy + 2 * k3.dy + k4.dy) * dt / 6,
        z: z + (k1.dz + 2 * k2.dz + 2 * k3.dz + k4.dz) * dt / 6,
    };
}

function aizawaProject(x, y, z) {
    // Slight rotation so we see the structure
    const angle = 0.5;
    const px = x * Math.cos(angle) - y * Math.sin(angle);
    const py = z;
    return { px, py };
}

// ─── Buddhabrot ───────────────────────────────────────────────────────────────

/**
 * Compute Buddhabrot density.
 * Samples random c values, iterates z = z² + c,
 * and for orbits that escape, traces the path onto the density buffer.
 *
 * @param {object} params - { maxIter, samples, anti, centerX, centerY, zoom }
 * @param {number} width
 * @param {number} height
 * @param {Uint32Array} buffer
 */
function computeBuddhabrotDensity(params, width, height, buffer) {
    if (!params) return buffer;
    const { maxIter, samples, anti, centerX, centerY, zoom } = params;

    // The visible region in the complex plane
    const scale = 3.0 / zoom;
    const minR = centerX - scale / 2;
    const maxR = centerX + scale / 2;
    const minI = centerY - scale / 2;
    const maxI = centerY + scale / 2;

    // Sampling region is wider than view to catch orbits that pass through
    const sampleScale = 4.0;
    const sMinR = -2.5, sMaxR = 1.5;
    const sMinI = -2.0, sMaxI = 2.0;

    // Temp array for storing orbit points
    const orbitX = new Float64Array(maxIter);
    const orbitY = new Float64Array(maxIter);

    // Seeded pseudo-random (simple LCG for speed)
    let rngState = 12345;
    function rng() {
        rngState = (rngState * 1664525 + 1013904223) & 0x7fffffff;
        return rngState / 0x7fffffff;
    }

    for (let s = 0; s < samples; s++) {
        // Pick random c in the sampling region
        const cr = sMinR + rng() * (sMaxR - sMinR);
        const ci = sMinI + rng() * (sMaxI - sMinI);

        // Quick Mandelbrot cardioid / period-2 bulb rejection
        const q = (cr - 0.25) * (cr - 0.25) + ci * ci;
        if (q * (q + (cr - 0.25)) < 0.25 * ci * ci) continue;
        if ((cr + 1) * (cr + 1) + ci * ci < 0.0625) continue;

        // Iterate z = z² + c
        let zr = 0, zi = 0;
        let escaped = false;
        let orbitLen = 0;

        for (let i = 0; i < maxIter; i++) {
            const zr2 = zr * zr;
            const zi2 = zi * zi;

            if (zr2 + zi2 > 4) {
                escaped = true;
                break;
            }

            const newZr = zr2 - zi2 + cr;
            zi = 2 * zr * zi + ci;
            zr = newZr;

            orbitX[orbitLen] = zr;
            orbitY[orbitLen] = zi;
            orbitLen++;
        }

        // Buddhabrot = escaping orbits; Anti = non-escaping
        const shouldTrace = anti ? !escaped : escaped;
        if (!shouldTrace) continue;

        // Trace orbit onto buffer
        for (let i = 0; i < orbitLen; i++) {
            const px = Math.floor(((orbitX[i] - minR) / scale) * width);
            const py = Math.floor(((orbitY[i] - minI) / scale) * height);

            if (px >= 0 && px < width && py >= 0 && py < height) {
                buffer[py * width + px]++;
            }
        }
    }

    return buffer;
}

/**
 * For Particles/Vapor: trace a single Buddhabrot orbit.
 * Returns an array of {x, y} screen coordinates.
 */
export function buddhabrotOrbit(params, width, height) {
    if (!params) return [];
    const { maxIter, centerX, centerY, zoom } = params;
    const scale = 3.0 / zoom;
    const minR = centerX - scale / 2;
    const minI = centerY - scale / 2;

    // Find an escaping orbit
    for (let attempt = 0; attempt < 200; attempt++) {
        const cr = -2.5 + Math.random() * 4;
        const ci = -2 + Math.random() * 4;

        let zr = 0, zi = 0;
        let escaped = false;
        const points = [];

        for (let i = 0; i < maxIter; i++) {
            const zr2 = zr * zr;
            const zi2 = zi * zi;
            if (zr2 + zi2 > 4) { escaped = true; break; }
            const newZr = zr2 - zi2 + cr;
            zi = 2 * zr * zi + ci;
            zr = newZr;
            points.push({ x: zr, y: zi });
        }

        if (escaped && points.length > 5) {
            return points.map(p => ({
                x: ((p.x - minR) / scale) * width,
                y: ((p.y - minI) / scale) * height,
            }));
        }
    }
    return [];
}

// ─── Burning Ship ─────────────────────────────────────────────────────────────

/**
 * Compute Burning Ship density (Buddhabrot-style).
 * Same as Buddhabrot but uses z = (|Re(z)| + i·|Im(z)|)² + c
 */
function computeBurningShipDensity(params, width, height, buffer) {
    if (!params) return buffer;
    const { maxIter, samples, anti, centerX, centerY, zoom } = params;

    const scale = 3.0 / zoom;
    const minR = centerX - scale / 2;
    const minI = centerY - scale / 2;

    const sMinR = -2.5, sMaxR = 1.5;
    const sMinI = -2.0, sMaxI = 2.0;

    const orbitX = new Float64Array(maxIter);
    const orbitY = new Float64Array(maxIter);

    let rngState = 12345;
    function rng() {
        rngState = (rngState * 1664525 + 1013904223) & 0x7fffffff;
        return rngState / 0x7fffffff;
    }

    for (let s = 0; s < samples; s++) {
        const cr = sMinR + rng() * (sMaxR - sMinR);
        const ci = sMinI + rng() * (sMaxI - sMinI);

        let zr = 0, zi = 0;
        let escaped = false;
        let orbitLen = 0;

        for (let i = 0; i < maxIter; i++) {
            // Burning Ship: take absolute values before squaring
            zr = Math.abs(zr);
            zi = Math.abs(zi);

            const zr2 = zr * zr;
            const zi2 = zi * zi;

            if (zr2 + zi2 > 4) {
                escaped = true;
                break;
            }

            const newZr = zr2 - zi2 + cr;
            zi = 2 * zr * zi + ci;
            zr = newZr;

            orbitX[orbitLen] = zr;
            orbitY[orbitLen] = zi;
            orbitLen++;
        }

        const shouldTrace = anti ? !escaped : escaped;
        if (!shouldTrace) continue;

        for (let i = 0; i < orbitLen; i++) {
            const px = Math.floor(((orbitX[i] - minR) / scale) * width);
            const py = Math.floor(((orbitY[i] - minI) / scale) * height);

            if (px >= 0 && px < width && py >= 0 && py < height) {
                buffer[py * width + px]++;
            }
        }
    }

    return buffer;
}

/**
 * Trace a single Burning Ship orbit for Particles/Vapor.
 */
export function burningShipOrbit(params, width, height) {
    if (!params) return [];
    const { maxIter, centerX, centerY, zoom } = params;
    const scale = 3.0 / zoom;
    const minR = centerX - scale / 2;
    const minI = centerY - scale / 2;

    for (let attempt = 0; attempt < 200; attempt++) {
        const cr = -2.5 + Math.random() * 4;
        const ci = -2 + Math.random() * 4;

        let zr = 0, zi = 0;
        let escaped = false;
        const points = [];

        for (let i = 0; i < maxIter; i++) {
            zr = Math.abs(zr);
            zi = Math.abs(zi);

            const zr2 = zr * zr;
            const zi2 = zi * zi;
            if (zr2 + zi2 > 4) { escaped = true; break; }
            const newZr = zr2 - zi2 + cr;
            zi = 2 * zr * zi + ci;
            zr = newZr;
            points.push({ x: zr, y: zi });
        }

        if (escaped && points.length > 5) {
            return points.map(p => ({
                x: ((p.x - minR) / scale) * width,
                y: ((p.y - minI) / scale) * height,
            }));
        }
    }
    return [];
}

// ─── Mandelbrot / Julia Set ───────────────────────────────────────────────────

/**
 * Compute Mandelbrot/Julia escape-time density (per-pixel).
 * Each pixel maps to a complex number. We iterate z = z² + c and
 * store a smooth iteration count in the density buffer.
 *
 * Mandelbrot mode: c = pixel, z₀ = 0
 * Julia mode: z₀ = pixel, c = fixed (juliaR + i·juliaI)
 *
 * @param {object} params - { maxIter, centerX, centerY, zoom, julia, juliaR, juliaI }
 * @param {number} width
 * @param {number} height
 * @param {Uint32Array} buffer
 */
function computeMandelbrotDensity(params, width, height, buffer) {
    if (!params) return buffer;
    const { maxIter, centerX, centerY, zoom, julia, juliaR, juliaI } = params;

    // Map the visible region to the complex plane
    const aspect = width / height;
    const scale = 3.0 / zoom;
    const minR = centerX - scale * aspect / 2;
    const minI = centerY - scale / 2;
    const stepR = (scale * aspect) / width;
    const stepI = scale / height;

    const log2 = Math.log(2);

    for (let py = 0; py < height; py++) {
        const ci_base = minI + py * stepI;
        for (let px = 0; px < width; px++) {
            const cr_base = minR + px * stepR;

            let zr, zi, cr, ci;
            if (julia) {
                zr = cr_base;
                zi = ci_base;
                cr = juliaR;
                ci = juliaI;
            } else {
                zr = 0;
                zi = 0;
                cr = cr_base;
                ci = ci_base;
            }

            let iter = 0;
            let zr2 = zr * zr;
            let zi2 = zi * zi;

            while (zr2 + zi2 <= 4.0 && iter < maxIter) {
                zi = 2 * zr * zi + ci;
                zr = zr2 - zi2 + cr;
                zr2 = zr * zr;
                zi2 = zi * zi;
                iter++;
            }

            if (iter < maxIter) {
                // Smooth coloring: fractional escape count normalized to 0-1
                const log_zn = Math.log(zr2 + zi2) / 2;
                const nu = Math.log(log_zn / log2) / log2;
                const smooth = iter + 1 - nu;
                // Normalize to 0-1000 range for density mapping compatibility
                // Use cyclic mapping for richer color variation
                const t = (smooth / maxIter);
                buffer[py * width + px] = Math.floor(t * 1000) + 1;
            }
            // Interior (non-escaping) stays 0
        }
    }

    return buffer;
}

/**
 * Trace a single Mandelbrot/Julia escape orbit for Particles/Vapor rendering.
 * Returns an array of {x, y} screen coordinates.
 */
export function mandelbrotOrbit(params, width, height) {
    if (!params) return [];
    const { maxIter, centerX, centerY, zoom, julia, juliaR, juliaI } = params;
    const aspect = width / height;
    const scale = 3.0 / zoom;
    const minR = centerX - scale * aspect / 2;
    const minI = centerY - scale / 2;

    for (let attempt = 0; attempt < 200; attempt++) {
        let cr, ci, zr, zi;

        if (julia) {
            // Julia: vary z₀, fix c
            zr = minR + Math.random() * scale * aspect;
            zi = minI + Math.random() * scale;
            cr = juliaR;
            ci = juliaI;
        } else {
            // Mandelbrot: vary c, z₀ = 0
            cr = -2.5 + Math.random() * 4;
            ci = -2 + Math.random() * 4;
            zr = 0;
            zi = 0;
        }

        let escaped = false;
        const points = [];

        for (let i = 0; i < maxIter; i++) {
            const zr2 = zr * zr;
            const zi2 = zi * zi;
            if (zr2 + zi2 > 4) { escaped = true; break; }
            const newZr = zr2 - zi2 + cr;
            zi = 2 * zr * zi + ci;
            zr = newZr;
            points.push({ x: zr, y: zi });
        }

        if (escaped && points.length > 5) {
            return points.map(p => ({
                x: ((p.x - minR) / (scale * aspect)) * width,
                y: ((p.y - minI) / scale) * height,
            }));
        }
    }
    return [];
}

// ─── Curl Noise Flow Field ────────────────────────────────────────────────────

/**
 * Simple Perlin-like noise for curl noise (standalone, no p5 dependency).
 * Uses a permutation table for gradient noise.
 */
const _perm = new Uint8Array(512);
const _grad = [
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [1, 0], [-1, 0], [0, 1], [0, -1],
];

// Initialize permutation table with seed
function initNoiseTable(seed) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates shuffle with seed
    let s = seed;
    for (let i = 255; i > 0; i--) {
        s = (s * 1664525 + 1013904223) & 0x7fffffff;
        const j = s % (i + 1);
        [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) _perm[i] = p[i & 255];
}
initNoiseTable(42);

function _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function _lerp(a, b, t) { return a + t * (b - a); }
function _dot2(g, x, y) { return g[0] * x + g[1] * y; }

function simplexNoise2D(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = _fade(xf);
    const v = _fade(yf);

    const aa = _perm[_perm[X] + Y] & 7;
    const ab = _perm[_perm[X] + Y + 1] & 7;
    const ba = _perm[_perm[X + 1] + Y] & 7;
    const bb = _perm[_perm[X + 1] + Y + 1] & 7;

    const x1 = _lerp(_dot2(_grad[aa], xf, yf), _dot2(_grad[ba], xf - 1, yf), u);
    const x2 = _lerp(_dot2(_grad[ab], xf, yf - 1), _dot2(_grad[bb], xf - 1, yf - 1), u);
    return _lerp(x1, x2, v);
}

function fbmNoise(x, y, octaves, lacunarity, gain) {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxVal = 0;
    for (let i = 0; i < octaves; i++) {
        value += amplitude * simplexNoise2D(x * frequency, y * frequency);
        maxVal += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }
    return value / maxVal;
}

/**
 * Curl noise step — returns velocity from the curl of a noise field.
 */
function curlNoiseStep(params, x, y, time) {
    const { scale, octaves, lacunarity, gain } = params;
    const eps = 0.001;

    // Compute curl: velocity = (dN/dy, -dN/dx)
    const n_dy = fbmNoise(x * scale, (y + eps) * scale + time, octaves, lacunarity, gain);
    const n_my = fbmNoise(x * scale, (y - eps) * scale + time, octaves, lacunarity, gain);
    const n_dx = fbmNoise((x + eps) * scale, y * scale + time, octaves, lacunarity, gain);
    const n_mx = fbmNoise((x - eps) * scale, y * scale + time, octaves, lacunarity, gain);

    const curlX = (n_dy - n_my) / (2 * eps);
    const curlY = -(n_dx - n_mx) / (2 * eps);

    return { x: curlX, y: curlY };
}

// ─── Unified API ──────────────────────────────────────────────────────────────

/**
 * Compute a density histogram.
 * @param {string} attractorType - 'dejong' | 'clifford' | 'lorenz' | 'aizawa' | 'buddhabrot' | 'burningship' | 'mandelbrot' | 'curlnoise'
 * @param {object} params
 * @param {number} width
 * @param {number} height
 * @param {number} iterations
 */
export function computeDensityHistogram(attractorType, params, width, height, iterations) {
    const buffer = new Uint32Array(width * height);

    if (attractorType === 'buddhabrot') {
        return computeBuddhabrotDensity(params, width, height, buffer);
    }
    if (attractorType === 'burningship') {
        return computeBurningShipDensity(params, width, height, buffer);
    }
    if (attractorType === 'mandelbrot') {
        return computeMandelbrotDensity(params, width, height, buffer);
    }
    if (attractorType === 'lorenz') {
        return computeLorenzDensity(params, width, height, iterations, buffer);
    }
    if (attractorType === 'aizawa') {
        return computeAizawaDensity(params, width, height, iterations, buffer);
    }
    if (attractorType === 'clifford') {
        return computeCliffordDensity(params, width, height, iterations, buffer);
    }
    if (attractorType === 'curlnoise') {
        return computeCurlNoiseDensity(params, width, height, iterations, buffer);
    }
    return computeDeJongDensity(params, width, height, iterations, buffer);
}

function computeDeJongDensity(params, width, height, iterations, buffer) {
    let x = 0.1, y = 0.1;
    const scale = Math.min(width, height) / 4.2;
    const cx = width / 2;
    const cy = height / 2;

    for (let i = 0; i < 100; i++) {
        const r = deJongStep(params, x, y);
        x = r.x; y = r.y;
    }

    for (let i = 0; i < iterations; i++) {
        const r = deJongStep(params, x, y);
        x = r.x; y = r.y;
        const px = Math.floor(cx + x * scale);
        const py = Math.floor(cy + y * scale);
        if (px >= 0 && px < width && py >= 0 && py < height) {
            buffer[py * width + px]++;
        }
    }
    return buffer;
}

function computeCliffordDensity(params, width, height, iterations, buffer) {
    let x = 0.1, y = 0.1;
    const scale = Math.min(width, height) / 5.0;
    const cx = width / 2;
    const cy = height / 2;

    for (let i = 0; i < 100; i++) {
        const r = cliffordStep(params, x, y);
        x = r.x; y = r.y;
    }

    for (let i = 0; i < iterations; i++) {
        const r = cliffordStep(params, x, y);
        x = r.x; y = r.y;
        const px = Math.floor(cx + x * scale);
        const py = Math.floor(cy + y * scale);
        if (px >= 0 && px < width && py >= 0 && py < height) {
            buffer[py * width + px]++;
        }
    }
    return buffer;
}

function computeLorenzDensity(params, width, height, iterations, buffer) {
    let x = 0.1, y = 0, z = 0;
    const scaleFactor = Math.min(width, height) / 60;
    const cx = width / 2;
    const cy = height * 0.7;

    for (let i = 0; i < 500; i++) {
        const r = lorenzStepRK4(params, x, y, z);
        x = r.x; y = r.y; z = r.z;
    }

    for (let i = 0; i < iterations; i++) {
        const r = lorenzStepRK4(params, x, y, z);
        x = r.x; y = r.y; z = r.z;
        const proj = lorenzProject(x, y, z);
        const px = Math.floor(cx + proj.px * scaleFactor);
        const py = Math.floor(cy - proj.py * scaleFactor);
        if (px >= 0 && px < width && py >= 0 && py < height) {
            buffer[py * width + px]++;
        }
    }
    return buffer;
}

function computeAizawaDensity(params, width, height, iterations, buffer) {
    let x = 0.1, y = 0, z = 0;
    const scaleFactor = Math.min(width, height) / 4.0;
    const cx = width / 2;
    const cy = height / 2;

    // Warm up
    for (let i = 0; i < 500; i++) {
        const r = aizawaStepRK4(params, x, y, z);
        x = r.x; y = r.y; z = r.z;
    }

    for (let i = 0; i < iterations; i++) {
        const r = aizawaStepRK4(params, x, y, z);
        x = r.x; y = r.y; z = r.z;
        const proj = aizawaProject(x, y, z);
        const px = Math.floor(cx + proj.px * scaleFactor);
        const py = Math.floor(cy - proj.py * scaleFactor);
        if (px >= 0 && px < width && py >= 0 && py < height) {
            buffer[py * width + px]++;
        }
    }
    return buffer;
}

function computeCurlNoiseDensity(params, width, height, iterations, buffer) {
    const numParticles = 5000;
    const stepsPerParticle = Math.floor(iterations / numParticles);
    const speed = params.speed || 0.5;

    for (let p = 0; p < numParticles; p++) {
        // Start from random position across the canvas
        let x = (Math.random() - 0.5) * 4;
        let y = (Math.random() - 0.5) * 4;

        for (let s = 0; s < stepsPerParticle; s++) {
            const curl = curlNoiseStep(params, x, y, 0);
            x += curl.x * speed * 0.02;
            y += curl.y * speed * 0.02;

            const px = Math.floor((x + 2) / 4 * width);
            const py = Math.floor((y + 2) / 4 * height);
            if (px >= 0 && px < width && py >= 0 && py < height) {
                buffer[py * width + px]++;
            }
        }
    }
    return buffer;
}

/**
 * Step a single point one iteration forward.
 */
export function stepPoint(attractorType, params, x, y, z = 0, time = 0) {
    if (attractorType === 'lorenz') {
        const r = lorenzStepRK4(params, x, y, z);
        return { x: r.x, y: r.y, z: r.z };
    }
    if (attractorType === 'aizawa') {
        const r = aizawaStepRK4(params, x, y, z);
        return { x: r.x, y: r.y, z: r.z };
    }
    if (attractorType === 'clifford') {
        const r = cliffordStep(params, x, y);
        return { x: r.x, y: r.y, z: 0 };
    }
    if (attractorType === 'curlnoise') {
        const curl = curlNoiseStep(params, x, y, time);
        const speed = params.speed || 0.5;
        return { x: x + curl.x * speed * 0.02, y: y + curl.y * speed * 0.02, z: 0 };
    }
    // Buddhabrot/Burning Ship particles are orbit-based, not step-based (handled in renderer)
    const r = deJongStep(params, x, y);
    return { x: r.x, y: r.y, z: 0 };
}

/**
 * Convert attractor coordinates to screen coordinates.
 */
export function toScreen(attractorType, x, y, z, width, height) {
    if (attractorType === 'lorenz') {
        const scaleFactor = Math.min(width, height) / 60;
        const cx = width / 2;
        const cy = height * 0.7;
        const proj = lorenzProject(x, y, z);
        return {
            sx: cx + proj.px * scaleFactor,
            sy: cy - proj.py * scaleFactor,
        };
    }
    if (attractorType === 'aizawa') {
        const scaleFactor = Math.min(width, height) / 4.0;
        const cx = width / 2;
        const cy = height / 2;
        const proj = aizawaProject(x, y, z);
        return {
            sx: cx + proj.px * scaleFactor,
            sy: cy - proj.py * scaleFactor,
        };
    }
    if (attractorType === 'curlnoise') {
        return {
            sx: (x + 2) / 4 * width,
            sy: (y + 2) / 4 * height,
        };
    }
    if (attractorType === 'clifford') {
        const scale = Math.min(width, height) / 5.0;
        return {
            sx: width / 2 + x * scale,
            sy: height / 2 + y * scale,
        };
    }
    const scale = Math.min(width, height) / 4.2;
    return {
        sx: width / 2 + x * scale,
        sy: height / 2 + y * scale,
    };
}

/**
 * Get initial particle position for given attractor type.
 */
export function getInitialPosition(attractorType) {
    if (attractorType === 'lorenz') {
        return {
            x: 0.1 + (Math.random() - 0.5) * 2,
            y: (Math.random() - 0.5) * 2,
            z: (Math.random() - 0.5) * 2,
        };
    }
    if (attractorType === 'aizawa') {
        return {
            x: 0.1 + (Math.random() - 0.5) * 0.1,
            y: (Math.random() - 0.5) * 0.1,
            z: (Math.random() - 0.5) * 0.1,
        };
    }
    if (attractorType === 'curlnoise') {
        return {
            x: (Math.random() - 0.5) * 4,
            y: (Math.random() - 0.5) * 4,
            z: 0,
        };
    }
    return {
        x: (Math.random() - 0.5) * 4,
        y: (Math.random() - 0.5) * 4,
        z: 0,
    };
}
