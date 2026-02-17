/**
 * Symmetry / Kaleidoscope — applies radial mirror symmetry to the p5 canvas.
 *
 * Takes a single wedge of the canvas and reflects/rotates it to fill the full circle.
 * Supports 2, 4, 6, and 8-fold symmetry.
 */

let symCanvas = null;
let symCtx = null;

/**
 * Apply radial symmetry to the p5 canvas in-place.
 *
 * @param {p5} p - p5 instance
 * @param {number} folds - number of symmetry folds (2, 4, 6, 8). 1 = no-op.
 */
export function applySymmetry(p, folds) {
    if (!folds || folds <= 1) return;

    const canvas = p.drawingContext.canvas;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    // Ensure offscreen canvas
    if (!symCanvas) {
        symCanvas = document.createElement('canvas');
        symCtx = symCanvas.getContext('2d');
    }
    if (symCanvas.width !== w || symCanvas.height !== h) {
        symCanvas.width = w;
        symCanvas.height = h;
    }

    // Copy current frame to offscreen
    symCtx.clearRect(0, 0, w, h);
    symCtx.drawImage(canvas, 0, 0);

    // Clear the main canvas
    const mainCtx = p.drawingContext;
    mainCtx.save();
    mainCtx.clearRect(0, 0, w, h);

    const angleStep = (Math.PI * 2) / folds;

    // Draw the source wedge rotated N times + mirrored alternating
    for (let i = 0; i < folds; i++) {
        mainCtx.save();
        mainCtx.translate(cx, cy);
        mainCtx.rotate(i * angleStep);

        // Clip to wedge
        mainCtx.beginPath();
        mainCtx.moveTo(0, 0);
        const r = Math.max(w, h);
        mainCtx.lineTo(r * Math.cos(-angleStep / 2), r * Math.sin(-angleStep / 2));
        mainCtx.arc(0, 0, r, -angleStep / 2, angleStep / 2);
        mainCtx.lineTo(0, 0);
        mainCtx.closePath();
        mainCtx.clip();

        // Mirror every other slice
        if (i % 2 === 1) {
            mainCtx.scale(1, -1);
        }

        // Draw from offscreen, translated back so center aligns
        mainCtx.drawImage(symCanvas, -cx, -cy);

        mainCtx.restore();
    }

    mainCtx.restore();
}
