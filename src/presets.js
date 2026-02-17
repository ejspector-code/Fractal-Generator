/**
 * Curated preset parameter sets for all attractor types.
 */

export const DEJONG_PRESETS = [
  { name: 'Butterfly', a: -2.24, b: 0.43, c: -0.65, d: -2.43 },
  { name: 'Cosmic Spiral', a: 2.01, b: -2.53, c: 1.61, d: -0.33 },
  { name: 'Leaf Vortex', a: 1.4, b: -2.3, c: 2.4, d: -2.1 },
  { name: 'Nebula', a: -2.0, b: -2.0, c: -1.2, d: 2.0 },
  { name: 'Jellyfish', a: 1.641, b: 1.902, c: 0.316, d: 1.525 },
  { name: 'Phoenix', a: 2.879, b: -0.168, c: -2.794, d: -2.148 },
  { name: 'Stardust', a: -1.4, b: 1.56, c: 1.4, d: -6.56 },
  { name: 'Silk Waves', a: 0.97, b: -1.90, c: 1.38, d: -1.50 },
  { name: 'Fractal Rose', a: -2.7, b: -0.09, c: -0.86, d: -2.20 },
  { name: 'Crystal Web', a: -0.827, b: -1.637, c: 1.659, d: -0.943 },
];

export const CLIFFORD_PRESETS = [
  { name: 'Silk Flow', a: -1.4, b: 1.6, c: 1.0, d: 0.7 },
  { name: 'Dragon Scales', a: 1.7, b: 1.7, c: 0.6, d: 1.2 },
  { name: 'Feather', a: -1.7, b: 1.3, c: -0.1, d: -1.2 },
  { name: 'Galaxy Arm', a: 1.5, b: -1.8, c: 1.6, d: 0.9 },
  { name: 'Coral Reef', a: -1.8, b: -2.0, c: -0.5, d: -0.9 },
  { name: 'Storm Eye', a: 2.0, b: -0.6, c: -1.2, d: 1.6 },
  { name: 'Ribbon Knot', a: -1.3, b: -1.3, c: -1.8, d: -0.6 },
  { name: 'Chrysalis', a: -1.6, b: 1.5, c: 0.4, d: -1.0 },
];

export const LORENZ_PRESETS = [
  { name: 'Classic', sigma: 10, rho: 28, beta: 2.667 },
  { name: 'Tight Wings', sigma: 10, rho: 15, beta: 2.667 },
  { name: 'Chaotic Edge', sigma: 10, rho: 99.96, beta: 2.667 },
  { name: 'Slow Drift', sigma: 4, rho: 28, beta: 1.5 },
  { name: 'Dense Core', sigma: 16, rho: 45, beta: 4.0 },
  { name: 'Thin Spiral', sigma: 6, rho: 22, beta: 1.0 },
  { name: 'Wide Orbit', sigma: 14, rho: 35, beta: 3.0 },
  { name: 'Turbulent', sigma: 10, rho: 60, beta: 2.667 },
];

export const AIZAWA_PRESETS = [
  { name: 'Classic', a: 0.95, b: 0.7, c: 0.6, d: 3.5, e: 0.25, f: 0.1 },
  { name: 'Tight Sphere', a: 0.9, b: 0.6, c: 0.5, d: 3.5, e: 0.3, f: 0.1 },
  { name: 'Spiral Eruption', a: 0.95, b: 0.7, c: 0.65, d: 3.5, e: 0.1, f: 0.15 },
  { name: 'Open Bloom', a: 0.8, b: 0.5, c: 0.7, d: 3.0, e: 0.2, f: 0.05 },
  { name: 'Dense Knot', a: 1.0, b: 0.8, c: 0.5, d: 4.0, e: 0.3, f: 0.1 },
  { name: 'Whisper', a: 0.85, b: 0.65, c: 0.55, d: 3.2, e: 0.15, f: 0.08 },
];

export const BUDDHABROT_PRESETS = [
  { name: 'Classic Ghost', maxIter: 200, samples: 500000, anti: false, centerX: -0.5, centerY: 0, zoom: 1.0 },
  { name: 'Deep Detail', maxIter: 1000, samples: 300000, anti: false, centerX: -0.5, centerY: 0, zoom: 1.0 },
  { name: 'Anti-Buddha', maxIter: 200, samples: 500000, anti: true, centerX: -0.5, centerY: 0, zoom: 1.0 },
  { name: 'Zoomed Core', maxIter: 500, samples: 400000, anti: false, centerX: -0.5, centerY: 0, zoom: 2.5 },
  { name: 'Ethereal', maxIter: 50, samples: 800000, anti: false, centerX: -0.5, centerY: 0, zoom: 1.0 },
  { name: 'Dense Web', maxIter: 5000, samples: 150000, anti: false, centerX: -0.5, centerY: 0, zoom: 1.0 },
  { name: 'Anti Zoom', maxIter: 300, samples: 400000, anti: true, centerX: -0.75, centerY: 0.1, zoom: 3.0 },
  { name: 'Wide Field', maxIter: 100, samples: 600000, anti: false, centerX: -0.3, centerY: 0, zoom: 0.7 },
];

export const BURNINGSHIP_PRESETS = [
  { name: 'Full Ship', maxIter: 200, samples: 500000, anti: false, centerX: -0.4, centerY: -0.6, zoom: 1.0 },
  { name: 'Bow Detail', maxIter: 500, samples: 400000, anti: false, centerX: -1.76, centerY: -0.03, zoom: 6.0 },
  { name: 'Anti Ship', maxIter: 200, samples: 500000, anti: true, centerX: -0.4, centerY: -0.6, zoom: 1.0 },
  { name: 'Mast Zoom', maxIter: 800, samples: 300000, anti: false, centerX: -0.4, centerY: -0.6, zoom: 3.0 },
  { name: 'Ethereal Wake', maxIter: 50, samples: 800000, anti: false, centerX: -0.4, centerY: -0.6, zoom: 1.0 },
  { name: 'Deep Keel', maxIter: 2000, samples: 200000, anti: false, centerX: -0.4, centerY: -0.6, zoom: 1.5 },
];

export const CURLNOISE_PRESETS = [
  { name: 'Nebula', scale: 1.5, octaves: 4, lacunarity: 2.0, gain: 0.5, speed: 0.5 },
  { name: 'Silk Smoke', scale: 2.5, octaves: 3, lacunarity: 2.0, gain: 0.5, speed: 0.3 },
  { name: 'Storm Cloud', scale: 1.0, octaves: 6, lacunarity: 2.2, gain: 0.6, speed: 0.8 },
  { name: 'Gentle Drift', scale: 0.8, octaves: 2, lacunarity: 2.0, gain: 0.5, speed: 0.2 },
  { name: 'Vortex', scale: 3.0, octaves: 5, lacunarity: 1.8, gain: 0.55, speed: 1.0 },
  { name: 'Aurora', scale: 1.2, octaves: 4, lacunarity: 2.5, gain: 0.45, speed: 0.4 },
];

export const COLOR_PALETTES = [
  { name: 'Synthwave', colorA: '#f72585', colorB: '#7209b7', bg: '#0a0a1a' },
  { name: 'Ocean', colorA: '#00b4d8', colorB: '#0077b6', bg: '#03045e' },
  { name: 'Ember', colorA: '#ff6d00', colorB: '#ff0054', bg: '#0d0000' },
  { name: 'Neon', colorA: '#39ff14', colorB: '#ff00ff', bg: '#0a0a0f' },
  { name: 'Pastel', colorA: '#ffafcc', colorB: '#a2d2ff', bg: '#1a1a2e' },
  { name: 'Monochrome', colorA: '#ffffff', colorB: '#888888', bg: '#000000' },
  { name: 'Aurora', colorA: '#00f5d4', colorB: '#9b5de5', bg: '#0a0a14' },
  { name: 'Infrared', colorA: '#ff006e', colorB: '#ffbe0b', bg: '#10000a' },
  // Gallery-inspired palettes (Image Savant aesthetic)
  { name: 'Electric Plasma', colorA: '#00e5ff', colorB: '#ff6d00', bg: '#020208' },
  { name: 'Bioluminescence', colorA: '#00ff87', colorB: '#e040fb', bg: '#030308' },
  { name: 'Stellar Forge', colorA: '#ffd600', colorB: '#aa00ff', bg: '#050208' },
  { name: 'Deep Current', colorA: '#1de9b6', colorB: '#d50000', bg: '#020505' },
  { name: 'Nebula Core', colorA: '#ff1744', colorB: '#00b0ff', bg: '#050205' },
  { name: 'Solar Wind', colorA: '#ffab00', colorB: '#651fff', bg: '#050300' },
  { name: 'Phantom Silk', colorA: '#e0e0e0', colorB: '#7c4dff', bg: '#010108' },
  { name: 'Toxic Bloom', colorA: '#76ff03', colorB: '#ff3d00', bg: '#020500' },
];
