/**
 * Web Worker — computes Mandelbrot/Julia escape-time density buffer off main thread.
 * Self-contained: duplicates the compute function since workers can't share module imports.
 *
 * Receives: { params, width, height }
 * Posts:    { buffer: Uint32Array } (transferred, zero-copy)
 */

self.onmessage = function (e) {
    const { params, width, height } = e.data;
    const buffer = new Uint32Array(width * height);
    computeMandelbrotDensity(params, width, height, buffer);
    self.postMessage({ buffer }, [buffer.buffer]);
};

function computeMandelbrotDensity(params, width, height, buffer) {
    if (!params) return;
    const { maxIter, centerX, centerY, zoom, julia, juliaR, juliaI } = params;

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
                const log_zn = Math.log(zr2 + zi2) / 2;
                const nu = Math.log(log_zn / log2) / log2;
                const smooth = iter + 1 - nu;
                const t = smooth / maxIter;
                buffer[py * width + px] = Math.floor(t * 1000) + 1;
            }
        }
    }
}
