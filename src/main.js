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
import { startAudio, stopAudio, getFrequencyData, getTimeDomainData, isActive as isAudioActive, getSampleRate, getBinCount } from './audio.js';
import { analyzeFrame, resetAnalysis } from './audioReactive.js';
import { perturbCoeffs } from './mouseInteraction.js';
import { applyPostProcessing } from './postProcess.js';
import { applySymmetry } from './symmetry.js';
import { startMidi, stopMidi, isMidiActive, getMidiFrequencyData, getMidiTimeDomainData, getMidiSampleRate, getMidiBinCount, setMidiWaveform, getMidiActiveNotes, getMidiDevices, setNoteCallback, noteOn, noteOff, setFilterCutoff, setFilterQ, setFilterType, setDistortionDrive, setWahEnabled, setWahRate, setWahDepth, setWahBaseFreq, setDelayTime, setDelayFeedback, setDelayMix, setReverbMix, setReverbDecay, setADSR, setMasterVolume, setOctaveShift, startLooperRecording, stopLooperRecording, toggleLooperPlayback, stopLooper, getLooperState, setLooperCallback } from './midi.js';
import { drawWaveform } from './waveformOverlay.js';
import { playClickPerc } from './clickSound.js';


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
    mode: 'spectral', // 'single' | 'dual' | 'spectral' | 'vivid'
    colorA: '#00d4ff',
    colorB: '#ff006e',
    blendMode: 'normal', // 'normal' | 'add'
  },

  bgColor: '#0a0a0f',

  aspectRatio: '1:1', // '1:1' | '16:9' | '9:16'

  diffusion: {
    enabled: false,
    strength: 1.5,
  },

  // Audio reactive
  audioSensitivity: 1.0,
  audioFeatures: null, // { bass, mid, treble, energy, beat } or null
  timeDomainData: null, // Uint8Array waveform for renderer displacement

  // Waveform overlay
  waveformOverlay: {
    enabled: false,
    intensity: 0.7,
    style: 'oscilloscope', // 'oscilloscope' | 'mirrored' | 'circular' | 'bars' | 'radial'
  },

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

    // ── Audio Analysis (Mic or MIDI, MIDI takes priority) ─────────────────
    let currentTimeDomain = null;
    if (isMidiActive()) {
      const freqData = getMidiFrequencyData();
      if (freqData) {
        const features = analyzeFrame(freqData, getMidiSampleRate(), getMidiBinCount(), state.audioSensitivity);
        animator.setAudioModulation(features);
        state.audioFeatures = features;
        drawAudioVisualizer(freqData);
        drawMidiKeyboard();
        currentTimeDomain = getMidiTimeDomainData();
      }
    } else if (isAudioActive()) {
      const freqData = getFrequencyData();
      if (freqData) {
        const features = analyzeFrame(freqData, getSampleRate(), getBinCount(), state.audioSensitivity);
        animator.setAudioModulation(features);
        state.audioFeatures = features;
        drawAudioVisualizer(freqData);
        currentTimeDomain = getTimeDomainData();
      }
    } else {
      state.audioFeatures = null;
    }

    // Store time-domain data on state for renderer access
    state.timeDomainData = currentTimeDomain;

    // Animation update
    const animCoeffs = animator.update();
    if (animCoeffs) {
      applyAnimCoeffs(animCoeffs);
      syncCurrentSliders();
      state.needsRedraw = true;
    }
    // Pass animator's color shift to renderers
    state.audioColorShift = animator.colorShift || 0;

    // Force redraw every frame when waveform overlay or audio effects are active
    if ((state.waveformOverlay.enabled && currentTimeDomain) || state.audioFeatures) {
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

    // ── Waveform Overlay (after fractal render) ────────────────────────────
    if (state.waveformOverlay.enabled && currentTimeDomain) {
      drawWaveform(p, currentTimeDomain, state.audioFeatures, state.colorParams, state.waveformOverlay.intensity, state.waveformOverlay.style);
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

      // Play position-mapped percussion: hi-hat (top) → rimshot (mid) → kick (bottom)
      const yRatio = my / p.height;
      const xRatio = mx / p.width;
      playClickPerc(yRatio, xRatio, 0.5);

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

// ── MIDI Keyboard Visualizer ──────────────────────────────────────────────────

let midiVizCanvas = null;
let midiVizCtx = null;

function drawMidiKeyboard() {
  if (!midiVizCanvas) {
    midiVizCanvas = document.getElementById('midi-keyboard-viz');
    if (!midiVizCanvas) return;
    midiVizCtx = midiVizCanvas.getContext('2d');
  }

  // Sync internal resolution to CSS size every frame (handles resize)
  const dpr = window.devicePixelRatio || 1;
  const cssW = midiVizCanvas.offsetWidth;
  const cssH = midiVizCanvas.offsetHeight;
  if (midiVizCanvas.width !== Math.round(cssW * dpr) || midiVizCanvas.height !== Math.round(cssH * dpr)) {
    midiVizCanvas.width = Math.round(cssW * dpr);
    midiVizCanvas.height = Math.round(cssH * dpr);
    midiVizCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const w = cssW;
  const h = cssH;
  const ctx = midiVizCtx;
  const activeNotes = getMidiActiveNotes();

  ctx.clearRect(0, 0, w, h);

  // Draw 2 octaves (C3=48 to B4=71), 24 notes
  const startNote = 36; // C2
  const endNote = 84;   // C6
  const totalNotes = endNote - startNote;

  // Count white keys
  const isBlack = [false, true, false, true, false, false, true, false, true, false, true, false];
  let whiteCount = 0;
  for (let n = startNote; n < endNote; n++) {
    if (!isBlack[n % 12]) whiteCount++;
  }

  const whiteWidth = w / whiteCount;
  const blackWidth = whiteWidth * 0.6;
  const blackHeight = h * 0.6;

  // Draw white keys first
  let wx = 0;
  for (let n = startNote; n < endNote; n++) {
    if (isBlack[n % 12]) continue;
    const isActive = activeNotes.has(n);

    if (isActive) {
      ctx.fillStyle = '#00d4ff';
      ctx.shadowColor = '#00d4ff';
      ctx.shadowBlur = 8;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.shadowBlur = 0;
    }

    ctx.fillRect(wx + 0.5, 0, whiteWidth - 1, h - 1);
    ctx.shadowBlur = 0;

    // Border
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(wx + 0.5, 0, whiteWidth - 1, h - 1);

    wx += whiteWidth;
  }

  // Draw black keys on top
  wx = 0;
  for (let n = startNote; n < endNote; n++) {
    if (isBlack[n % 12]) continue;

    // Check if next note is black
    if (n + 1 < endNote && isBlack[(n + 1) % 12]) {
      const isActive = activeNotes.has(n + 1);

      if (isActive) {
        ctx.fillStyle = '#ff006e';
        ctx.shadowColor = '#ff006e';
        ctx.shadowBlur = 8;
      } else {
        ctx.fillStyle = 'rgba(30,30,40,0.95)';
        ctx.shadowBlur = 0;
      }

      ctx.fillRect(wx + whiteWidth - blackWidth / 2, 0, blackWidth, blackHeight);
      ctx.shadowBlur = 0;
    }
    wx += whiteWidth;
  }
}

function clearMidiKeyboard() {
  if (midiVizCanvas && midiVizCtx) {
    midiVizCtx.clearRect(0, 0, midiVizCanvas.width, midiVizCanvas.height);
  }
  midiVizCanvas = null;
  midiVizCtx = null;
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

  // Waveform overlay controls
  document.getElementById('waveform-toggle').onchange = function () {
    state.waveformOverlay.enabled = this.checked;
    document.getElementById('waveform-intensity-group').style.display = this.checked ? '' : 'none';
    document.getElementById('waveform-style-group').style.display = this.checked ? '' : 'none';
  };
  document.getElementById('waveform-intensity').oninput = function () {
    state.waveformOverlay.intensity = parseFloat(this.value);
    const valEl = document.getElementById('val-waveform-intensity');
    if (valEl) valEl.textContent = state.waveformOverlay.intensity.toFixed(2);
  };
  document.getElementById('waveform-style').onchange = function () {
    state.waveformOverlay.style = this.value;
  };

  // ── MIDI Controls ──────────────────────────────────────────────────────
  const midiToggle = document.getElementById('midi-toggle');
  const midiControls = document.getElementById('midi-controls');
  const midiStatusDot = document.getElementById('midi-status-dot');
  const midiStatusText = document.getElementById('midi-status-text');
  const midiDeviceName = document.getElementById('midi-device-name');

  midiToggle.onchange = async function () {
    if (this.checked) {
      midiStatusDot.className = 'midi-status-dot connecting';
      midiStatusText.textContent = 'Connecting...';

      const result = await startMidi();

      if (result.ok) {
        midiStatusDot.className = 'midi-status-dot active';
        const devices = result.devices || getMidiDevices();
        if (devices.length > 0) {
          midiStatusText.textContent = 'Connected';
          midiDeviceName.textContent = devices[0];
        } else {
          midiStatusText.textContent = 'Ready';
          midiDeviceName.textContent = 'Use keyboard or click';
        }
        midiControls.style.display = '';
        // Show the full-width keyboard and effects drawer below the canvas
        document.getElementById('midi-keyboard-viz').style.display = 'block';
        document.getElementById('midi-effects-drawer').style.display = '';

        // If mic is active, stop it (MIDI takes priority)
        if (isAudioActive()) {
          stopAudio();
          resetAnalysis();
          statusDot.className = 'audio-status-dot';
          statusText.textContent = 'Off';
          btnStopListen.style.display = 'none';
          btnListen.style.display = '';
        }

        // Set animator base
        if (!animator.playing) {
          const base = getAnimatorBase(state.attractorType);
          animator.setBase(base);
        }

        setNoteCallback(() => { state.needsRedraw = true; });
      } else {
        midiStatusDot.className = 'midi-status-dot error';
        midiStatusText.textContent = result.error || 'Error';
        this.checked = false;
      }
    } else {
      stopMidi();
      resetAnalysis();
      animator.setAudioModulation(null);
      midiStatusDot.className = 'midi-status-dot';
      midiStatusText.textContent = 'Off';
      midiDeviceName.textContent = '—';
      midiControls.style.display = 'none';
      document.getElementById('midi-keyboard-viz').style.display = 'none';
      document.getElementById('midi-effects-drawer').style.display = 'none';
      // Reset drawer state
      const drawerContent = document.getElementById('midi-drawer-content');
      const drawerToggle = document.getElementById('midi-drawer-toggle');
      drawerContent.classList.remove('open');
      drawerToggle.classList.remove('open');
      clearMidiKeyboard();
    }
  };

  document.getElementById('midi-waveform').onchange = function () {
    setMidiWaveform(this.value);
  };

  // ── MIDI Effects Drawer ────────────────────────────────────────────────
  const drawerToggleBtn = document.getElementById('midi-drawer-toggle');
  const drawerContent = document.getElementById('midi-drawer-content');

  drawerToggleBtn.onclick = () => {
    const isOpen = drawerContent.classList.toggle('open');
    drawerToggleBtn.classList.toggle('open', isOpen);
  };

  // Synth controls
  document.getElementById('fx-waveform').onchange = function () {
    setMidiWaveform(this.value);
    // Sync sidebar selector too
    const sidebar = document.getElementById('midi-waveform');
    if (sidebar) sidebar.value = this.value;
  };

  document.getElementById('fx-octave').oninput = function () {
    setOctaveShift(parseInt(this.value));
    document.getElementById('fx-val-octave').textContent = this.value;
  };

  document.getElementById('fx-volume').oninput = function () {
    setMasterVolume(parseFloat(this.value));
    document.getElementById('fx-val-volume').textContent = parseFloat(this.value).toFixed(2);
  };

  // ADSR
  document.getElementById('fx-attack').oninput = function () {
    document.getElementById('fx-val-attack').textContent = parseFloat(this.value).toFixed(2);
    syncADSR();
  };
  document.getElementById('fx-decay').oninput = function () {
    document.getElementById('fx-val-decay').textContent = parseFloat(this.value).toFixed(2);
    syncADSR();
  };
  document.getElementById('fx-sustain').oninput = function () {
    document.getElementById('fx-val-sustain').textContent = parseFloat(this.value).toFixed(2);
    syncADSR();
  };
  document.getElementById('fx-release').oninput = function () {
    document.getElementById('fx-val-release').textContent = parseFloat(this.value).toFixed(2);
    syncADSR();
  };
  function syncADSR() {
    setADSR(
      parseFloat(document.getElementById('fx-attack').value),
      parseFloat(document.getElementById('fx-decay').value),
      parseFloat(document.getElementById('fx-sustain').value),
      parseFloat(document.getElementById('fx-release').value)
    );
  }

  // Filter
  document.getElementById('fx-filter-type').onchange = function () {
    setFilterType(this.value);
  };
  document.getElementById('fx-filter-cutoff').oninput = function () {
    const v = parseInt(this.value);
    setFilterCutoff(v);
    document.getElementById('fx-val-cutoff').textContent = v;
  };
  document.getElementById('fx-filter-q').oninput = function () {
    const v = parseFloat(this.value);
    setFilterQ(v);
    document.getElementById('fx-val-q').textContent = v.toFixed(1);
  };

  // Distortion
  document.getElementById('fx-distortion').oninput = function () {
    const v = parseFloat(this.value);
    setDistortionDrive(v);
    document.getElementById('fx-val-drive').textContent = v.toFixed(1);
  };

  // Wah-Wah
  document.getElementById('fx-wah-toggle').onchange = function () {
    setWahEnabled(this.checked);
  };
  document.getElementById('fx-wah-rate').oninput = function () {
    const v = parseFloat(this.value);
    setWahRate(v);
    document.getElementById('fx-val-wah-rate').textContent = v.toFixed(1);
  };
  document.getElementById('fx-wah-depth').oninput = function () {
    const v = parseInt(this.value);
    setWahDepth(v);
    document.getElementById('fx-val-wah-depth').textContent = v;
  };
  document.getElementById('fx-wah-base').oninput = function () {
    const v = parseInt(this.value);
    setWahBaseFreq(v);
    document.getElementById('fx-val-wah-base').textContent = v;
  };

  // Delay
  document.getElementById('fx-delay-time').oninput = function () {
    const v = parseFloat(this.value);
    setDelayTime(v);
    document.getElementById('fx-val-delay-time').textContent = v.toFixed(2);
  };
  document.getElementById('fx-delay-feedback').oninput = function () {
    const v = parseFloat(this.value);
    setDelayFeedback(v);
    document.getElementById('fx-val-delay-fb').textContent = v.toFixed(2);
  };
  document.getElementById('fx-delay-mix').oninput = function () {
    const v = parseFloat(this.value);
    setDelayMix(v);
    document.getElementById('fx-val-delay-mix').textContent = v.toFixed(2);
  };

  // Reverb
  document.getElementById('fx-reverb-mix').oninput = function () {
    const v = parseFloat(this.value);
    setReverbMix(v);
    document.getElementById('fx-val-reverb-mix').textContent = v.toFixed(2);
  };
  document.getElementById('fx-reverb-decay').oninput = function () {
    const v = parseFloat(this.value);
    setReverbDecay(v);
    document.getElementById('fx-val-reverb-decay').textContent = v.toFixed(2);
  };

  // Looper
  const looperRec = document.getElementById('fx-looper-rec');
  const looperPlay = document.getElementById('fx-looper-play');
  const looperStop = document.getElementById('fx-looper-stop');
  const looperStatus = document.getElementById('fx-looper-status');

  setLooperCallback((loopState) => {
    looperStatus.textContent = loopState;
    looperRec.classList.toggle('recording', loopState === 'recording');
    looperPlay.classList.toggle('playing', loopState === 'playing');
    looperPlay.disabled = (loopState === 'idle' || loopState === 'recording');
    looperStop.disabled = (loopState === 'idle');
    looperPlay.textContent = loopState === 'playing' ? '⏸' : '▶';
  });

  looperRec.onclick = () => {
    const ls = getLooperState();
    if (ls === 'recording') {
      stopLooperRecording();
    } else {
      if (ls === 'playing') stopLooper();
      startLooperRecording();
    }
  };

  looperPlay.onclick = () => {
    toggleLooperPlayback();
  };

  looperStop.onclick = () => {
    stopLooper();
  };

  // ── Computer Keyboard → MIDI Notes ────────────────────────────────────
  // Two rows: bottom row = white keys (C3 to E5), top row = sharps
  const KEY_MAP = {
    // Bottom row — white keys
    'z': 48, 'x': 50, 'c': 52, 'v': 53, 'b': 55, 'n': 57, 'm': 59,  // C3–B3
    ',': 60, '.': 62, '/': 64,                                         // C4–E4
    // Top row — next octave white keys
    'q': 60, 'w': 62, 'e': 64, 'r': 65, 't': 67, 'y': 69, 'u': 71,  // C4–B4
    'i': 72, 'o': 74, 'p': 76,                                        // C5–E5
    // Middle row — sharps for bottom row
    's': 49, 'd': 51, 'g': 54, 'h': 56, 'j': 58,                     // C#3–A#3
    'l': 61, ';': 63,                                                  // C#4–D#4
    // Number row — sharps for top row
    '2': 61, '3': 63, '5': 66, '6': 68, '7': 70,                     // C#4–A#4
    '9': 73, '0': 75,                                                  // C#5–D#5
  };
  const keysDown = new Set();

  document.addEventListener('keydown', (e) => {
    if (!isMidiActive()) return;
    if (e.repeat) return;
    // Don't capture if user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    const note = KEY_MAP[e.key.toLowerCase()];
    if (note !== undefined) {
      e.preventDefault();
      keysDown.add(e.key.toLowerCase());
      noteOn(note, 100);
    }
  });

  document.addEventListener('keyup', (e) => {
    if (!isMidiActive()) return;
    const note = KEY_MAP[e.key.toLowerCase()];
    if (note !== undefined) {
      keysDown.delete(e.key.toLowerCase());
      noteOff(note);
    }
  });

  // ── Click-to-Play on Piano Visualizer ─────────────────────────────────
  const pianoCanvas = document.getElementById('midi-keyboard-viz');
  let pianoMouseDown = false;
  let lastClickedNote = -1;

  function getNoteFromClick(e) {
    const rect = pianoCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    const startNote = 36; // C2
    const endNote = 84;   // C6
    const isBlack = [false, true, false, true, false, false, true, false, true, false, true, false];

    let whiteCount = 0;
    for (let n = startNote; n < endNote; n++) {
      if (!isBlack[n % 12]) whiteCount++;
    }

    const whiteWidth = w / whiteCount;
    const blackWidth = whiteWidth * 0.6;
    const blackHeight = h * 0.6;

    // Check black keys first (they're on top)
    if (y < blackHeight) {
      let wx = 0;
      for (let n = startNote; n < endNote; n++) {
        if (isBlack[n % 12]) continue;
        if (n + 1 < endNote && isBlack[(n + 1) % 12]) {
          const bx = wx + whiteWidth - blackWidth / 2;
          if (x >= bx && x < bx + blackWidth) {
            return n + 1;
          }
        }
        wx += whiteWidth;
      }
    }

    // Check white keys
    let wx = 0;
    for (let n = startNote; n < endNote; n++) {
      if (isBlack[n % 12]) continue;
      if (x >= wx && x < wx + whiteWidth) {
        return n;
      }
      wx += whiteWidth;
    }
    return -1;
  }

  pianoCanvas.addEventListener('mousedown', (e) => {
    if (!isMidiActive()) return;
    pianoMouseDown = true;
    const note = getNoteFromClick(e);
    if (note >= 0) {
      lastClickedNote = note;
      noteOn(note, 100);
    }
  });

  pianoCanvas.addEventListener('mousemove', (e) => {
    if (!pianoMouseDown || !isMidiActive()) return;
    const note = getNoteFromClick(e);
    if (note >= 0 && note !== lastClickedNote) {
      if (lastClickedNote >= 0) noteOff(lastClickedNote);
      lastClickedNote = note;
      noteOn(note, 100);
    }
  });

  pianoCanvas.addEventListener('mouseup', () => {
    if (lastClickedNote >= 0) noteOff(lastClickedNote);
    pianoMouseDown = false;
    lastClickedNote = -1;
  });

  pianoCanvas.addEventListener('mouseleave', () => {
    if (pianoMouseDown && lastClickedNote >= 0) noteOff(lastClickedNote);
    pianoMouseDown = false;
    lastClickedNote = -1;
  });

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
