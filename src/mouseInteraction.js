/**
 * Mouse interaction module — applies forces to particles/vapor
 * and perturbs coefficients for classic mode.
 */

/**
 * Apply mouse force to a screen-space particle.
 * Returns {dx, dy} displacement to add to the particle's screen position.
 *
 * @param {number} sx - particle screen x
 * @param {number} sy - particle screen y
 * @param {number} mouseX - mouse screen x
 * @param {number} mouseY - mouse screen y
 * @param {number} strength - force strength (0.05 – 2.0)
 * @param {string} mode - 'attract' | 'repel' | 'orbit'
 * @param {number} canvasSize - canvas width (assumed square)
 */
export function applyMouseForce(sx, sy, mouseX, mouseY, strength, mode, canvasSize) {
    const dx = mouseX - sx;
    const dy = mouseY - sy;
    const distSq = dx * dx + dy * dy;
    const minDist = canvasSize * 0.02; // prevent singularity
    const safeDist = Math.max(distSq, minDist * minDist);

    // Force falls off with distance squared, scaled by canvas size
    const maxRadius = canvasSize * 0.5;
    const maxRadiusSq = maxRadius * maxRadius;

    if (distSq > maxRadiusSq) {
        return { dx: 0, dy: 0 };
    }

    const dist = Math.sqrt(safeDist);
    const normX = dx / dist;
    const normY = dy / dist;

    // Inverse-distance force, capped
    const forceMag = strength * canvasSize * 0.3 / safeDist * canvasSize * 0.01;
    const clampedForce = Math.min(forceMag, canvasSize * 0.02);

    switch (mode) {
        case 'attract':
            return {
                dx: normX * clampedForce,
                dy: normY * clampedForce,
            };
        case 'repel':
            return {
                dx: -normX * clampedForce,
                dy: -normY * clampedForce,
            };
        case 'orbit': {
            // Tangential force (perpendicular to radial direction)
            const tangX = -normY;
            const tangY = normX;
            // Mix a bit of attraction to keep particles nearby
            return {
                dx: tangX * clampedForce * 0.8 + normX * clampedForce * 0.2,
                dy: tangY * clampedForce * 0.8 + normY * clampedForce * 0.2,
            };
        }
        default:
            return { dx: 0, dy: 0 };
    }
}

/**
 * Perturb attractor coefficients based on normalized mouse position.
 * Returns a new coefficients object (shallow copy + perturbation).
 *
 * @param {object} coeffs - attractor coefficients
 * @param {number} mx - normalized mouse x (0–1)
 * @param {number} my - normalized mouse y (0–1)
 * @param {number} strength - perturbation strength (0.05–2.0)
 */
export function perturbCoeffs(coeffs, mx, my, strength) {
    const result = { ...coeffs };
    const keys = Object.keys(result);
    const scale = strength * 0.15;

    keys.forEach((key, i) => {
        // Each coefficient gets a unique sinusoidal perturbation
        // driven by mouse position
        const phase = i * 2.09; // ~120° apart
        const perturbation = Math.sin(mx * Math.PI * 2 + phase) *
            Math.cos(my * Math.PI * 2 + phase * 0.7) *
            scale;
        result[key] = result[key] + perturbation;
    });

    return result;
}
