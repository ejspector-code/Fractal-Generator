/**
 * Main entry point — p5.js instance mode sketch
 * Supports Peter de Jong, Clifford, Lorenz, Aizawa, Buddhabrot, Burning Ship, and Curl Noise.
 */
import p5 from 'p5';
import './styles.css';
import { renderClassic, renderParticles, renderVapor, resetParticles, initClickBurst, renderClickBursts } from './renderer.js';
import { Animator } from './animator.js';
import { DEJONG_PRESETS, CLIFFORD_PRESETS, LORENZ_PRESETS, AIZAWA_PRESETS, BUDDHABROT_PRESETS, BURNINGSHIP_PRESETS, CURLNOISE_PRESETS } from './presets.js';
import { initUI } from './ui.js';
import { savePNG, startRecording, stopRecording, isRecording } from './exporter.js';
import { startAudio, stopAudio, getFrequencyData, isActive as isAudioActive, getSampleRate, getBinCount } from './audio.js';
import { analyzeFrame, resetAnalysis } from './audioReactive.js';
import { perturbCoeffs } from './mouseInteraction.js';
import { applyPostProcessing } from './postProcess.js';
import { applySymmetry } from './symmetry.js';


// ── Shared State ──────────────────────────────────────────────────────────────

const state = {
  seed: 12345,
  attractorType: 'dejong', // 'dejong' | 'clifford' | 'lorenz' | 'aizawa' | 'buddhabrot' | 'burningship' | 'curlnoise'

  // De Jong coefficients
  coeffs: { a: DEJONG_PRESETS[0].a, b: DEJONG_PRESETS[0].b, c: DEJONG_PRESETS[0].c, d: DEJONG_PRESETS[0].d },

  // Clifford coefficients
  cliffordCoeffs: { a: CLIFFORD_PRESETS[0].a, b: CLIFFORD_PRESETS[0].b, c: CLIFFORD_PRESETS[0].c, d: CLIFFORD_PRESETS[0].d },

  // Lorenz coefficients
  lorenzCoeffs: { sigma: LORENZ_PRESETS[0].sigma, rho: LORENZ_PRESETS[0].rho, beta: LORENZ_PRESETS[0].beta },

  // Aizawa coefficients
  aizawaCoeffs: { a: AIZAWA_PRESETS[0].a, b: AIZAWA_PRESETS[0].b, c: AIZAWA_PRESETS[0].c, d: AIZAWA_PRESETS[0].d, e: AIZAWA_PRESETS[0].e, f: AIZAWA_PRESETS[0].f },

  // Buddhabrot parameters
  buddhabrotParams: { ...BUDDHABROT_PRESETS[0] },

  // Burning Ship parameters
  burningShipParams: { ...BURNINGSHIP_PRESETS[0] },

  // Curl Noise parameters
  curlNoiseParams: { ...CURLNOISE_PRESETS[0] },

  renderMode: 'classic', // 'classic' | 'particles' | 'vapor'

  classicParams: {
    iterationsPow: 5.7, // 10^5.7 ≈ 500K
    densityMode: 'sqrt',
  },

  particleParams: {
    count: 2000,
    trail: 0.92,
    glow: 1.5,
    size: 2.0,
  },

  vaporParams: {
    count: 3000,
    blurPasses: 3,
    turbulence: 0.4,
    dissipation: 0.96,
  },

  colorParams: {
    mode: 'spectral', // 'single' | 'dual' | 'spectral'
    colorA: '#00d4ff',
    colorB: '#ff006e',
  },

  bgColor: '#0a0a0f',

  aspectRatio: '1:1', // '1:1' | '16:9' | '9:16'

  diffusion: {
    enabled: false,
    strength: 1.5,
  },

  // Audio reactive
  audioSensitivity: 1.0,

  // Mouse interaction
  mouse: {
    enabled: false,
    x: 0,
    y: 0,
    screenX: 0,
    screenY: 0,
    overCanvas: false,
    strength: 0.5,
    mode: 'attract', // 'attract' | 'repel' | 'orbit'
  },

  // Symmetry / Kaleidoscope
  symmetry: {
    folds: 1, // 1 = off, 2/4/6/8
  },

  // Post-processing filters
  postProcess: {
    bloom: { enabled: false, strength: 0.5 },
    chromatic: { enabled: false, strength: 0.5 },
    vignette: { enabled: false, strength: 0.5 },
    grain: { enabled: false, strength: 0.3 },
    scanlines: { enabled: false, strength: 0.4 },
  },

  needsRedraw: true,
};

// ── Helper: get the animator base for current attractor type ──────────────────

function getAnimatorBase(type) {
  switch (type) {
    case 'lorenz': return state.lorenzCoeffs;
    case 'aizawa': return state.aizawaCoeffs;
    case 'clifford': return state.cliffordCoeffs;
    case 'curlnoise': return { ...state.curlNoiseParams };
    case 'buddhabrot': {
      const { maxIter, zoom, centerX, centerY } = state.buddhabrotParams;
      return { maxIter, zoom, centerX, centerY };
    }
    case 'burningship': {
      const { maxIter, zoom, centerX, centerY } = state.burningShipParams;
      return { maxIter, zoom, centerX, centerY };
    }
    default: return state.coeffs;
  }
}

// Sync functions map (filled after UI init)
const syncMap = {};

function syncCurrentSliders() {
  switch (state.attractorType) {
    case 'lorenz': if (syncMap.syncLorenzSliders) syncMap.syncLorenzSliders(); break;
    case 'aizawa': if (syncMap.syncAizawaSliders) syncMap.syncAizawaSliders(); break;
    case 'clifford': if (syncMap.syncCliffordSliders) syncMap.syncCliffordSliders(); break;
    case 'buddhabrot': if (syncMap.syncBuddhabrotSliders) syncMap.syncBuddhabrotSliders(); break;
    case 'burningship': if (syncMap.syncBurningShipSliders) syncMap.syncBurningShipSliders(); break;
    case 'curlnoise': if (syncMap.syncCurlNoiseSliders) syncMap.syncCurlNoiseSliders(); break;
    default: if (syncMap.syncCoeffSliders) syncMap.syncCoeffSliders(); break;
  }
}

function applyAnimCoeffs(animCoeffs) {
  switch (state.attractorType) {
    case 'lorenz':
      state.lorenzCoeffs.sigma = animCoeffs.sigma;
      state.lorenzCoeffs.rho = animCoeffs.rho;
      state.lorenzCoeffs.beta = animCoeffs.beta;
      break;
    case 'aizawa':
      ['a', 'b', 'c', 'd', 'e', 'f'].forEach(k => {
        if (animCoeffs[k] !== undefined) state.aizawaCoeffs[k] = animCoeffs[k];
      });
      break;
    case 'clifford':
      ['a', 'b', 'c', 'd'].forEach(k => {
        if (animCoeffs[k] !== undefined) state.cliffordCoeffs[k] = animCoeffs[k];
      });
      break;
    case 'buddhabrot':
      Object.keys(animCoeffs).forEach(k => {
        if (k === 'maxIter') state.buddhabrotParams[k] = Math.round(animCoeffs[k]);
        else state.buddhabrotParams[k] = animCoeffs[k];
      });
      break;
    case 'burningship':
      Object.keys(animCoeffs).forEach(k => {
        if (k === 'maxIter') state.burningShipParams[k] = Math.round(animCoeffs[k]);
        else state.burningShipParams[k] = animCoeffs[k];
      });
      break;
    case 'curlnoise':
      Object.keys(animCoeffs).forEach(k => {
        if (animCoeffs[k] !== undefined) state.curlNoiseParams[k] = animCoeffs[k];
      });
      break;
    default:
      state.coeffs.a = animCoeffs.a;
      state.coeffs.b = animCoeffs.b;
      state.coeffs.c = animCoeffs.c;
      state.coeffs.d = animCoeffs.d;
      break;
  }
}

// ── Animator ──────────────────────────────────────────────────────────────────

const animator = new Animator();
animator.setBase(state.coeffs);

// ── p5.js Sketch ──────────────────────────────────────────────────────────────

// ── Canvas dimension helper ──────────────────────────────────────────────────

function computeCanvasDims(ratio, maxW, maxH) {
  const MAX_EDGE = 900;
  let w, h;
  switch (ratio) {
    case '16:9': {
      w = Math.min(maxW, MAX_EDGE);
      h = Math.round(w * 9 / 16);
      if (h > maxH) { h = maxH; w = Math.round(h * 16 / 9); }
      break;
    }
    case '9:16': {
      h = Math.min(maxH, MAX_EDGE);
      w = Math.round(h * 9 / 16);
      if (w > maxW) { w = maxW; h = Math.round(w * 16 / 9); }
      break;
    }
    default: { // 1:1
      const size = Math.min(maxW, maxH, 800);
      w = h = Math.max(size, 400);
      break;
    }
  }
  w = Math.max(w, 200);
  h = Math.max(h, 200);
  return { w, h };
}

const sketch = (p) => {
  let fpsFrames = 0;
  let fpsLast = 0;

  p.setup = () => {
    const container = document.getElementById('canvas-container');
    const area = document.getElementById('canvas-area');
    const { w, h } = computeCanvasDims(state.aspectRatio, area.clientWidth - 40, area.clientHeight - 40);

    const cnv = p.createCanvas(w, h);
    cnv.parent(container);

    p.pixelDensity(1);
    p.randomSeed(state.seed);
    p.noiseSeed(state.seed);

    // Background fill
    const bg = hexToRgbSimple(state.bgColor);
    p.background(bg.r, bg.g, bg.b);
  };

  p.draw = () => {
    // FPS counter
    fpsFrames++;
    const now = p.millis();
    if (now - fpsLast > 500) {
      const fps = Math.round(fpsFrames / ((now - fpsLast) / 1000));
      document.getElementById('fps-counter').textContent = `${fps} FPS`;
      fpsFrames = 0;
      fpsLast = now;
    }

    // ── Mouse Tracking ────────────────────────────────────────────────────
    if (state.mouse.enabled) {
      const mx = p.mouseX;
      const my = p.mouseY;
      const over = mx >= 0 && mx < p.width && my >= 0 && my < p.height;
      state.mouse.overCanvas = over;
      if (over) {
        state.mouse.screenX = mx;
        state.mouse.screenY = my;
        state.mouse.x = mx / p.width;
        state.mouse.y = my / p.height;
        // In classic mode, mouse movement triggers redraw
        if (state.renderMode === 'classic') {
          state.needsRedraw = true;
        }
      }
    }

    // ── Audio Analysis ────────────────────────────────────────────────────
    if (isAudioActive()) {
      const freqData = getFrequencyData();
      if (freqData) {
        const features = analyzeFrame(freqData, getSampleRate(), getBinCount(), state.audioSensitivity);
        animator.setAudioModulation(features);
        // Draw mini visualizer
        drawAudioVisualizer(freqData);
      }
    }

    // Animation update
    const animCoeffs = animator.update();
    if (animCoeffs) {
      applyAnimCoeffs(animCoeffs);
      syncCurrentSliders();
      state.needsRedraw = true;
    }

    // For animated modes, always redraw
    let didRender = false;
    if (state.renderMode === 'particles' || state.renderMode === 'vapor') {
      switch (state.renderMode) {
        case 'particles':
          renderParticles(p, state, p.frameCount);
          break;
        case 'vapor':
          renderVapor(p, state, p.frameCount);
          break;
      }
      didRender = true;
    } else if (state.needsRedraw) {
      // Classic mode: apply mouse perturbation if active
      if (state.mouse.enabled && state.mouse.overCanvas) {
        const perturbedState = { ...state };
        const currentCoeffs = getAnimatorBase(state.attractorType);
        const perturbed = perturbCoeffs(currentCoeffs, state.mouse.x, state.mouse.y, state.mouse.strength);
        // Apply perturbed coefficients to a temp state copy
        switch (state.attractorType) {
          case 'lorenz': perturbedState.lorenzCoeffs = perturbed; break;
          case 'aizawa': perturbedState.aizawaCoeffs = perturbed; break;
          case 'clifford': perturbedState.cliffordCoeffs = perturbed; break;
          case 'curlnoise': perturbedState.curlNoiseParams = perturbed; break;
          case 'buddhabrot': perturbedState.buddhabrotParams = { ...state.buddhabrotParams, ...perturbed }; break;
          case 'burningship': perturbedState.burningShipParams = { ...state.burningShipParams, ...perturbed }; break;
          default: perturbedState.coeffs = perturbed; break;
        }
        renderClassic(p, perturbedState);
      } else {
        renderClassic(p, state);
      }
      didRender = true;
      state.needsRedraw = false;
    }

    // Apply symmetry / kaleidoscope only on fresh renders
    if (didRender && state.symmetry.folds > 1) {
      applySymmetry(p, state.symmetry.folds);
    }

    // Always render click bursts on top
    renderClickBursts(p);

    // Post-processing overlay (runs every frame for grain animation)
    const p5Canvas = p.drawingContext.canvas;
    applyPostProcessing(p5Canvas, state.postProcess);
  };

  // Click burst handler
  p.mousePressed = () => {
    const mx = p.mouseX;
    const my = p.mouseY;
    if (mx >= 0 && mx < p.width && my >= 0 && my < p.height) {
      initClickBurst(mx, my, p.width, state.colorParams);
      // In classic mode, force a few redraws so the burst animates
      if (state.renderMode === 'classic') {
        state.needsRedraw = true;
        // Keep redrawing for the burst duration
        let frames = 0;
        const burstLoop = setInterval(() => {
          state.needsRedraw = true;
          frames++;
          if (frames >= 65) clearInterval(burstLoop);
        }, 16);
      }
    }
  };

  // Resize handling
  p.windowResized = () => {
    const area = document.getElementById('canvas-area');
    const { w, h } = computeCanvasDims(state.aspectRatio, area.clientWidth - 40, area.clientHeight - 40);
    p.resizeCanvas(w, h);
    resetParticles();
    state.needsRedraw = true;
  };
};

function hexToRgbSimple(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

// ── Audio Visualizer ──────────────────────────────────────────────────────────

let vizCanvas = null;
let vizCtx = null;

function drawAudioVisualizer(frequencyData) {
  if (!vizCanvas) {
    vizCanvas = document.getElementById('audio-visualizer');
    if (!vizCanvas) return;
    vizCtx = vizCanvas.getContext('2d');
    // Set internal resolution to match CSS display size
    vizCanvas.width = vizCanvas.offsetWidth * (window.devicePixelRatio || 1);
    vizCanvas.height = vizCanvas.offsetHeight * (window.devicePixelRatio || 1);
  }

  const w = vizCanvas.width;
  const h = vizCanvas.height;
  const ctx = vizCtx;

  ctx.clearRect(0, 0, w, h);

  // Draw ~64 bars across the canvas
  const barCount = 64;
  const step = Math.floor(frequencyData.length / barCount);
  const barWidth = w / barCount;
  const gap = 1;

  for (let i = 0; i < barCount; i++) {
    const value = frequencyData[i * step] / 255;
    const barHeight = value * h;

    // Color gradient: cyan → magenta based on frequency
    const hue = 180 + (i / barCount) * 120;
    const alpha = 0.5 + value * 0.5;

    ctx.fillStyle = `hsla(${hue}, 80%, 60%, ${alpha})`;
    ctx.fillRect(
      i * barWidth + gap / 2,
      h - barHeight,
      barWidth - gap,
      barHeight
    );
  }
}

// ── Initialize ────────────────────────────────────────────────────────────────

const p5Instance = new p5(sketch, document.getElementById('canvas-container'));

// State change handler
function onStateChange(what) {
  if (what === 'aspect') {
    // Trigger a full canvas resize for aspect ratio changes
    p5Instance.windowResized();
  }
  state.needsRedraw = true;
}

// Initialize UI
let uiRef = null;

// Small delay to ensure p5 canvas is ready
setTimeout(() => {
  uiRef = initUI(state, onStateChange, animator);

  // Store sync functions for use in animation loop
  Object.assign(syncMap, uiRef);

  // Wire export buttons
  document.getElementById('btn-save').onclick = () => {
    const canvas = document.querySelector('#canvas-container canvas');
    if (canvas) savePNG(canvas);
  };

  document.getElementById('btn-record').onclick = () => {
    const canvas = document.querySelector('#canvas-container canvas');
    if (canvas) {
      if (!animator.playing) {
        document.getElementById('auto-animate').checked = true;
        const base = getAnimatorBase(state.attractorType);
        animator.setBase(base);
        animator.play();
        document.getElementById('btn-play').style.display = 'none';
        document.getElementById('btn-pause').style.display = '';
      }
      startRecording(canvas, () => {
        document.getElementById('btn-record').style.display = '';
        document.getElementById('btn-stop-record').style.display = 'none';
      });
      document.getElementById('btn-record').style.display = 'none';
      document.getElementById('btn-stop-record').style.display = '';
      document.getElementById('btn-stop-record').classList.add('recording-pulse');
    }
  };

  document.getElementById('btn-stop-record').onclick = () => {
    stopRecording();
  };

  // ── Audio Controls ──────────────────────────────────────────────────────
  const btnListen = document.getElementById('btn-listen');
  const btnStopListen = document.getElementById('btn-stop-listen');
  const statusDot = document.getElementById('audio-status-dot');
  const statusText = document.getElementById('audio-status-text');

  btnListen.onclick = async () => {
    statusDot.className = 'audio-status-dot';
    statusText.textContent = 'Connecting...';
    btnListen.disabled = true;

    const result = await startAudio();

    if (result.ok) {
      statusDot.className = 'audio-status-dot active';
      statusText.textContent = 'Listening';
      btnListen.style.display = 'none';
      btnStopListen.style.display = '';
      btnStopListen.classList.add('btn-listen-active');

      // Set animator base if not already playing
      if (!animator.playing) {
        const base = getAnimatorBase(state.attractorType);
        animator.setBase(base);
      }
    } else {
      statusDot.className = 'audio-status-dot error';
      statusText.textContent = result.error || 'Error';
    }
    btnListen.disabled = false;
  };

  btnStopListen.onclick = () => {
    stopAudio();
    resetAnalysis();
    animator.setAudioModulation(null);
    statusDot.className = 'audio-status-dot';
    statusText.textContent = 'Off';
    btnStopListen.style.display = 'none';
    btnStopListen.classList.remove('btn-listen-active');
    btnListen.style.display = '';

    // Clear visualizer
    vizCanvas = null;
    vizCtx = null;
    const vizEl = document.getElementById('audio-visualizer');
    if (vizEl) {
      const ctx = vizEl.getContext('2d');
      ctx.clearRect(0, 0, vizEl.width, vizEl.height);
    }
  };

  document.getElementById('audio-sensitivity').oninput = function () {
    state.audioSensitivity = parseFloat(this.value);
    animator.sensitivity = state.audioSensitivity;
    const valEl = document.getElementById('val-sensitivity');
    if (valEl) valEl.textContent = state.audioSensitivity.toFixed(2);
  };

  // ── Mouse Interaction Controls ──────────────────────────────────────────
  document.getElementById('mouse-toggle').onchange = function () {
    state.mouse.enabled = this.checked;
    state.needsRedraw = true;
  };

  document.getElementById('mouse-strength').oninput = function () {
    state.mouse.strength = parseFloat(this.value);
    document.getElementById('val-mouse-strength').textContent = state.mouse.strength.toFixed(2);
  };

  document.getElementById('mouse-mode').onchange = function () {
    state.mouse.mode = this.value;
  };

}, 100);
