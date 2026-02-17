/**
 * Post-Processing Filters — composites effects onto the p5 canvas.
 *
 * Filters: Bloom, Chromatic Aberration, Vignette, Film Grain, CRT Scanlines.
 * Uses an overlay <canvas> (pointer-events: none) stacked on top of the p5 canvas.
 */

let overlay = null;
let ctx = null;
let tempCanvas = null;
let tempCtx = null;

/**
 * Ensure the overlay canvas exists, sized to match the p5 canvas.
 */
function ensureOverlay(p5Canvas) {
    const w = p5Canvas.width;
    const h = p5Canvas.height;

    if (!overlay) {
        overlay = document.createElement('canvas');
        overlay.id = 'post-canvas';
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.pointerEvents = 'none';
        overlay.style.borderRadius = '4px';
        p5Canvas.parentNode.appendChild(overlay);
        ctx = overlay.getContext('2d');
    }

    if (overlay.width !== w || overlay.height !== h) {
        overlay.width = w;
        overlay.height = h;
        overlay.style.width = p5Canvas.style.width || `${w}px`;
        overlay.style.height = p5Canvas.style.height || `${h}px`;
    }

    if (!tempCanvas) {
        tempCanvas = document.createElement('canvas');
        tempCtx = tempCanvas.getContext('2d');
    }
    if (tempCanvas.width !== w || tempCanvas.height !== h) {
        tempCanvas.width = w;
        tempCanvas.height = h;
    }

    return { overlay, ctx, w, h };
}

/**
 * Apply all enabled post-processing effects.
 *
 * @param {HTMLCanvasElement} p5Canvas - the p5.js <canvas> element
 * @param {object} pp - postProcess state
 *   { bloom: {enabled,strength}, chromatic: {enabled,strength},
 *     vignette: {enabled,strength}, grain: {enabled,strength},
 *     scanlines: {enabled,strength} }
 */
export function applyPostProcessing(p5Canvas, pp) {
    // If nothing enabled, hide overlay and bail
    const anyEnabled = pp.bloom.enabled || pp.chromatic.enabled ||
        pp.vignette.enabled || pp.grain.enabled || pp.scanlines.enabled;

    if (!anyEnabled) {
        if (overlay) overlay.style.display = 'none';
        return;
    }

    const { ctx: c, w, h } = ensureOverlay(p5Canvas);
    overlay.style.display = '';

    // Clear
    c.clearRect(0, 0, w, h);

    // 1. Bloom / Glow
    if (pp.bloom.enabled && pp.bloom.strength > 0) {
        applyBloom(c, p5Canvas, w, h, pp.bloom.strength);
    }

    // 2. Chromatic Aberration
    if (pp.chromatic.enabled && pp.chromatic.strength > 0) {
        applyChromaticAberration(c, p5Canvas, w, h, pp.chromatic.strength);
    }

    // 3. Vignette
    if (pp.vignette.enabled && pp.vignette.strength > 0) {
        applyVignette(c, w, h, pp.vignette.strength);
    }

    // 4. Film Grain
    if (pp.grain.enabled && pp.grain.strength > 0) {
        applyGrain(c, w, h, pp.grain.strength);
    }

    // 5. CRT Scanlines
    if (pp.scanlines.enabled && pp.scanlines.strength > 0) {
        applyScanlines(c, w, h, pp.scanlines.strength);
    }
}

// ─── Bloom ────────────────────────────────────────────────────────────────────

function applyBloom(c, sourceCanvas, w, h, strength) {
    // Draw blurred copy with screen blending
    c.save();
    c.globalCompositeOperation = 'screen';
    c.globalAlpha = strength * 0.45;
    c.filter = `blur(${Math.round(8 + strength * 16)}px) brightness(${1.2 + strength * 0.6})`;
    c.drawImage(sourceCanvas, 0, 0, w, h);
    c.restore();

    // Second softer pass for wider glow
    c.save();
    c.globalCompositeOperation = 'screen';
    c.globalAlpha = strength * 0.2;
    c.filter = `blur(${Math.round(20 + strength * 30)}px) brightness(${1.1 + strength * 0.3})`;
    c.drawImage(sourceCanvas, 0, 0, w, h);
    c.restore();
}

// ─── Chromatic Aberration ─────────────────────────────────────────────────────

function applyChromaticAberration(c, sourceCanvas, w, h, strength) {
    const offset = Math.round(2 + strength * 6);

    // We need to work on a temp canvas to isolate channels
    tempCtx.clearRect(0, 0, w, h);
    tempCtx.drawImage(sourceCanvas, 0, 0);

    // Red channel shifted right
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = strength * 0.35;

    // Use color matrix via filter to isolate red-ish tint
    tempCtx.save();
    tempCtx.globalCompositeOperation = 'source-atop';
    tempCtx.fillStyle = 'rgba(255, 0, 0, 0.5)';
    tempCtx.fillRect(0, 0, w, h);
    tempCtx.restore();

    c.drawImage(tempCanvas, offset, 0, w, h);
    c.restore();

    // Restore temp with original for blue channel
    tempCtx.clearRect(0, 0, w, h);
    tempCtx.drawImage(sourceCanvas, 0, 0);
    tempCtx.save();
    tempCtx.globalCompositeOperation = 'source-atop';
    tempCtx.fillStyle = 'rgba(0, 80, 255, 0.5)';
    tempCtx.fillRect(0, 0, w, h);
    tempCtx.restore();

    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = strength * 0.35;
    c.drawImage(tempCanvas, -offset, 0, w, h);
    c.restore();
}

// ─── Vignette ─────────────────────────────────────────────────────────────────

function applyVignette(c, w, h, strength) {
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.max(w, h) * 0.7;

    const grad = c.createRadialGradient(cx, cy, radius * (0.3 + (1 - strength) * 0.4), cx, cy, radius);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(1, `rgba(0, 0, 0, ${0.4 + strength * 0.5})`);

    c.save();
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = grad;
    c.fillRect(0, 0, w, h);
    c.restore();
}

// ─── Film Grain ───────────────────────────────────────────────────────────────

let grainImageData = null;
let grainW = 0;
let grainH = 0;

function applyGrain(c, w, h, strength) {
    // Create or resize grain buffer — we use a smaller buffer for perf, tiled
    const gw = Math.min(w, 256);
    const gh = Math.min(h, 256);

    if (!grainImageData || grainW !== gw || grainH !== gh) {
        grainImageData = new ImageData(gw, gh);
        grainW = gw;
        grainH = gh;
    }

    const data = grainImageData.data;
    const alpha = Math.round(20 + strength * 60);

    for (let i = 0; i < data.length; i += 4) {
        const v = Math.random() * 255;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = alpha;
    }

    // Draw the grain pattern
    tempCtx.putImageData(grainImageData, 0, 0);

    c.save();
    c.globalCompositeOperation = 'overlay';
    c.globalAlpha = strength * 0.6;

    // Tile if canvas is larger than grain buffer
    for (let x = 0; x < w; x += gw) {
        for (let y = 0; y < h; y += gh) {
            c.drawImage(tempCanvas, 0, 0, gw, gh, x, y,
                Math.min(gw, w - x), Math.min(gh, h - y));
        }
    }
    c.restore();
}

// ─── CRT Scanlines ────────────────────────────────────────────────────────────

function applyScanlines(c, w, h, strength) {
    c.save();
    c.globalCompositeOperation = 'source-over';

    const lineSpacing = 3; // Every 3rd pixel row
    const alpha = 0.1 + strength * 0.25;
    c.fillStyle = `rgba(0, 0, 0, ${alpha})`;

    for (let y = 0; y < h; y += lineSpacing) {
        c.fillRect(0, y, w, 1);
    }
    c.restore();
}
